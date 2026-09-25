(function () {
  'use strict';

  var DATA = globalThis.WT_SHOT_DATA;
  if (!DATA || !globalThis.THREE) {
    return;
  }

  var DEG = Math.PI / 180;
  var DEFAULT_RANGE = 500;
  var SHELL_TYPE_PROFILE = Object.freeze({
    APCBC: {
      rangeDecay: 0.00034,
      angleExponent: 1.16,
      armorLossFactor: 0.78,
      shellPenLoss: 0.06,
      typeAlias: ['APCBC', 'AP', 'APCBC-FS']
    },
    APHE: {
      rangeDecay: 0.00039,
      angleExponent: 1.2,
      armorLossFactor: 0.86,
      shellPenLoss: 0.07,
      typeAlias: ['APHE', 'APHE-HE']
    },
    HEAT: {
      rangeDecay: 0.00018,
      angleExponent: 1.04,
      armorLossFactor: 0.64,
      shellPenLoss: 0.03,
      overmatchHardCap: 0.95,
      typeAlias: ['HEAT', 'HESH', 'CUMULATIVE', 'CUM']
    }
  });

  var state = {
    shooterId: (DATA.shooters[0] && DATA.shooters[0].id) || '',
    targetId: (DATA.targets[0] && DATA.targets[0].id) || '',
    range: DEFAULT_RANGE,
    xray: false,
    targetYaw: 0,
    turretYaw: 0,
    target: null,
    visualModelGroup: null,
    visualModelLoaded: false,
    visualModelToken: 0,
    visualMaterials: [],
    visualTurretGroup: null,
    xrayModelGroup: null,
    xrayModelLoaded: false,
    xrayModelToken: 0,
    xrayMaterials: [],
    xrayTurretGroup: null,
    visualTextureCache: Object.create(null),
    orbit: {
      radius: 11.6,
      theta: 0.84,
      phi: 0.58,
      target: new THREE.Vector3(0, 1.0, 0)
    },
    modelGroup: null,
    partMeshes: [],
    partStates: new Map(),
    hullGroup: null,
    turretGroup: null,
    turretPivot: new THREE.Vector3(),
    lastShot: null,
    effects: []
  };

  var dom = {
    shooterSelect: document.getElementById('shooter-select'),
    targetSelect: document.getElementById('target-select'),
    targetYawSelect: document.getElementById('target-yaw-select'),
    turretYawSelect: document.getElementById('target-turret-yaw-select'),
    rangeInput: document.getElementById('range-input'),
    rangeOutput: document.getElementById('range-output'),
    fireButton: document.getElementById('fire-button'),
    resetButton: document.getElementById('reset-button'),
    xrayButton: document.getElementById('xray-button'),
    canvas: document.getElementById('judge-canvas'),
    resultSummary: document.getElementById('result-summary'),
    moduleStatus: document.getElementById('module-status'),
    sourceImage: document.getElementById('source-image'),
    sourceTags: document.getElementById('source-tags'),
    crosshair: document.querySelector('.judge-crosshair'),
    targetName: document.getElementById('target-name'),
    penetrationReadout: document.getElementById('penetration-readout')
  };

  if (!dom.canvas || !dom.shooterSelect || !dom.targetSelect || !dom.targetYawSelect || !dom.turretYawSelect) {
    return;
  }

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
  var renderer = new THREE.WebGLRenderer({
    canvas: dom.canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance'
  });
  var raycaster = new THREE.Raycaster();
  var pointerNdc = new THREE.Vector2(0, 0);
  var lastCanvasPointerNdc = new THREE.Vector2(0, 0);
  var clock = new THREE.Clock();
  var modelRoot = new THREE.Group();
  var effectRoot = new THREE.Group();
  var upAxis = new THREE.Vector3(0, 1, 0);
  var drag = {
    active: false,
    pointerId: null,
    x: 0,
    y: 0,
    moved: false,
    shootBlocked: false
  };

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setSize(1, 1, false);

  scene.add(modelRoot);
  scene.add(effectRoot);

  var ambient = new THREE.HemisphereLight(0xdce9f5, 0x102132, 1.45);
  var keyLight = new THREE.DirectionalLight(0xfff0cc, 1.65);
  var fillLight = new THREE.DirectionalLight(0x89b8ff, 0.6);
  var rimLight = new THREE.DirectionalLight(0x86f2cf, 0.45);
  ambient.position.set(0, 1, 0);
  keyLight.position.set(7, 9, 8);
  fillLight.position.set(-8, 5, -6);
  rimLight.position.set(-5, 3, 7);
  scene.add(ambient);
  scene.add(keyLight);
  scene.add(fillLight);
  scene.add(rimLight);

  var floor = new THREE.Mesh(
    new THREE.CircleGeometry(6.4, 64),
    new THREE.MeshStandardMaterial({
      color: 0x0b1622,
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: 0.92
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.02;
  scene.add(floor);

  var floorGrid = new THREE.GridHelper(12, 24, 0x40607a, 0x20364b);
  floorGrid.position.y = 0.03;
  if (Array.isArray(floorGrid.material)) {
    for (var gm = 0; gm < floorGrid.material.length; gm += 1) {
      floorGrid.material[gm].transparent = true;
      floorGrid.material[gm].opacity = 0.22;
    }
  }
  scene.add(floorGrid);

  function clearNode(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function updatePointerNdcFromEvent(event) {
    if (!event || !dom.canvas) {
      return;
    }
    var rect = dom.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }
    pointerNdc.set(
      clamp((event.clientX - rect.left) / rect.width * 2 - 1, -1, 1),
      clamp(-((event.clientY - rect.top) / rect.height * 2 - 1), -1, 1)
    );
    lastCanvasPointerNdc.copy(pointerNdc);
  }

  function pointerIsInsideCanvas(event) {
    if (!event || !dom.canvas) {
      return false;
    }
    var rect = dom.canvas.getBoundingClientRect();
    return event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
  }

  function updateCrosshairFromPointer() {
    if (!dom.crosshair || !dom.canvas) {
      return;
    }
    dom.crosshair.style.left = (clamp(pointerNdc.x * 0.5 + 0.5, 0, 1) * 100) + '%';
    dom.crosshair.style.top = (clamp(-pointerNdc.y * 0.5 + 0.5, 0, 1) * 100) + '%';
  }

  function syncAimFromEvent(event, doPointerSync) {
    if (!event) {
      return;
    }
    if (pointerIsInsideCanvas(event)) {
      updatePointerNdcFromEvent(event);
      if (doPointerSync !== false) {
        updateCrosshairFromPointer();
      }
    }
  }

  function resolveShotRay(event) {
    if (event) {
      syncAimFromEvent(event, true);
    } else {
      pointerNdc.copy(lastCanvasPointerNdc);
    }
    raycaster.setFromCamera(pointerNdc, camera);
    return {
      origin: raycaster.ray.origin.clone(),
      direction: raycaster.ray.direction.clone().normalize()
    };
  }

  function getTargetCenterPoint() {
    if (!state.modelGroup) {
      return null;
    }
    var box = new THREE.Box3().setFromObject(state.modelGroup);
    return box.getCenter(new THREE.Vector3());
  }

  function resolveShotOriginFromAim(aim, shooter) {
    if (!aim || !aim.origin || !aim.direction || !aim.direction.isVector3) {
      return null;
    }
    var launchDistance = shooter && Number.isFinite(shooter.muzzleDistance) ? shooter.muzzleDistance : 0.18;
    launchDistance = clamp(launchDistance, 0.06, 0.42);
    return aim.origin.clone().add(aim.direction.clone().normalize().multiplyScalar(launchDistance));
  }

  function deg(value) {
    return value * 180 / Math.PI;
  }

  function prettyPartLabel(part) {
    return part.label || part.id;
  }

  function normalizeYawDeg(value) {
    var yaw = Number(value);
    if (!Number.isFinite(yaw)) {
      yaw = 0;
    }
    yaw = yaw % 360;
    if (yaw < 0) {
      yaw += 360;
    }
    return yaw;
  }

  function isTurretPart(part) {
    if (!part) {
      return false;
    }
    if (part.turret === true) {
      return true;
    }
    if (part.sourceTag) {
      return /turret|gun|breech|gunner|loader|drive_turret/i.test(part.sourceTag);
    }
    return /^(?:turret_|mantlet|barrel|breech|gunner|loader)/i.test(part.id || '');
  }

  function getTurretPivot(target) {
    if (target && Array.isArray(target.turretPivot) && target.turretPivot.length >= 3) {
      return new THREE.Vector3(target.turretPivot[0], target.turretPivot[1], target.turretPivot[2]);
    }
    for (var i = 0; i < target.parts.length; i += 1) {
      var part = target.parts[i];
      if (part.id === 'turret_ring' || /turret_ring/i.test(part.sourceTag || '')) {
        return new THREE.Vector3(part.position[0], part.position[1], part.position[2]);
      }
    }
    return new THREE.Vector3(0.12, 1.02, 0);
  }

  function applyTargetFacing() {
    if (!state.modelGroup) {
      return;
    }
    state.modelGroup.rotation.y = state.targetYaw * DEG;
    if (state.turretGroup) {
      state.turretGroup.rotation.y = state.turretYaw * DEG;
      state.turretGroup.position.copy(state.turretPivot || new THREE.Vector3());
    }
    if (state.visualTurretGroup) {
      state.visualTurretGroup.rotation.y = state.turretYaw * DEG;
      state.visualTurretGroup.position.copy(state.turretPivot || new THREE.Vector3());
    }
    if (state.xrayTurretGroup) {
      state.xrayTurretGroup.rotation.y = state.turretYaw * DEG;
      state.xrayTurretGroup.position.copy(state.turretPivot || new THREE.Vector3());
    }
    state.modelGroup.updateMatrixWorld(true);
  }

  function shooterById(id) {
    for (var i = 0; i < DATA.shooters.length; i += 1) {
      if (DATA.shooters[i].id === id) {
        return DATA.shooters[i];
      }
    }
    return DATA.shooters[0] || null;
  }

  function targetById(id) {
    for (var i = 0; i < DATA.targets.length; i += 1) {
      if (DATA.targets[i].id === id) {
        return DATA.targets[i];
      }
    }
    return DATA.targets[0] || null;
  }

  function colorForKind(kind) {
    if (kind === 'ammo') { return '#f48f4e'; }
    if (kind === 'crew') { return '#7fd2db'; }
    if (kind === 'mechanical') { return '#6fd08c'; }
    if (kind === 'weapon') { return '#d7846b'; }
    if (kind === 'subsystem') { return '#d6b15a'; }
    if (kind === 'armor') { return '#a58d73'; }
    return '#8fa3b8';
  }

  function baseOpacityForPart(part) {
    if (state.visualModelLoaded && !state.xray) {
      if (part.kind === 'visual') { return 0.0; }
      if (part.kind === 'armor') { return 0.02; }
      return 0.04;
    }
    if (state.xray) {
      if (part.kind === 'armor') { return 0.22; }
      if (part.kind === 'visual') { return 0.14; }
      return 0.9;
    }
    if (part.kind === 'armor') { return 0.86; }
    if (part.kind === 'visual') { return 0.25; }
    return 0.4;
  }

  function renderOrderForPart(part) {
    if (part.kind === 'visual') { return 0; }
    if (part.kind === 'armor') { return 1; }
    return 2;
  }

  function setButtonState() {
    dom.xrayButton.setAttribute('aria-pressed', String(state.xray));
    dom.xrayButton.textContent = state.xray ? 'X-ray 开' : 'X-ray';
  }

  function populateSelect(select, items, value) {
    clearNode(select);
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      var option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.label;
      if (item.id === value) {
        option.selected = true;
      }
      select.appendChild(option);
    }
  }

  function updateRangeLabels() {
    dom.rangeOutput.value = String(state.range) + ' m';
    dom.rangeOutput.textContent = String(state.range) + ' m';
  }

  function updateSelectors() {
    state.shooterId = shooterById(state.shooterId).id;
    state.targetId = targetById(state.targetId).id;
    populateSelect(dom.shooterSelect, DATA.shooters, state.shooterId);
    populateSelect(dom.targetSelect, DATA.targets, state.targetId);
    dom.targetYawSelect.value = String(state.targetYaw);
    dom.turretYawSelect.value = String(state.turretYaw);
    updateRangeLabels();
    setButtonState();
  }

  function resetOrbitFromTarget(target) {
    var cameraPreset = target && target.camera ? target.camera : null;
    state.orbit.radius = cameraPreset && cameraPreset.radius ? cameraPreset.radius : 11.6;
    state.orbit.theta = cameraPreset && cameraPreset.theta ? cameraPreset.theta : 0.84;
    state.orbit.phi = cameraPreset && cameraPreset.phi ? cameraPreset.phi : 0.58;
  }

  function createMaterial(part) {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(part.color || colorForKind(part.kind)),
      roughness: part.kind === 'armor' ? 0.95 : 0.74,
      metalness: part.kind === 'armor' ? 0.03 : 0.08,
      transparent: true,
      opacity: 1,
      side: THREE.FrontSide,
      emissive: 0x000000,
      emissiveIntensity: 0.4
    });
  }

  function createGeometry(part) {
    if (part.shape === 'cylinder') {
      return new THREE.CylinderGeometry(
        part.radiusTop || 0.5,
        part.radiusBottom || 0.5,
        part.height || 1,
        part.radialSegments || 10,
        1,
        false
      );
    }
    return new THREE.BoxGeometry(
      part.size[0],
      part.size[1],
      part.size[2]
    );
  }

  function ensurePartState(part) {
    if (!state.partStates.has(part.id)) {
      state.partStates.set(part.id, {
        hp: typeof part.maxHp === 'number' ? part.maxHp : 100,
        maxHp: typeof part.maxHp === 'number' ? part.maxHp : 100,
        hitCount: 0,
        destroyed: false
      });
    }
    return state.partStates.get(part.id);
  }

  function buildTargetModel(target) {
    clearEffects();
    clearVisualModel();
    clearXrayModel();
    while (modelRoot.children.length) {
      var child = modelRoot.children[0];
      modelRoot.remove(child);
      disposeObject(child);
    }
    state.partMeshes = [];
    state.partStates.clear();

    var targetGroup = new THREE.Group();
    targetGroup.name = 'target-' + target.id;
    state.targetYaw = normalizeYawDeg(typeof target.yaw === 'number' ? target.yaw : state.targetYaw);
    state.turretYaw = normalizeYawDeg(typeof target.turretYaw === 'number' ? target.turretYaw : state.turretYaw);
    state.turretPivot = getTurretPivot(target);
    targetGroup.rotation.y = state.targetYaw * DEG;

    var hullGroup = new THREE.Group();
    hullGroup.name = target.id + '-hull';
    var turretGroup = new THREE.Group();
    turretGroup.name = target.id + '-turret';
    turretGroup.position.copy(state.turretPivot);
    state.hullGroup = hullGroup;
    state.turretGroup = turretGroup;

    for (var i = 0; i < target.parts.length; i += 1) {
      var part = target.parts[i];
      var geometry = createGeometry(part);
      var material = createMaterial(part);
      var mesh = new THREE.Mesh(geometry, material);

      mesh.position.set(part.position[0], part.position[1], part.position[2]);
      mesh.rotation.set(part.rotation[0], part.rotation[1], part.rotation[2]);
      mesh.renderOrder = renderOrderForPart(part);
      mesh.userData.part = part;
      mesh.userData.kind = part.kind;
      mesh.userData.baseColor = new THREE.Color(part.color || colorForKind(part.kind));
      mesh.userData.baseOpacity = baseOpacityForPart(part);

      if (isTurretPart(part)) {
        mesh.position.set(
          part.position[0] - state.turretPivot.x,
          part.position[1] - state.turretPivot.y,
          part.position[2] - state.turretPivot.z
        );
        turretGroup.add(mesh);
      } else {
        hullGroup.add(mesh);
      }
      state.partMeshes.push(mesh);
      ensurePartState(part);
    }

    targetGroup.add(hullGroup);
    targetGroup.add(turretGroup);
    modelRoot.add(targetGroup);
    state.modelGroup = targetGroup;
    applyTargetFacing();
    state.target = target;
    state.lastShot = null;

    var box = new THREE.Box3().setFromObject(targetGroup);
    var center = box.getCenter(new THREE.Vector3());
    var size = box.getSize(new THREE.Vector3());

    state.orbit.target.copy(center);
    state.orbit.target.y += Math.max(0.2, size.y * 0.04);
    if (!(target.camera && target.camera.radius)) {
      state.orbit.radius = Math.max(size.x, size.y, size.z) * 2.15;
    }

    syncMaterials();
    updateModulePanel();
    updateResultPanel(null);
    updateSourcePanel(target);
    updateOverlay();
    loadVisualModel(target);
    loadXrayModel(target);
  }

  function disposeObject(object) {
    if (!object) {
      return;
    }
    var geometries = [];
    var materials = [];
    object.traverse(function (child) {
      if (child.geometry && geometries.indexOf(child.geometry) === -1) {
        geometries.push(child.geometry);
      }
      if (child.material) {
        if (Array.isArray(child.material)) {
          for (var i = 0; i < child.material.length; i += 1) {
            if (materials.indexOf(child.material[i]) === -1) {
              materials.push(child.material[i]);
            }
          }
        } else if (materials.indexOf(child.material) === -1) {
          materials.push(child.material);
        }
      }
    });
    for (var gi = 0; gi < geometries.length; gi += 1) {
      geometries[gi].dispose();
    }
    for (var mi = 0; mi < materials.length; mi += 1) {
      materials[mi].dispose();
    }
  }

  function clearVisualModel() {
    state.visualModelToken += 1;
    state.visualModelLoaded = false;

    if (state.visualModelGroup && state.visualModelGroup.parent) {
      state.visualModelGroup.parent.remove(state.visualModelGroup);
    }
    if (state.visualModelGroup) {
      disposeObject(state.visualModelGroup);
    }

    state.visualModelGroup = null;
    state.visualTurretGroup = null;
    state.visualMaterials = [];
  }

  function clearXrayModel() {
    state.xrayModelToken += 1;
    state.xrayModelLoaded = false;

    if (state.xrayModelGroup && state.xrayModelGroup.parent) {
      state.xrayModelGroup.parent.remove(state.xrayModelGroup);
    }
    if (state.xrayModelGroup) {
      disposeObject(state.xrayModelGroup);
    }

    state.xrayModelGroup = null;
    state.xrayTurretGroup = null;
    state.xrayMaterials = [];
  }

  function updateVisualModelAppearance() {
    if (!state.visualMaterials || !state.visualMaterials.length) {
      return;
    }

    for (var i = 0; i < state.visualMaterials.length; i += 1) {
      var material = state.visualMaterials[i];
      if (!material) {
        continue;
      }

      var baseOpacity = typeof material.userData.baseOpacity === 'number' ? material.userData.baseOpacity : 1;
      var baseTransparent = !!material.userData.baseTransparent;

      material.transparent = state.xray || baseTransparent || baseOpacity < 1;
      material.opacity = state.xray ? 0.22 : baseOpacity;
      material.depthWrite = !state.xray && !baseTransparent;
      material.needsUpdate = true;
    }
  }

  function updateXrayModelAppearance() {
    if (state.xrayModelGroup) {
      state.xrayModelGroup.visible = !!(state.xray && state.xrayModelLoaded);
    }
    for (var i = 0; i < state.xrayMaterials.length; i += 1) {
      var material = state.xrayMaterials[i];
      if (!material) {
        continue;
      }
      material.transparent = true;
      material.opacity = state.xray ? 0.9 : 0;
      material.depthTest = false;
      material.depthWrite = false;
      material.needsUpdate = true;
    }
  }

  function resolveRelativeUrl(baseUrl, ref) {
    if (!ref) {
      return '';
    }
    if (/^(?:https?:)?\/\//i.test(ref) || ref.indexOf('data:') === 0 || ref.indexOf('blob:') === 0) {
      return ref;
    }
    return baseUrl + ref.replace(/^\.\//, '');
  }

  function extractTextureToken(line) {
    var parts = line.trim().split(/\s+/);
    for (var i = parts.length - 1; i >= 1; i -= 1) {
      if (parts[i] && parts[i].charAt(0) !== '-') {
        return parts[i];
      }
    }
    return null;
  }

  function parseMtlLibrary(text, baseUrl) {
    var defs = Object.create(null);
    var order = [];
    var current = null;
    var lines = text.split(/\r?\n/);

    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i].trim();
      if (!line || line.charAt(0) === '#') {
        continue;
      }

      if (line.indexOf('newmtl ') === 0) {
        var name = line.slice(7).trim();
        if (!defs[name]) {
          current = {
            name: name,
            mapKd: null,
            mapBump: null,
            mapKs: null,
            mapPr: null,
            mapPm: null,
            mapKa: null,
            specularPower: null,
            roughness: null,
            metalness: null,
            specColor: [1, 1, 1],
            opacity: 1,
            transparent: false
          };
          defs[name] = current;
          order.push(name);
        } else {
          current = defs[name];
        }
        continue;
      }

      if (!current) {
        continue;
      }

      if (line.indexOf('map_Kd ') === 0) {
        var diffuseToken = extractTextureToken(line);
        if (diffuseToken) {
          current.mapKd = resolveRelativeUrl(baseUrl, diffuseToken);
        }
        continue;
      }

      if (line.indexOf('map_Ks ') === 0) {
        var specularToken = extractTextureToken(line);
        if (specularToken) {
          current.mapKs = resolveRelativeUrl(baseUrl, specularToken);
        }
        continue;
      }

      if (line.indexOf('Ks ') === 0) {
        var specColorParts = line.slice(3).trim().split(/\s+/);
        if (specColorParts.length >= 3) {
          var sr = Number(specColorParts[0]);
          var sg = Number(specColorParts[1]);
          var sb = Number(specColorParts[2]);
          if (Number.isFinite(sr) && Number.isFinite(sg) && Number.isFinite(sb)) {
            current.specColor = [sr, sg, sb];
          }
        }
        continue;
      }

      if (line.indexOf('Ns ') === 0) {
        var specularPower = parseFloat(line.slice(3));
        if (Number.isFinite(specularPower)) {
          current.specularPower = specularPower;
        }
        continue;
      }

      if (line.indexOf('map_Pr ') === 0) {
        var roughnessToken = extractTextureToken(line);
        if (roughnessToken) {
          current.mapPr = resolveRelativeUrl(baseUrl, roughnessToken);
        }
        continue;
      }

      if (line.indexOf('map_Pm ') === 0) {
        var metallicToken = extractTextureToken(line);
        if (metallicToken) {
          current.mapPm = resolveRelativeUrl(baseUrl, metallicToken);
        }
        continue;
      }

      if (line.indexOf('map_Ka ') === 0) {
        var emissiveMapToken = extractTextureToken(line);
        if (emissiveMapToken) {
          current.mapKa = resolveRelativeUrl(baseUrl, emissiveMapToken);
        }
        continue;
      }

      if (line.indexOf('map_bump ') === 0 || line.indexOf('map_Bump ') === 0 || line.indexOf('bump ') === 0) {
        var normalToken = extractTextureToken(line);
        if (normalToken) {
          current.mapBump = resolveRelativeUrl(baseUrl, normalToken);
        }
        continue;
      }

      if (line.indexOf('d ') === 0) {
        var opacity = parseFloat(line.slice(2));
        if (Number.isFinite(opacity)) {
          current.opacity = clamp(opacity, 0, 1);
          current.transparent = opacity < 1;
        }
        continue;
      }

      if (line.indexOf('Tr ') === 0) {
        var transparency = parseFloat(line.slice(3));
        if (Number.isFinite(transparency)) {
          current.opacity = clamp(1 - transparency, 0, 1);
          current.transparent = transparency > 0;
        }
      }
    }

    return {
      defs: defs,
      order: order
    };
  }

  function loadVisualTexture(url, isNormal) {
    if (!url) {
      return Promise.resolve(null);
    }
    var isNormalMap = isNormal === 'normal';
    var isRoughnessMap = isNormal === 'roughness';
    var isMetalnessMap = isNormal === 'metalness';
    var isAoMap = isNormal === 'ao';
    var cacheKey = url + '|' + (isNormal || 'color');
    if (state.visualTextureCache[cacheKey]) {
      return state.visualTextureCache[cacheKey];
    }

    state.visualTextureCache[cacheKey] = new Promise(function (resolve) {
      var loader = new THREE.TextureLoader();
      loader.load(url, function (texture) {
        texture.flipY = false;
        texture.colorSpace = isNormalMap || isRoughnessMap || isMetalnessMap || isAoMap ? THREE.NoColorSpace : THREE.SRGBColorSpace;
        if (renderer && renderer.capabilities && renderer.capabilities.getMaxAnisotropy) {
          texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
        texture.needsUpdate = true;
        resolve(texture);
      }, undefined, function () {
        resolve(null);
      });
    });

    return state.visualTextureCache[cacheKey];
  }

  function loadTextAsset(url) {
    if (!url) {
      return Promise.reject(new Error('Missing asset url'));
    }
    return fetch(url).then(function (response) {
      if (!response.ok) {
        throw new Error('Failed to load ' + url + ': ' + response.status);
      }
      return response.text();
    }).catch(function () {
      if (typeof XMLHttpRequest === 'undefined') {
        return Promise.reject(new Error('Failed to load ' + url));
      }
      return new Promise(function (resolve, reject) {
        var request = new XMLHttpRequest();
        request.open('GET', url, true);
        request.onreadystatechange = function () {
          if (request.readyState !== 4) {
            return;
          }
          if (request.status === 200 || request.status === 0) {
            resolve(request.responseText || '');
          } else {
            reject(new Error('Failed to load ' + url + ': ' + request.status));
          }
        };
        request.onerror = function () {
          reject(new Error('Failed to load ' + url));
        };
        request.send();
      });
    });
  }

  function defaultVisualMaterialDef(name) {
    return {
      name: name,
      mapKd: null,
      mapBump: null,
      mapKs: null,
      mapPr: null,
      mapPm: null,
      mapKa: null,
      specularPower: null,
      roughness: null,
      metalness: null,
      specColor: [1, 1, 1],
      opacity: 1,
      transparent: false
    };
  }

  function visualTextureKeyForMaterial(name) {
    var materialName = String(name || '').toLowerCase();
    if (materialName.indexOf('headlight_glass') !== -1) {
      return 'glass';
    }
    if (materialName.indexOf('rifled_barrel') !== -1) {
      return 'barrel';
    }
    if (materialName.indexOf('attch_t_34_track') !== -1) {
      return 'trackAttachment';
    }
    if (materialName.indexOf('track') !== -1) {
      return 'track';
    }
    if (materialName.indexOf('mg_dt') !== -1 || materialName.indexOf('machine_gun') !== -1) {
      return 'mg';
    }
    if (materialName.indexOf('gun') !== -1 || materialName.indexOf('barrel') !== -1) {
      return 'gun';
    }
    if (materialName.indexOf('turret') !== -1 || materialName.indexOf('hatch') !== -1) {
      return 'turret';
    }
    return 'body';
  }

  function manualVisualDefinition(key) {
    var definition = defaultVisualMaterialDef(key);
    definition.roughness = key === 'glass' ? 0.22 : (key === 'track' || key === 'trackAttachment' ? 0.92 : 0.78);
    definition.metalness = key === 'glass' ? 0.12 : 0.24;
    definition.transparent = key === 'glass';
    definition.opacity = key === 'glass' ? 0.72 : 1;
    return definition;
  }

  function loadTargetVisualTextures(target) {
    var root = String(target.visualTextureRoot || '');
    if (!root) {
      return Promise.resolve(null);
    }
    if (root.charAt(root.length - 1) !== '/') {
      root += '/';
    }

    var files = {
      body: ['t_34_1941_body_c.png', 't_34_1941_body_n.png'],
      turret: ['t_34_1941_turret_c.png', 't_34_1941_turret_n.png'],
      gun: ['t_34_1941_gun_c.png', 't_34_1941_gun_n.png'],
      mg: ['ussr_mg_dt_c.png', 'ussr_mg_dt_n.png'],
      track: ['ussr_t_34_1941_track_c.png', 'ussr_t_34_1941_track_n.png'],
      trackAttachment: ['attch_t_34_track_c.png', 'ussr_t_34_1941_track_n.png'],
      barrel: ['rifled_barrel_a_c.png', 'rifled_barrel_a_n.png'],
      glass: ['headlight_glass_c.png', 'headlight_glass_n.png']
    };
    var keys = Object.keys(files);
    var promises = [];

    for (var i = 0; i < keys.length; i += 1) {
      (function (key) {
        var pair = files[key];
        promises.push(Promise.all([
          loadVisualTexture(root + pair[0]),
          loadVisualTexture(root + pair[1], 'normal')
        ]).then(function (textures) {
          return {
            key: key,
            diffuse: textures[0],
            normal: textures[1]
          };
        }));
      })(keys[i]);
    }

    return Promise.all(promises).then(function (items) {
      var textureSet = Object.create(null);
      for (var i = 0; i < items.length; i += 1) {
        textureSet[items[i].key] = items[i];
      }
      return textureSet;
    });
  }

  function createVisualMaterial(name, def, diffuseMap, normalMap, specularMap, roughnessMap, metalnessMap, emissiveMap) {
    var avgSpec = 1;
    if (Array.isArray(def.specColor)) {
      avgSpec = clamp((def.specColor[0] + def.specColor[1] + def.specColor[2]) / 3, 0, 1);
      avgSpec = clamp(avgSpec, 0, 2);
    }
    var roughnessFromPower = Number.isFinite(def.specularPower) ? clamp(1 - Math.pow(clamp(def.specularPower, 0, 1000) / 1000, 0.85), 0.04, 1) : null;
    var roughness = typeof def.roughness === 'number' ? clamp(def.roughness, 0, 1) : (roughnessFromPower !== null ? roughnessFromPower : 0.78);
    if (roughness > 0.95 && avgSpec > 0.6) {
      roughness = 0.75;
    }
    var metallicBase = /steel|metal|turret|track|gun|barrel|hull/i.test(name) ? 0.32 : 0.06;

    var transparentHint = !!def.transparent || /glass|window|lens/i.test(name);
    var opacity = typeof def.opacity === 'number' ? def.opacity : 1;
    if (transparentHint && opacity > 0.7) {
      opacity = 0.7;
    }

    var material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: roughness,
      metalness: metallicBase,
      side: THREE.DoubleSide,
      transparent: transparentHint || opacity < 1,
      opacity: opacity,
      emissive: 0x000000,
      emissiveIntensity: 0,
      envMapIntensity: 0.55
    });

    material.name = name;
    material.userData.baseOpacity = opacity;
    material.userData.baseTransparent = transparentHint || opacity < 1;
    material.userData.baseDepthWrite = !material.userData.baseTransparent;

    if (diffuseMap) {
      material.map = diffuseMap;
      material.userData.hasColorMap = true;
    }
    if (normalMap) {
      material.normalMap = normalMap;
      material.normalScale = new THREE.Vector2(1, 1);
    }
    if (specularMap) {
      material.roughnessMap = specularMap;
      material.roughness = Math.max(0.14, roughness * 0.85);
    }
    if (roughnessMap) {
      material.roughnessMap = roughnessMap;
    }
    if (metalnessMap) {
      material.metalnessMap = metalnessMap;
    }
    if (emissiveMap) {
      material.emissiveMap = emissiveMap;
      material.emissive = new THREE.Color(0x222222);
      material.emissiveIntensity = 0.22;
      material.aoMap = emissiveMap;
    }
    material.roughness = clamp(material.roughness, 0.02, 1);
    material.metalness = clamp(material.metalness * (0.7 + avgSpec * 0.3) + avgSpec * 0.12, 0, 1);

    material.needsUpdate = true;
    return material;
  }

  function parseObjModel(text) {
    var vertices = [];
    var texcoords = [];
    var normals = [];
    var positions = [];
    var uvs = [];
    var normalValues = [];
    var groups = [];
    var materialNames = [];
    var materialIndexByName = Object.create(null);
    var currentMaterial = '__default__';
    var currentObjectName = '__root__';
    var currentGroupStart = 0;
    var currentGroupCount = 0;
    var allNormalsPresent = true;

    function ensureMaterialName(name) {
      var key = name || '__default__';
      if (typeof materialIndexByName[key] === 'undefined') {
        materialIndexByName[key] = materialNames.length;
        materialNames.push(key);
      }
      return materialIndexByName[key];
    }

    function resolveIndex(raw, count) {
      var idx = Number(raw);
      if (!Number.isFinite(idx) || idx === 0) {
        return null;
      }
      return idx < 0 ? count + idx : idx - 1;
    }

    function flushGroup() {
      if (currentGroupCount > 0) {
        groups.push({
          start: currentGroupStart,
          count: currentGroupCount,
          material: currentMaterial || '__default__',
          object: currentObjectName
        });
        currentGroupStart += currentGroupCount;
        currentGroupCount = 0;
      }
    }

    function pushCorner(ref) {
      var parts = ref.split('/');
      var vi = resolveIndex(parts[0], vertices.length);
      if (vi === null || vi < 0 || vi >= vertices.length) {
        return;
      }

      var vertex = vertices[vi];
      positions.push(vertex[0], vertex[1], vertex[2]);

      var ti = parts.length > 1 && parts[1] ? resolveIndex(parts[1], texcoords.length) : null;
      if (ti !== null && ti >= 0 && ti < texcoords.length) {
        var uv = texcoords[ti];
        uvs.push(uv[0], 1 - uv[1]);
      } else {
        uvs.push(0, 0);
      }

      var ni = parts.length > 2 && parts[2] ? resolveIndex(parts[2], normals.length) : null;
      if (ni !== null && ni >= 0 && ni < normals.length) {
        var normal = normals[ni];
        normalValues.push(normal[0], normal[1], normal[2]);
      } else {
        normalValues.push(0, 0, 0);
        allNormalsPresent = false;
      }
    }

    var lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i].trim();
      if (!line || line.charAt(0) === '#') {
        continue;
      }

      if (line.indexOf('v ') === 0) {
        var vertexParts = line.split(/\s+/);
        vertices.push([
          Number(vertexParts[1]),
          Number(vertexParts[2]),
          Number(vertexParts[3])
        ]);
        continue;
      }

      if (line.indexOf('vt ') === 0) {
        var uvParts = line.split(/\s+/);
        texcoords.push([
          Number(uvParts[1]),
          Number(uvParts[2])
        ]);
        continue;
      }

      if (line.indexOf('vn ') === 0) {
        var normalParts = line.split(/\s+/);
        normals.push([
          Number(normalParts[1]),
          Number(normalParts[2]),
          Number(normalParts[3])
        ]);
        continue;
      }

      if (line.indexOf('usemtl ') === 0) {
        var nextMaterial = line.slice(7).trim() || '__default__';
        ensureMaterialName(nextMaterial);
        if (nextMaterial !== currentMaterial) {
          flushGroup();
          currentMaterial = nextMaterial;
        }
        continue;
      }

      if (line.indexOf('g ') === 0 || line.indexOf('o ') === 0) {
        flushGroup();
        currentObjectName = line.slice(2).trim() || '__root__';
        continue;
      }

      if (line.indexOf('f ') === 0) {
        var refs = line.slice(2).trim().split(/\s+/);
        if (refs.length < 3) {
          continue;
        }

        if (!currentMaterial) {
          currentMaterial = '__default__';
          ensureMaterialName(currentMaterial);
        }

        for (var j = 1; j < refs.length - 1; j += 1) {
          pushCorner(refs[0]);
          pushCorner(refs[j]);
          pushCorner(refs[j + 1]);
          currentGroupCount += 3;
        }
      }
    }

    flushGroup();

    if (materialNames.length === 0) {
      materialNames.push('__default__');
      materialIndexByName.__default__ = 0;
    }

    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    if (allNormalsPresent) {
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normalValues, 3));
    } else {
      geometry.computeVertexNormals();
    }

    for (var g = 0; g < groups.length; g += 1) {
      var group = groups[g];
      geometry.addGroup(group.start, group.count, materialIndexByName[group.material]);
    }

    var objects = Object.create(null);
    for (var oi = 0; oi < groups.length; oi += 1) {
      var objectGroup = groups[oi];
      var objectName = objectGroup.object || '__root__';
      if (!objects[objectName]) {
        objects[objectName] = [];
      }
      objects[objectName].push(objectGroup);
    }

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    return {
      geometry: geometry,
      materialNames: materialNames,
      objects: objects
    };
  }

  function parseObjGeometry(text) {
    var vertices = [];
    var positions = [];

    function resolveIndex(raw, count) {
      var idx = Number(raw);
      if (!Number.isFinite(idx) || idx === 0) {
        return null;
      }
      return idx < 0 ? count + idx : idx - 1;
    }

    function pushVertex(ref) {
      var parts = ref.split('/');
      var vi = resolveIndex(parts[0], vertices.length);
      if (vi === null || vi < 0 || vi >= vertices.length) {
        return;
      }

      var vertex = vertices[vi];
      positions.push(vertex[0], vertex[1], vertex[2]);
    }

    var lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i];
      if (!line || line.length < 2) {
        continue;
      }

      if (line[0] === 'v' && line[1] === ' ') {
        var vertexParts = line.trim().split(/\s+/);
        vertices.push([
          Number(vertexParts[1]),
          Number(vertexParts[2]),
          Number(vertexParts[3])
        ]);
      } else if (line[0] === 'f' && line[1] === ' ') {
        var refs = line.slice(2).trim().split(/\s+/);
        if (refs.length < 3) {
          continue;
        }

        for (var j = 1; j < refs.length - 1; j += 1) {
          pushVertex(refs[0]);
          pushVertex(refs[j]);
          pushVertex(refs[j + 1]);
        }
      }
    }

    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  function loadVisualModel(target) {
    if (!target || !target.visualModel || !state.modelGroup) {
      return;
    }

    clearVisualModel();

    var token = state.visualModelToken;
    var modelUrl = target.visualModel;
    var mtlUrl = modelUrl.replace(/\.obj$/i, '.mtl');
    var baseUrl = modelUrl.slice(0, modelUrl.lastIndexOf('/') + 1);

    Promise.all([
      loadTextAsset(modelUrl),
      loadTextAsset(mtlUrl)
    ]).then(function (payload) {
      if (token !== state.visualModelToken || state.target !== target || !state.modelGroup) {
        return null;
      }

      var objData = parseObjModel(payload[0]);
      var mtlData = parseMtlLibrary(payload[1], baseUrl);
      var textureSetPromise = target.visualTextureRoot ? loadTargetVisualTextures(target) : Promise.resolve(null);

      return textureSetPromise.then(function (textureSet) {
        var materialPromises = [];

        for (var i = 0; i < objData.materialNames.length; i += 1) {
          (function (name) {
            if (textureSet) {
              var textureKey = visualTextureKeyForMaterial(name);
              var textureItem = textureSet[textureKey] || textureSet.body;
              var manualDef = manualVisualDefinition(textureKey);
              materialPromises.push(Promise.resolve(createVisualMaterial(
                name,
                manualDef,
                textureItem && textureItem.diffuse,
                textureItem && textureItem.normal,
                null,
                null,
                null,
                null
              )));
              return;
            }

            var def = mtlData.defs[name] || defaultVisualMaterialDef(name);
            materialPromises.push(
              Promise.all([
                loadVisualTexture(def.mapKd),
                loadVisualTexture(def.mapBump, 'normal'),
                loadVisualTexture(def.mapKs, 'roughness'),
                loadVisualTexture(def.mapPr, 'roughness'),
                loadVisualTexture(def.mapPm, 'metalness'),
                loadVisualTexture(def.mapKa, 'ao')
              ]).then(function (textures) {
                return createVisualMaterial(
                  name,
                  def,
                  textures[0],
                  textures[1],
                  textures[2],
                  textures[3],
                  textures[4],
                  textures[5]
                );
              })
            );
          })(objData.materialNames[i]);
        }

        return Promise.all(materialPromises).then(function (materials) {
          return {
            geometry: objData.geometry,
            objects: objData.objects,
            materialNames: objData.materialNames,
            materials: materials
          };
        });
      });
    }).then(function (data) {
      if (!data || token !== state.visualModelToken || state.target !== target || !state.modelGroup) {
        return;
      }

      var group = new THREE.Group();
      var offset = target.visualOffset || [0, 0, 0];
      var scale = typeof target.visualScale === 'number' ? target.visualScale : 1;

      group.name = target.id + '-visual-model';
      group.position.set(offset[0] || 0, offset[1] || 0, offset[2] || 0);
      group.scale.setScalar(scale);

      var visualHullGroup = new THREE.Group();
      var visualTurretGroup = new THREE.Group();
      var visualObjects = data.objects || Object.create(null);
      var visualObjectNames = Object.keys(visualObjects);
      var visualTurretPivot = state.turretPivot || new THREE.Vector3(0.12, 1.02, 0);
      var turretObjectPattern = /(?:^|[_-])(?:bone_turret|bone_gun|gun_barrel|bone_mg_gun_twin|hatch_01)(?:$|[_-])/i;
      var visualHullGeometry = data.geometry.clone();
      var visualTurretGeometry = data.geometry.clone();

      visualHullGeometry.clearGroups();
      visualTurretGeometry.clearGroups();
      for (var oi = 0; oi < visualObjectNames.length; oi += 1) {
        var visualObjectName = visualObjectNames[oi];
        var visualGeometry = turretObjectPattern.test(visualObjectName) ? visualTurretGeometry : visualHullGeometry;
        var visualRanges = visualObjects[visualObjectName];
        for (var ri = 0; ri < visualRanges.length; ri += 1) {
          var visualRange = visualRanges[ri];
          visualGeometry.addGroup(
            visualRange.start,
            visualRange.count,
            data.materialNames ? data.materialNames.indexOf(visualRange.material) : 0
          );
        }
      }

      var visualMaterialSet = data.materials.length === 1 ? data.materials[0] : data.materials;
      if (visualHullGeometry.groups.length) {
        var visualHullMesh = new THREE.Mesh(visualHullGeometry, visualMaterialSet);
        visualHullMesh.renderOrder = 0;
        visualHullGroup.add(visualHullMesh);
      } else {
        visualHullGeometry.dispose();
      }
      if (visualTurretGeometry.groups.length) {
        var visualTurretMesh = new THREE.Mesh(visualTurretGeometry, visualMaterialSet);
        visualTurretMesh.position.set(-visualTurretPivot.x, -visualTurretPivot.y, -visualTurretPivot.z);
        visualTurretMesh.renderOrder = 0;
        visualTurretGroup.add(visualTurretMesh);
      } else {
        visualTurretGeometry.dispose();
      }

      visualTurretGroup.position.copy(visualTurretPivot);
      group.add(visualHullGroup);
      group.add(visualTurretGroup);

      state.modelGroup.add(group);
      state.visualModelGroup = group;
      state.visualTurretGroup = visualTurretGroup;
      state.visualMaterials = data.materials;
      data.geometry.dispose();
      applyTargetFacing();
      state.visualModelLoaded = true;
      updateVisualModelAppearance();
      syncMaterials();

      var fullBox = new THREE.Box3().setFromObject(modelRoot);
      var fullCenter = fullBox.getCenter(new THREE.Vector3());
      var fullSize = fullBox.getSize(new THREE.Vector3());
      state.orbit.target.copy(fullCenter);
      state.orbit.target.y += Math.max(0.2, fullSize.y * 0.04);
    }).catch(function (error) {
      if (token === state.visualModelToken) {
        state.visualModelLoaded = false;
      }
      if (console && console.warn) {
        console.warn(error);
      }
    });
  }

  function xrayCategoryForObject(name) {
    var objectName = String(name || '').toLowerCase();
    if (objectName.indexOf('ammo_') !== -1) {
      return 'ammo';
    }
    if (/gunner|loader|driver|machine_gunner/.test(objectName)) {
      return 'crew';
    }
    if (/engine|radiator/.test(objectName)) {
      return 'mechanical';
    }
    if (objectName.indexOf('transmission') !== -1) {
      return 'transmission';
    }
    if (/gun_barrel|cannon_breech|optic_gun/.test(objectName)) {
      return 'weapon';
    }
    if (objectName.indexOf('drive_turret') !== -1) {
      return 'turret';
    }
    return 'structure';
  }

  function xrayColorForCategory(category) {
    if (category === 'ammo') { return 0xf48f4e; }
    if (category === 'crew') { return 0x79d8e8; }
    if (category === 'mechanical') { return 0x6fd08c; }
    if (category === 'transmission') { return 0xd6b15a; }
    if (category === 'weapon') { return 0xd7846b; }
    if (category === 'turret') { return 0xc77387; }
    return 0x4e82c2;
  }

  function createXrayMaterial(category) {
    var material = new THREE.MeshBasicMaterial({
      color: xrayColorForCategory(category),
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false
    });
    material.name = 'xray-' + category;
    material.userData.baseOpacity = 0.9;
    return material;
  }

  function loadXrayModel(target) {
    if (!target || !target.xrayModel || !state.modelGroup) {
      return;
    }

    clearXrayModel();
    var token = state.xrayModelToken;
    var modelUrl = target.xrayModel;

    loadTextAsset(modelUrl).then(function (text) {
      if (token !== state.xrayModelToken || state.target !== target || !state.modelGroup) {
        return null;
      }

      var data = parseObjModel(text);
      var group = new THREE.Group();
      var offset = target.visualOffset || [0, 0, 0];
      var scale = typeof target.visualScale === 'number' ? target.visualScale : 1;
      var xrayHullGroup = new THREE.Group();
      var xrayTurretGroup = new THREE.Group();
      var xrayObjects = data.objects || Object.create(null);
      var xrayObjectNames = Object.keys(xrayObjects);
      var turretPattern = /(?:gun_barrel|cannon_breech|drive_turret|optic_gun|gunner|loader)/i;
      var materialIndexByCategory = Object.create(null);
      var xrayMaterials = [];
      var hullGeometry = data.geometry.clone();
      var turretGeometry = data.geometry.clone();

      hullGeometry.clearGroups();
      turretGeometry.clearGroups();

      function ensureXrayMaterial(category) {
        if (typeof materialIndexByCategory[category] === 'number') {
          return materialIndexByCategory[category];
        }
        materialIndexByCategory[category] = xrayMaterials.length;
        xrayMaterials.push(createXrayMaterial(category));
        return materialIndexByCategory[category];
      }

      for (var oi = 0; oi < xrayObjectNames.length; oi += 1) {
        var objectName = xrayObjectNames[oi];
        var category = xrayCategoryForObject(objectName);
        var materialIndex = ensureXrayMaterial(category);
        var layerGeometry = turretPattern.test(objectName) ? turretGeometry : hullGeometry;
        var ranges = xrayObjects[objectName];
        for (var ri = 0; ri < ranges.length; ri += 1) {
          layerGeometry.addGroup(ranges[ri].start, ranges[ri].count, materialIndex);
        }
      }

      var xrayMaterialSet = xrayMaterials.length === 1 ? xrayMaterials[0] : xrayMaterials;
      if (hullGeometry.groups.length) {
        var hullMesh = new THREE.Mesh(hullGeometry, xrayMaterialSet);
        hullMesh.renderOrder = 12;
        xrayHullGroup.add(hullMesh);
      } else {
        hullGeometry.dispose();
      }
      if (turretGeometry.groups.length) {
        var turretMesh = new THREE.Mesh(turretGeometry, xrayMaterialSet);
        turretMesh.position.set(-state.turretPivot.x, -state.turretPivot.y, -state.turretPivot.z);
        turretMesh.renderOrder = 13;
        xrayTurretGroup.add(turretMesh);
      } else {
        turretGeometry.dispose();
      }

      group.name = target.id + '-xray-model';
      group.position.set(offset[0] || 0, offset[1] || 0, offset[2] || 0);
      group.scale.setScalar(scale);
      xrayTurretGroup.position.copy(state.turretPivot);
      group.add(xrayHullGroup);
      group.add(xrayTurretGroup);

      state.modelGroup.add(group);
      state.xrayModelGroup = group;
      state.xrayTurretGroup = xrayTurretGroup;
      state.xrayMaterials = xrayMaterials;
      data.geometry.dispose();
      applyTargetFacing();
      state.xrayModelLoaded = true;
      updateXrayModelAppearance();

      var fullBox = new THREE.Box3().setFromObject(modelRoot);
      var fullCenter = fullBox.getCenter(new THREE.Vector3());
      var fullSize = fullBox.getSize(new THREE.Vector3());
      state.orbit.target.copy(fullCenter);
      state.orbit.target.y += Math.max(0.2, fullSize.y * 0.04);
    }).catch(function (error) {
      if (token === state.xrayModelToken) {
        state.xrayModelLoaded = false;
      }
      if (console && console.warn) {
        console.warn(error);
      }
    });
  }

  function syncMaterials() {
    updateVisualModelAppearance();
    updateXrayModelAppearance();

    for (var i = 0; i < state.partMeshes.length; i += 1) {
      var mesh = state.partMeshes[i];
      var part = mesh.userData.part;
      var partState = ensurePartState(part);
      var material = mesh.material;
      var ratio = partState.maxHp > 0 ? partState.hp / partState.maxHp : 0;
      var baseColor = new THREE.Color(part.color || colorForKind(part.kind));
      var damaged = ratio < 0.999;
      var selected = !!(state.lastShot && state.lastShot.hitPartId === part.id);

      if (partState.destroyed || ratio <= 0) {
        baseColor.lerp(new THREE.Color(0x2f0d12), 0.65);
      } else if (ratio < 0.35) {
        baseColor.lerp(new THREE.Color(colorForKind(part.kind)), 0.15);
        baseColor.lerp(new THREE.Color(0xb84d36), 0.12);
      }

      material.color.copy(baseColor);
      // Keep damaged internals visible through the textured exterior model.
      var visibility = baseOpacityForPart(part);
      if (state.visualModelLoaded && !state.xray) {
        visibility = damaged ? (partState.destroyed ? 0.88 : 0.68) : 0;
        if (selected) {
          visibility = 0.96;
        }
      } else if (state.xrayModelLoaded && state.xray) {
        visibility = part.kind === 'armor' ? 0.04 : 0.08;
        if (selected) {
          visibility = 0.82;
        }
      }
      material.opacity = clamp(
        visibility * (damaged ? (0.72 + (1 - ratio) * 0.28) : 1),
        state.visualModelLoaded && !state.xray && !damaged ? 0.0 : 0.08,
        0.98
      );
      material.transparent = true;
      material.depthWrite = !state.xray && (!state.visualModelLoaded || damaged) && part.kind === 'armor';
      material.emissive.setHex(
        selected ? (partState.destroyed ? 0x8f2414 : 0x553811) :
        (partState.destroyed ? 0x3d0b12 : 0x000000)
      );
      material.emissiveIntensity = selected ? 1.5 : (damaged ? 0.72 : 0.38);
      material.needsUpdate = true;
    }
  }

  function updateOverlay() {
    var target = state.target || targetById(state.targetId);
    var shooter = shooterById(state.shooterId);
    var pen = computePenetration(shooter, state.range);
    dom.targetName.textContent = target ? target.label : '-';
    dom.penetrationReadout.textContent = Math.round(pen) + ' mm';
  }

  function updateSourcePanel(target) {
    if (!target) {
      return;
    }
    dom.sourceImage.src = target.xrayImage;
    dom.sourceImage.alt = target.label + ' x-ray 参考图';
    clearNode(dom.sourceTags);
    for (var i = 0; i < target.sourceNames.length; i += 1) {
      var tag = document.createElement('span');
      tag.className = 'source-tag';
      tag.textContent = target.sourceNames[i];
      dom.sourceTags.appendChild(tag);
    }
  }

  function updateModulePanel(hitPartId) {
    clearNode(dom.moduleStatus);
    if (!state.target) {
      var empty = document.createElement('p');
      empty.className = 'result-empty';
      empty.textContent = '暂无目标。';
      dom.moduleStatus.appendChild(empty);
      return;
    }
    for (var i = 0; i < state.target.parts.length; i += 1) {
      var part = state.target.parts[i];
      var partState = ensurePartState(part);
      var ratio = partState.maxHp > 0 ? partState.hp / partState.maxHp : 0;
      var item = document.createElement('div');
      var head = document.createElement('div');
      var strong = document.createElement('strong');
      var span = document.createElement('span');
      var bar = document.createElement('div');
      var fill = document.createElement('i');

      item.className = 'module-item';
      if (hitPartId && hitPartId === part.id) {
        item.className += ' is-hit';
      }
      item.title = (part.sourceTag || part.id) + ' · ' + part.kind;

      head.className = 'module-item__head';
      strong.textContent = prettyPartLabel(part);
      span.textContent = describePartStatus(part, partState);
      head.appendChild(strong);
      head.appendChild(span);

      bar.className = 'module-bar';
      fill.style.setProperty('--value', Math.round(ratio * 100) + '%');
      fill.style.setProperty('--bar-color', colorForKind(part.kind));
      bar.appendChild(fill);

      item.appendChild(head);
      item.appendChild(bar);
      dom.moduleStatus.appendChild(item);
    }
  }

  function describePartStatus(part, partState) {
    var ratio = partState.maxHp > 0 ? partState.hp / partState.maxHp : 0;
    if (part.kind === 'crew') {
      return ratio <= 0 ? '阵亡' : '存活';
    }
    if (part.kind === 'armor') {
      return Math.round((part.armorMm || 0)) + ' mm · ' + Math.round(ratio * 100) + '%';
    }
    if (part.kind === 'ammo') {
      return ratio <= 0 ? '殉爆' : Math.round(ratio * 100) + '%';
    }
    if (ratio <= 0) {
      return '摧毁';
    }
    return Math.round(ratio * 100) + '%';
  }

  function createResultRow(label, value, tone) {
    var row = document.createElement('div');
    var left = document.createElement('span');
    var right = document.createElement('strong');
    row.className = 'result-row';
    if (tone) {
      row.className += ' ' + tone;
    }
    left.textContent = label;
    right.textContent = value;
    row.appendChild(left);
    row.appendChild(right);
    return row;
  }

  function updateResultPanel(outcome) {
    clearNode(dom.resultSummary);
    if (!state.target) {
      var empty = document.createElement('p');
      empty.className = 'result-empty';
      empty.textContent = '请选择目标后开始判断。';
      dom.resultSummary.appendChild(empty);
      return;
    }

    var shooter = shooterById(state.shooterId);
    var pen = computePenetration(shooter, state.range);
    var previewArmor = getStrongestFrontArmor(state.target);
    var preview = pen > previewArmor.effectiveArmor ? '正面有机会击穿' : '正面大概率被挡住';
    var verdict = outcome ? outcome.stateText : preview;
    var verdictTone = outcome ? (outcome.penetrated ? 'result-row--ok' : 'result-row--warn') : (pen > previewArmor.effectiveArmor ? 'result-row--ok' : 'result-row--warn');

    dom.resultSummary.appendChild(createResultRow('射手', shooter ? shooter.label : '-', 'result-row--state'));
    dom.resultSummary.appendChild(createResultRow('目标', state.target.label, 'result-row--state'));
    dom.resultSummary.appendChild(createResultRow('距离', state.range + ' m', 'result-row--state'));
    dom.resultSummary.appendChild(createResultRow('估算穿深', Math.round(pen) + ' mm', 'result-row--ok'));
    dom.resultSummary.appendChild(createResultRow('判定', verdict, verdictTone));

    if (outcome) {
      dom.resultSummary.appendChild(createResultRow('命中', outcome.hitLabel || '-', 'result-row--state'));
      dom.resultSummary.appendChild(createResultRow('入射角', outcome.angleDeg.toFixed(1) + '°', 'result-row--state'));
      dom.resultSummary.appendChild(createResultRow('等效装甲', outcome.effectiveArmor.toFixed(1) + ' mm', 'result-row--state'));
      dom.resultSummary.appendChild(createResultRow('剩余穿深', outcome.remainingPenetration.toFixed(1) + ' mm', outcome.penetrated ? 'result-row--ok' : 'result-row--warn'));
      dom.resultSummary.appendChild(createResultRow('路径', outcome.pathText || '-', 'result-row--state'));
      dom.resultSummary.appendChild(createResultRow('损伤', outcome.damageText || '-', outcome.penetrated ? 'result-row--ok' : 'result-row--warn'));
      if (outcome.aftereffect) {
        dom.resultSummary.appendChild(createResultRow('后效', outcome.aftereffect, outcome.catastrophic || outcome.overpressure ? 'result-row--warn' : 'result-row--state'));
      }
    } else {
      dom.resultSummary.appendChild(createResultRow('正面装甲', Math.round(previewArmor.effectiveArmor) + ' mm', 'result-row--state'));
      dom.resultSummary.appendChild(createResultRow('状态', '等待发射', 'result-row--state'));
    }
  }

  function getStrongestFrontArmor(target) {
    var best = {
      label: '-',
      effectiveArmor: 0
    };
    for (var i = 0; i < target.parts.length; i += 1) {
      var part = target.parts[i];
      if (part.kind !== 'armor' || !part.armorMm) {
        continue;
      }
      if (part.position[0] <= 0) {
        continue;
      }
      var slope = part.rotation[2] ? Math.abs(Math.sin(part.rotation[2])) : 0;
      var angle = 24 + slope * 34;
      var effective = part.armorMm / Math.max(0.35, Math.cos((angle - 5) * DEG));
      if (effective > best.effectiveArmor) {
        best.label = prettyPartLabel(part);
        best.effectiveArmor = effective;
      }
    }
    if (!best.effectiveArmor) {
      best.effectiveArmor = 0;
    }
    return best;
  }

  function computePenetration(shooter, range) {
    if (!shooter) {
      return 0;
    }
    var profile = getShellProfile(shooter);
    var normalizedRange = clamp(Number.isFinite(range) ? range : 0, 0, profile.maxPenRange || 2500);
    return clamp(profile.pen100 * shellRangeRatio(profile, normalizedRange), 0, profile.pen100 * 1.12);
  }

  function normalizeImpactAngle(angleDeg, shooter) {
    var profile = getShellProfile(shooter);
    return clamp(angleDeg - (profile.normalizationDeg || 0), 0, 89);
  }

  function parseShellCaliber(shooter) {
    if (Number.isFinite(shooter.caliberMm)) {
      return shooter.caliberMm;
    }
    if (shooter.gun) {
      var match = String(shooter.gun).match(/(\d+)\s*mm/i);
      if (match && match[1]) {
        var parsed = Number(match[1]);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return 75;
  }

  function shellTypeProfile(shooter) {
    var shellType = String(shooter.shellType || 'APCBC').toUpperCase();
    var keys = Object.keys(SHELL_TYPE_PROFILE);
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      var profile = SHELL_TYPE_PROFILE[key];
      var aliases = profile.typeAlias || [];
      for (var j = 0; j < aliases.length; j += 1) {
        if (shellType === aliases[j]) {
          return key;
        }
      }
      if (shellType === key) {
        return key;
      }
    }
    return 'APCBC';
  }

  function getShellProfile(shooter) {
    if (!shooter) {
      return {
        type: 'APCBC',
        pen100: 100,
        dropPer100m: 0.03,
        normalizationDeg: 5,
        ricochetDeg: 72,
        caliberMm: 75,
        rangeFloor: 0.17,
        rangeDecay: 0.00034,
        angleExponent: 1.16,
        armorLossFactor: 0.78,
        shellPenLoss: 0.06,
        overmatchHardCap: 1,
        isCumulative: false,
        fillerFactor: 0,
        maxPenRange: 2500
      };
    }

    var type = shellTypeProfile(shooter);
    var base = SHELL_TYPE_PROFILE[type];
    var caliber = parseShellCaliber(shooter);
    return {
      type: type,
      pen100: Number.isFinite(shooter.pen100) ? shooter.pen100 : 100,
      dropPer100m: Number.isFinite(shooter.dropPer100m) ? shooter.dropPer100m : 0.03,
      normalizationDeg: Number.isFinite(shooter.normalizationDeg) ? shooter.normalizationDeg : 5,
      ricochetDeg: Number.isFinite(shooter.ricochetDeg) ? shooter.ricochetDeg : 72,
      caliberMm: Number.isFinite(caliber) ? caliber : 75,
      fillerFactor: Number.isFinite(shooter.fillerFactor) ? shooter.fillerFactor : 0,
      rangeFloor: 0.12,
      rangeDecay: base && Number.isFinite(base.rangeDecay) ? base.rangeDecay : 0.00034,
      angleExponent: base && Number.isFinite(base.angleExponent) ? base.angleExponent : 1.16,
      armorLossFactor: base && Number.isFinite(base.armorLossFactor) ? base.armorLossFactor : 0.78,
      shellPenLoss: base && Number.isFinite(base.shellPenLoss) ? base.shellPenLoss : 0.06,
      overmatchHardCap: base && Number.isFinite(base.overmatchHardCap) ? base.overmatchHardCap : 1,
      isCumulative: type === 'HEAT',
      maxPenRange: 2500
    };
  }

  function shellRangeRatio(profile, range) {
    if (!profile) {
      return 0;
    }
    var normalizedRange = clamp(range, 0, profile.maxPenRange || 2500);
    var r100 = normalizedRange / 100;
    var linear = 1 - (profile.dropPer100m || 0.03) * r100;
    var decayCurve = 1 / (1 + (profile.rangeDecay || 0.00034) * normalizedRange);
    var ballisticFloor = profile.rangeFloor || 0.14;
    var raw = linear * (ballisticFloor + (1 - ballisticFloor) * decayCurve);
    var caliberScale = clamp(profile.caliberMm / 75, 0.75, 1.24);
    if (profile.type === 'HEAT') {
      caliberScale = clamp(caliberScale + 0.1, 0.95, 1.35);
    }
    return clamp(raw * caliberScale, ballisticFloor, 1.05);
  }

  function impactAngleForHit(hit, rayDirection) {
    var normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    var incoming = rayDirection.clone().negate().normalize();
    var dot = clamp(normal.dot(incoming), 0, 1);
    return Math.acos(dot) / DEG;
  }

  function hasFrontFacingImpact(hit, rayDirection) {
    if (!hit || !hit.face || !hit.face.normal) {
      return true;
    }
    var incoming = rayDirection.clone().negate().normalize();
    var normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    return normal.dot(incoming) >= 0;
  }

  function effectiveArmorForPart(part, angleDeg, shooter) {
    if (!part.armorMm) {
      return 0;
    }
    var profile = getShellProfile(shooter);
    var adjustedAngle = normalizeImpactAngle(angleDeg, shooter);
    var normalized = clamp(Math.cos(adjustedAngle * DEG), 0.08, 1);
    var overmatch = Number.isFinite(profile.caliberMm) && Number.isFinite(part.armorMm) && part.armorMm > 0 ? profile.caliberMm / part.armorMm : 1;
    var overmatchFactor = clamp(1 - Math.max(0, overmatch - 1) * 0.12, profile.overmatchHardCap, 1);
    return clamp(part.armorMm / Math.pow(normalized, profile.angleExponent || 1.15) * overmatchFactor, part.armorMm, part.armorMm * 18);
  }

  function armorThicknessLossForPart(part, angleDeg) {
    if (!part.armorMm) {
      return 6;
    }
    return clamp(part.armorMm * (0.35 + clamp(Math.abs(angleDeg || 0) / 140, 0, 0.7)), 2, 100);
  }

  function partDamageForThickness(part, before, after, multiplier) {
    var maxHp = part.maxHp || 100;
    var penetrationShare = clamp((before - after) / (before || 1), 0, 1.6);
    return Math.min(maxHp, Math.max(1, maxHp * (0.05 + penetrationShare * (0.24 + (multiplier || 0) * 0.1))));
  }

  function damageForPart(part, shooter, remainingBeforeHit, remainingAfterHit, penetrated, angleDeg, profile) {
    profile = profile || getShellProfile(shooter);
    if (part.kind === 'crew') {
      return penetrated ? Math.max(1, part.maxHp || 1) : 0;
    }
    if (part.kind === 'ammo') {
      if (!penetrated) {
        return 0;
      }
      return Math.min(part.maxHp || 100, Math.max(20, Math.round((part.maxHp || 100) * (0.75 + profile.fillerFactor * 0.08))));
    }
    if (part.kind === 'armor') {
      if (!penetrated) {
        return Math.min(part.maxHp || 100, Math.max(2, remainingBeforeHit * (profile.shellPenLoss || 0.05)));
      }
      return partDamageForThickness(part, remainingBeforeHit, remainingAfterHit, 1.04);
    }
    if (part.id === 'barrel') {
      return Math.min(part.maxHp || 100, Math.max(16, partDamageForThickness(part, remainingBeforeHit, remainingAfterHit, 1.22)));
    }
    if (part.id === 'breech' || part.id === 'turret_ring') {
      return Math.min(part.maxHp || 100, Math.max(20, partDamageForThickness(part, remainingBeforeHit, remainingAfterHit, 1.28)));
    }
    if (part.id.indexOf('track') === 0) {
      return Math.min(part.maxHp || 100, Math.max(14, partDamageForThickness(part, remainingBeforeHit, remainingAfterHit, 0.72)));
    }
    if (part.kind === 'mechanical') {
      return Math.min(part.maxHp || 100, Math.max(16, partDamageForThickness(part, remainingBeforeHit, remainingAfterHit, 0.98)));
    }
    if (part.kind === 'weapon') {
      return Math.min(part.maxHp || 100, Math.max(18, partDamageForThickness(part, remainingBeforeHit, remainingAfterHit, 1.16)));
    }
    if (part.kind === 'subsystem') {
      return Math.min(part.maxHp || 100, Math.max(10, partDamageForThickness(part, remainingBeforeHit, remainingAfterHit, 0.86)));
    }
    return Math.min(part.maxHp || 100, Math.max(10, partDamageForThickness(part, remainingBeforeHit, remainingAfterHit, 0.85)));
  }

  function describeOutcome(outcome) {
    if (outcome.catastrophic) {
      return '弹药殉爆';
    }
    if (outcome.overpressure) {
      return '超压击杀';
    }
    if (outcome.penetrated && outcome.crewDead >= 3) {
      return '乘员损失严重';
    }
    if (outcome.mobilityKill) {
      return '机动受损';
    }
    if (outcome.firepowerKill) {
      return '火力受损';
    }
    if (!outcome.penetrated) {
      return outcome.ricochet ? '跳弹' : '未击穿';
    }
    return '击穿';
  }

  function summarizeDamage() {
    var crewAlive = 0;
    var tracksDead = 0;
    var mechanicalDead = 0;
    var firepowerDead = 0;
    var ammoDead = 0;

    for (var i = 0; i < state.target.parts.length; i += 1) {
      var part = state.target.parts[i];
      var ps = ensurePartState(part);
      if (part.kind === 'crew' && ps.hp > 0) {
        crewAlive += 1;
      }
      if (part.id.indexOf('track') === 0 && ps.hp <= 0) {
        tracksDead += 1;
      }
      if ((part.id === 'engine' || part.id === 'transmission' || part.id === 'radiator') && ps.hp <= 0) {
        mechanicalDead += 1;
      }
      if ((part.id === 'barrel' || part.id === 'breech' || part.id === 'turret_ring') && ps.hp <= 0) {
        firepowerDead += 1;
      }
      if (part.kind === 'ammo' && ps.hp <= 0) {
        ammoDead += 1;
      }
    }

    return {
      crewAlive: crewAlive,
      mobilityKill: tracksDead >= 2 || mechanicalDead >= 2,
      firepowerKill: firepowerDead >= 2,
      catastrophic: ammoDead > 0
    };
  }

  function findPartMesh(partId) {
    for (var i = 0; i < state.partMeshes.length; i += 1) {
      var mesh = state.partMeshes[i];
      if (mesh && mesh.userData && mesh.userData.part && mesh.userData.part.id === partId) {
        return mesh;
      }
    }
    return null;
  }

  function getPartWorldCenter(part) {
    var mesh = findPartMesh(part && part.id);
    if (!mesh) {
      return null;
    }
    mesh.updateMatrixWorld(true);
    return mesh.getWorldPosition(new THREE.Vector3());
  }

  function applyAreaDamage(center, radius, power, shooter, profile, sourcePartId, mode) {
    if (!state.target || !center || !Number.isFinite(radius) || radius <= 0 || !Number.isFinite(power) || power <= 0) {
      return [];
    }

    var affected = [];
    for (var i = 0; i < state.target.parts.length; i += 1) {
      var part = state.target.parts[i];
      if (!part || part.id === sourcePartId) {
        continue;
      }

      var partState = ensurePartState(part);
      if (partState.hp <= 0) {
        continue;
      }
      var partCenter = getPartWorldCenter(part);
      if (!partCenter) {
        continue;
      }
      var distance = partCenter.distanceTo(center);
      if (distance > radius) {
        continue;
      }

      var falloff = 1 - distance / radius;
      var kindMultiplier = 0.25;
      if (part.kind === 'crew') {
        kindMultiplier = 1.18;
      } else if (part.kind === 'ammo') {
        kindMultiplier = 1.35;
      } else if (part.id === 'barrel' || part.id === 'breech' || part.id === 'turret_ring') {
        kindMultiplier = 1.1;
      } else if (part.kind === 'mechanical') {
        kindMultiplier = 0.92;
      } else if (part.kind === 'weapon') {
        kindMultiplier = 1.0;
      } else if (part.kind === 'subsystem') {
        kindMultiplier = 0.78;
      } else if (part.kind === 'armor') {
        kindMultiplier = 0.42;
      }

      var hitPower = power * falloff * kindMultiplier;
      if (mode === 'overpressure' && part.kind === 'crew') {
        hitPower *= 1.55;
      }
      if (mode === 'ammo-burst') {
        hitPower *= 1.7;
      }

      var damage = Math.min(partState.maxHp || 100, Math.max(0, hitPower));
      if (damage <= 0) {
        continue;
      }

      partState.hp = clamp(partState.hp - damage, 0, partState.maxHp || 100);
      partState.hitCount += 1;
      partState.destroyed = partState.hp <= 0;
      affected.push({
        id: part.id,
        damage: damage
      });
    }
    return affected;
  }

  function applyPenetrationAftermath(result, part, shooter, hitPoint, remainingBeforeHit, remainingAfterHit, angleDeg, profile) {
    if (!result || !part || !hitPoint) {
      return;
    }
    profile = profile || getShellProfile(shooter);

    var filler = Number.isFinite(profile.fillerFactor) ? profile.fillerFactor : 0;
    var caliber = Number.isFinite(profile.caliberMm) ? profile.caliberMm : 75;
    var energyLoss = Math.max(0, remainingBeforeHit - remainingAfterHit);
    var burstPower = clamp(energyLoss * (0.82 + filler * 0.55) + caliber * (0.22 + filler * 0.16), 10, 180);
    var burstRadius = clamp(0.8 + filler * 1.6 + burstPower / 80, 0.85, 3.6);

    if (part.kind === 'ammo') {
      result.catastrophic = true;
      result.aftereffect = '弹药殉爆';
      result.damageText = '弹药殉爆';
      result.overpressure = false;
      result.secondaryDamage = true;
      applyAreaDamage(hitPoint, 3.4, burstPower * 2.1, shooter, profile, part.id, 'ammo-burst');
      return;
    }

    if (part.kind === 'armor' && (part.armorMm || 0) <= 20 && filler >= 0.28 && angleDeg <= 40) {
      result.overpressure = true;
      result.secondaryDamage = true;
      result.aftereffect = '超压';
      applyAreaDamage(hitPoint, burstRadius * 1.15, burstPower * 1.1, shooter, profile, part.id, 'overpressure');
      return;
    }

    if (part.kind === 'armor' || part.kind === 'weapon' || part.kind === 'mechanical') {
      result.secondaryDamage = true;
      applyAreaDamage(hitPoint, burstRadius, burstPower, shooter, profile, part.id, 'spall');
    }
  }

  function fireShot(event) {
    if (!state.target) {
      return;
    }

    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    var aim = resolveShotRay(event);

    var shooter = shooterById(state.shooterId);
    var profile = getShellProfile(shooter);
    var penetration = clamp(computePenetration(shooter, state.range), 0, profile.pen100 * 1.12);
    scene.updateMatrixWorld(true);
    if (state.modelGroup) {
      state.modelGroup.updateMatrixWorld(true);
    }
    var shotOrigin = resolveShotOriginFromAim(aim, shooter);
    if (!shotOrigin) {
      shotOrigin = aim.origin.clone();
    }
    var shotDirection = aim.direction.clone().normalize();

    raycaster.set(shotOrigin, shotDirection);
    raycaster.far = state.range > 0 ? state.range : Infinity;
    var rawHits = raycaster.intersectObjects(state.partMeshes, false);
    var hits = [];
    var fallbackHits = [];
    var seenPart = Object.create(null);

    for (var hi = 0; hi < rawHits.length; hi += 1) {
      var rawHit = rawHits[hi];
      var rawPart = rawHit && rawHit.object && rawHit.object.userData ? rawHit.object.userData.part : null;
      if (!rawPart) {
        continue;
      }
      var partKey = rawPart.id || ('part-' + hi);
      if (seenPart[partKey]) {
        continue;
      }
      seenPart[partKey] = true;
      if (rawPart.kind === 'visual') {
        fallbackHits.push(rawHit);
      } else {
        hits.push(rawHit);
      }
    }

    if (!hits.length && fallbackHits.length) {
      hits = fallbackHits;
    }
    var result = {
      shooter: shooter,
      penetration: penetration,
      remainingPenetration: penetration,
      penetrated: false,
      ricochet: false,
      catastrophic: false,
      overpressure: false,
      secondaryDamage: false,
      aftereffect: '',
      mobilityKill: false,
      firepowerKill: false,
      crewDead: 0,
      hitLabel: '-',
      pathText: '-',
      damageText: '-',
      hitPartId: null,
      angleDeg: 0,
      effectiveArmor: 0,
      hitPoint: null,
      tracerEnd: null,
      shotDirection: shotDirection.clone(),
      metalJetLength: 0,
      metalJetStrength: 0,
      metalJetStart: null,
      metalJetDirection: null,
      stateText: '未击穿'
    };

    if (!hits.length) {
      result.stateText = '未命中';
      var missDistance = state.range > 0 ? state.range : 120;
      result.hitPoint = shotOrigin.clone().add(shotDirection.clone().multiplyScalar(missDistance));
      result.tracerEnd = result.hitPoint.clone();
      result.metalJetDirection = shotDirection.clone().normalize();
      state.lastShot = result;
      updateOverlay();
      updateResultPanel(result);
      syncMaterials();
      spawnShotEffect(result, shooter, shotOrigin, shotDirection);
      return;
    }

    var remaining = penetration;
    var path = [];
    var firstImpact = null;
    var firstHitPart = null;
    var firstHitAngle = 0;
    var firstHitArmor = 0;
    var firstHitPoint = null;
    var tracerEnd = null;
    var tracedDistance = state.range > 0 ? state.range : 120;
    var hitStopped = false;
    var hasArmorPenetration = false;
    var metalJetStart = null;
    var ricochetLimit = clamp(profile.ricochetDeg || 72, 35, 88);

    for (var i = 0; i < hits.length; i += 1) {
      var hit = hits[i];
      var part = hit.object.userData.part;
      if (!part) {
        continue;
      }
      var remainingBeforeHit = remaining;
      var partState = ensurePartState(part);
      var angleDeg = impactAngleForHit(hit, raycaster.ray.direction);
      var effectiveArmor = effectiveArmorForPart(part, angleDeg, shooter);
      var penetrated = false;
      var damage = 0;
      var hitLabel = prettyPartLabel(part);
      var partLossAfter = remaining;

      if (!firstImpact) {
        firstImpact = hit.point.clone();
      }
      if (!firstHitPoint) {
        firstHitPoint = hit.point.clone();
        firstHitPart = part;
        firstHitAngle = angleDeg;
        firstHitArmor = effectiveArmor;
        result.hitLabel = hitLabel;
        result.hitPartId = part.id;
        result.angleDeg = angleDeg;
        result.effectiveArmor = effectiveArmor;
        result.hitPoint = hit.point.clone();
      }

      if (part.kind === 'armor') {
        var overmatch = Number.isFinite(profile.caliberMm) && Number.isFinite(part.armorMm) ? profile.caliberMm / part.armorMm : 1;
        var adaptiveRicochetDeg = clamp(ricochetLimit + Math.min(8, (overmatch - 1) * 10), 45, 87);
        var canRicochet = profile.type !== 'HEAT' && angleDeg >= adaptiveRicochetDeg && remaining < effectiveArmor * 0.55;

        if (canRicochet) {
          result.ricochet = true;
          damage = damageForPart(part, shooter, remaining, remaining, false, angleDeg, profile);
          partState.hp = clamp(partState.hp - damage, 0, partState.maxHp || 100);
          partState.hitCount += 1;
          partState.destroyed = partState.hp <= 0;
          path.push(hitLabel + '（跳弹）');
          remaining = 0;
          result.remainingPenetration = 0;
          result.stateText = '跳弹';
          result.damageText = describePartStatus(part, partState);
          tracedDistance = hit.distance;
          hitStopped = true;
          break;
        }

        if (remaining < effectiveArmor * 0.98) {
          damage = damageForPart(part, shooter, remaining, remaining, false, angleDeg, profile);
          partState.hp = clamp(partState.hp - damage, 0, partState.maxHp || 100);
          partState.hitCount += 1;
          partState.destroyed = partState.hp <= 0;
          path.push(hitLabel + '（停止）');
          remaining = 0;
          result.remainingPenetration = 0;
          result.stateText = '未击穿';
          result.damageText = describePartStatus(part, partState);
          tracedDistance = hit.distance;
          hitStopped = true;
          break;
        }
        penetrated = true;
        partLossAfter = Math.max(0, remaining - armorThicknessLossForPart(part, angleDeg) * profile.armorLossFactor);
        damage = damageForPart(part, shooter, remaining, partLossAfter, true, angleDeg, profile);
        remaining = partLossAfter;
        if (!hasArmorPenetration) {
          hasArmorPenetration = true;
          metalJetStart = hit.point && hit.point.clone ? hit.point.clone() : null;
        }
      } else if (part.kind === 'visual') {
        damage = 0;
        remaining = Math.max(0, remaining - 5);
      } else {
        penetrated = true;
        if (part.id && part.id.indexOf('track') === 0) {
          partLossAfter = Math.max(0, remaining - 2);
        } else {
          partLossAfter = Math.max(0, remaining - 4);
        }
        damage = damageForPart(part, shooter, remaining, partLossAfter, true, angleDeg, profile);
        remaining = partLossAfter;
      }

      if (part.kind === 'ammo') {
        damage = Math.max(damage, partDamageForThickness(part, remaining, Math.max(0, remaining - 2), 1.2));
      }

      if (damage > 0) {
        partState.hp = clamp(partState.hp - damage, 0, partState.maxHp || 100);
      }
      partState.hitCount += 1;
      partState.destroyed = partState.hp <= 0;

      result.penetrated = result.penetrated || penetrated;
      result.remainingPenetration = remaining;
      path.push(hitLabel);

      if (penetrated) {
        applyPenetrationAftermath(result, part, shooter, hit.point, remainingBeforeHit, remaining, angleDeg, profile);
      }

      if (part.kind === 'ammo' && penetrated) {
        remaining = 0;
        tracedDistance = hit.distance;
        hitStopped = true;
        path[path.length - 1] = hitLabel + '（殉爆）';
        break;
      }

      if (remaining <= 0) {
        tracedDistance = hit.distance;
        hitStopped = true;
        break;
      }

      if (part.kind === 'crew' && partState.hp <= 0) {
        remaining = Math.max(0, remaining - 8);
      } else if (part.id.indexOf('track') === 0) {
        remaining = Math.max(0, remaining - 6);
      } else if (part.kind === 'mechanical') {
        remaining = Math.max(0, remaining - 10);
      } else if (part.kind === 'weapon') {
        remaining = Math.max(0, remaining - 12);
      } else if (part.kind === 'subsystem') {
        remaining = Math.max(0, remaining - 9);
      }
    }

    if (hitStopped) {
      tracerEnd = shotOrigin.clone().add(shotDirection.clone().multiplyScalar(clamp(tracedDistance, 0, 1200)));
    } else {
      tracerEnd = shotOrigin.clone().add(shotDirection.clone().multiplyScalar(state.range > 0 ? state.range : 120));
      tracedDistance = state.range > 0 ? state.range : 120;
    }
    result.tracerEnd = tracerEnd;
    // The impact and every visual effect must retain the exact mouse-ray direction.
    result.metalJetDirection = shotDirection.clone().normalize();

    var damageState = summarizeDamage();
    result.crewDead = Math.max(0, 4 - damageState.crewAlive);
    result.mobilityKill = damageState.mobilityKill;
    result.firepowerKill = damageState.firepowerKill;
    result.catastrophic = result.catastrophic || damageState.catastrophic;
    result.pathText = path.length ? path.join(' → ') : '-';
    if (!result.damageText || result.damageText === '-') {
      result.damageText = describeOutcome(result);
    }
    result.stateText = describeOutcome(result);
    if (!result.hitPoint) {
      result.hitPoint = firstHitPoint || firstImpact || tracerEnd;
    }
    if (!result.hitPartId && firstHitPart) {
      result.hitPartId = firstHitPart.id;
      result.hitLabel = prettyPartLabel(firstHitPart);
      result.angleDeg = firstHitAngle;
      result.effectiveArmor = firstHitArmor;
    }
    if (hasArmorPenetration && !result.ricochet && metalJetStart) {
      var fillFactor = Number.isFinite(shooter.fillerFactor) ? shooter.fillerFactor : 0;
      var usedRatio = clamp((penetration > 0 ? ((penetration - remaining) / penetration) : 0), 0, 1);
      var energyHint = clamp((shooter.pen100 || 0) / 220, 0, 1);
      result.metalJetStart = metalJetStart;
      result.metalJetDirection = shotDirection.clone().normalize();
      result.metalJetLength = clamp(0.3 + usedRatio * 2.3 + fillFactor * 0.9, 0.35, 3.2);
      result.metalJetStrength = clamp(0.28 + usedRatio * 0.46 + energyHint * 0.22 + fillFactor * 0.2, 0.3, 0.95);
    }

    state.lastShot = result;
    spawnShotEffect(result, shooter, shotOrigin, shotDirection);
    updateResultPanel(result);
    updateModulePanel(result.hitPartId);
    updateOverlay();
    syncMaterials();
  }

  function spawnShotEffect(result, shooter, shotOrigin, shotDirection) {
    clearEffects();
    var tracerStart = shotOrigin && shotOrigin.isVector3 ? shotOrigin.clone() : camera.position.clone();
    var tracerEnd = result && result.tracerEnd && result.tracerEnd.isVector3 ? result.tracerEnd.clone() : null;

    if (!tracerEnd || !tracerEnd.isVector3) {
      if (shotDirection && shotDirection.isVector3) {
        tracerEnd = tracerStart.clone().add(shotDirection.clone().multiplyScalar(120));
      } else {
        tracerEnd = tracerStart.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(120));
      }
    }

    // Start with a zero-length line; updateEffects advances its head toward tracerEnd.
    var tracerPoints = [tracerStart, tracerStart.clone()];
    var tracerGeometry = new THREE.BufferGeometry().setFromPoints(tracerPoints);
    var tracerMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color(shooter.color || '#d6b15a'),
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false
    });
    var tracer = new THREE.Line(tracerGeometry, tracerMaterial);
    tracer.renderOrder = 20;
    tracer.userData.birth = performance.now();
    tracer.userData.life = 900;
    tracer.userData.effectType = 'tracer';
    tracer.userData.start = tracerStart.clone();
    tracer.userData.end = tracerEnd.clone();
    effectRoot.add(tracer);
    state.effects.push(tracer);

    var impact = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 10, 10),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(shooter.color || '#d6b15a'),
      transparent: true,
      opacity: 0.95
      })
    );
    impact.material.depthTest = false;
    impact.material.depthWrite = false;
    impact.position.copy(result.hitPoint);
    impact.renderOrder = 21;
    impact.userData.birth = performance.now();
    impact.userData.life = 900;
    impact.userData.effectType = 'impact';
    effectRoot.add(impact);
    state.effects.push(impact);

    if (result && result.penetrated && !result.ricochet) {
      addMetalJetEffect(result, shooter);
    }
  }

  function addMetalJetEffect(result, shooter) {
    if (!result || !result.metalJetStart) {
      return;
    }
    var direction = result.metalJetDirection && result.metalJetDirection.isVector3 ? result.metalJetDirection : null;
    if (!direction || !direction.lengthSq || direction.lengthSq() < 0.000001) {
      direction = camera.getWorldDirection(new THREE.Vector3());
    }

    var jetLength = clamp(result.metalJetLength || 0, 0.05, 4);
    if (jetLength <= 0.03) {
      return;
    }
    var strength = clamp(result.metalJetStrength || 0.35, 0.2, 1);
    var color = new THREE.Color(shooter && shooter.color ? shooter.color : '#ffb05c');
    direction = direction.clone().normalize();
    var start = result.metalJetStart.clone();
    var coreLife = 960;
    var plumeLength = jetLength;
    var plumeRadius = clamp(jetLength * (0.08 + strength * 0.1), 0.06, 0.5);
    var plumeGeometry = new THREE.ConeGeometry(plumeRadius, plumeLength, 16, 1, true);
    var plumeMaterial = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: clamp(0.15 + strength * 0.45, 0.18, 0.62),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide
    });
    var plume = new THREE.Mesh(plumeGeometry, plumeMaterial);
    plume.renderOrder = 23;
    // Cone tip stays at the armor hole and its base expands in the shot direction.
    plume.quaternion.setFromUnitVectors(upAxis, direction.clone().negate());
    plume.position.copy(start).add(direction.clone().multiplyScalar(plumeLength * 0.5));
    plume.userData.birth = performance.now();
    plume.userData.life = coreLife;
    plume.userData.effectType = 'jet';
    effectRoot.add(plume);
    state.effects.push(plume);

    var spreadAxis = Math.abs(direction.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : upAxis;
    var tangent = new THREE.Vector3().crossVectors(direction, spreadAxis).normalize();
    var bitangent = new THREE.Vector3().crossVectors(direction, tangent).normalize();
    var fragmentCount = Math.round(12 + strength * 12);

    for (var i = 0; i < fragmentCount; i += 1) {
      var phase = i * 2.3999632297;
      var ring = 0.25 + ((i * 7) % fragmentCount) / fragmentCount * 0.75;
      var lateral = tangent.clone().multiplyScalar(Math.cos(phase) * ring)
        .add(bitangent.clone().multiplyScalar(Math.sin(phase) * ring));
      var fragmentDirection = direction.clone().multiplyScalar(1.25)
        .add(lateral.multiplyScalar(0.18 + strength * 0.18))
        .normalize();
      var fragmentLength = jetLength * (0.42 + ((i * 11) % 9) / 15);
      var fragmentStart = start.clone().add(direction.clone().multiplyScalar(0.02));
      var fragmentEnd = fragmentStart.clone().add(fragmentDirection.multiplyScalar(fragmentLength));
      var fragmentGeometry = new THREE.BufferGeometry().setFromPoints([fragmentStart, fragmentEnd]);
      var fragmentMaterial = new THREE.LineBasicMaterial({
        color: color,
        transparent: true,
        opacity: clamp(0.28 + strength * 0.42, 0.3, 0.78),
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false
      });
      var fragment = new THREE.Line(fragmentGeometry, fragmentMaterial);
      fragment.renderOrder = 24;
      fragment.userData.birth = performance.now();
      fragment.userData.life = coreLife;
      fragment.userData.effectType = 'jet-fragment';
      effectRoot.add(fragment);
      state.effects.push(fragment);
    }
  }

  function clearEffects() {
    while (state.effects.length) {
      var effect = state.effects.pop();
      effectRoot.remove(effect);
      disposeObject(effect);
    }
  }

  function resetDamage() {
    if (!state.target) {
      return;
    }
    for (var i = 0; i < state.target.parts.length; i += 1) {
      var part = state.target.parts[i];
      var ps = ensurePartState(part);
      ps.hp = typeof part.maxHp === 'number' ? part.maxHp : 100;
      ps.hitCount = 0;
      ps.destroyed = false;
    }
    state.lastShot = null;
    clearEffects();
    syncMaterials();
    updateModulePanel(null);
    updateResultPanel(null);
    updateOverlay();
  }

  function applyOrbit() {
    var radius = clamp(state.orbit.radius, 6, 22);
    var theta = state.orbit.theta;
    var phi = clamp(state.orbit.phi, 0.24, 1.32);
    var target = state.orbit.target;
    camera.position.set(
      target.x + radius * Math.sin(phi) * Math.cos(theta),
      target.y + radius * Math.cos(phi),
      target.z + radius * Math.sin(phi) * Math.sin(theta)
    );
    camera.lookAt(target);
  }

  function resizeRenderer() {
    var rect = dom.canvas.getBoundingClientRect();
    var width = Math.max(1, Math.floor(rect.width));
    var height = Math.max(1, Math.floor(rect.height));
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function handlePointerDown(event) {
    updatePointerNdcFromEvent(event);
    updateCrosshairFromPointer();
    drag.active = true;
    drag.pointerId = event.pointerId;
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.moved = false;
    drag.shootBlocked = false;
    dom.canvas.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event) {
    if (!drag.active || drag.pointerId !== event.pointerId) {
      return;
    }
    updatePointerNdcFromEvent(event);
    updateCrosshairFromPointer();
    var dx = event.clientX - drag.x;
    var dy = event.clientY - drag.y;
    if (!drag.moved && (dx * dx + dy * dy) > 9) {
      drag.moved = true;
      drag.shootBlocked = true;
    }
    drag.x = event.clientX;
    drag.y = event.clientY;
    state.orbit.theta -= dx * 0.006;
    state.orbit.phi -= dy * 0.005;
    applyOrbit();
    updateOverlay();
  }

  function handlePointerUp(event) {
    if (drag.pointerId !== event.pointerId) {
      return;
    }

    drag.active = false;
    drag.pointerId = null;

    if (dom.canvas && typeof dom.canvas.releasePointerCapture === 'function') {
      dom.canvas.releasePointerCapture(event.pointerId);
    }

  }

  function handleCanvasClick(event) {
    if (event && event.button !== undefined && event.button !== 0) {
      return;
    }
    if (drag.shootBlocked) {
      drag.shootBlocked = false;
      return;
    }
    if (!drag.active && pointerIsInsideCanvas(event)) {
      fireShot(event);
    }
  }

  function handlePointerLeave(event) {
    if (drag.pointerId === event.pointerId) {
      drag.active = false;
      drag.pointerId = null;
      drag.moved = false;
      if (dom.canvas && typeof dom.canvas.releasePointerCapture === 'function') {
        dom.canvas.releasePointerCapture(event.pointerId);
      }
    }
  }

  function handleWheel(event) {
    event.preventDefault();
    state.orbit.radius = clamp(state.orbit.radius + event.deltaY * 0.004, 6, 22);
    applyOrbit();
    updateOverlay();
  }

  function resetView() {
    if (!state.target) {
      return;
    }
    resetOrbitFromTarget(state.target);
    applyOrbit();
    updateOverlay();
  }

  function onShooterChange() {
    state.shooterId = dom.shooterSelect.value;
    state.lastShot = null;
    updateRangeLabels();
    updateOverlay();
    syncMaterials();
    updateResultPanel(null);
  }

  function onTargetChange() {
    state.targetId = dom.targetSelect.value;
    var target = targetById(state.targetId);
    if (target) {
      state.targetYaw = normalizeYawDeg(typeof target.yaw === 'number' ? target.yaw : state.targetYaw);
      state.turretYaw = normalizeYawDeg(typeof target.turretYaw === 'number' ? target.turretYaw : 0);
      dom.targetYawSelect.value = String(state.targetYaw);
      dom.turretYawSelect.value = String(state.turretYaw);
      buildTargetModel(target);
      resetOrbitFromTarget(target);
      applyOrbit();
      updateOverlay();
    }
  }

  function onTargetYawChange() {
    state.targetYaw = normalizeYawDeg(dom.targetYawSelect.value);
    applyTargetFacing();
    state.lastShot = null;
    updateModulePanel(null);
    updateResultPanel(null);
    updateOverlay();
    syncMaterials();
  }

  function onTurretYawChange() {
    state.turretYaw = normalizeYawDeg(dom.turretYawSelect.value);
    applyTargetFacing();
    state.lastShot = null;
    updateModulePanel(null);
    updateResultPanel(null);
    updateOverlay();
    syncMaterials();
  }

  function onRangeInput() {
    state.range = Number(dom.rangeInput.value);
    state.lastShot = null;
    updateRangeLabels();
    updateOverlay();
    updateResultPanel(null);
    syncMaterials();
  }

  function toggleXray() {
    state.xray = !state.xray;
    setButtonState();
    syncMaterials();
  }

  function updateEffects() {
    var now = performance.now();
    for (var i = state.effects.length - 1; i >= 0; i -= 1) {
      var effect = state.effects[i];
      var life = effect.userData.life || 900;
      var age = now - (effect.userData.birth || now);
      var progress = clamp(age / life, 0, 1);
      if (effect.userData.effectType === 'tracer') {
        var points = effect.geometry && effect.geometry.getAttribute ? effect.geometry.getAttribute('position') : null;
        if (points && effect.userData.start && effect.userData.end) {
          var head = effect.userData.start.clone().lerp(effect.userData.end, progress);
          points.setXYZ(0, effect.userData.start.x, effect.userData.start.y, effect.userData.start.z);
          points.setXYZ(1, head.x, head.y, head.z);
          points.needsUpdate = true;
        }
      }
      if (effect.material) {
        effect.material.opacity = 1 - progress;
      }
      if (effect.userData.effectType !== 'tracer' && effect.userData.effectType !== 'jet-fragment' && effect.scale) {
        effect.scale.setScalar(1 + progress * 0.12);
      }
      if (progress >= 1) {
        effectRoot.remove(effect);
        disposeObject(effect);
        state.effects.splice(i, 1);
      }
    }
  }

  function tick() {
    requestAnimationFrame(tick);
    updateEffects();
    renderer.render(scene, camera);
  }

  function init() {
    updateSelectors();

    dom.rangeInput.value = String(state.range);
    updateRangeLabels();
    setButtonState();

    dom.shooterSelect.addEventListener('change', onShooterChange);
    dom.targetSelect.addEventListener('change', onTargetChange);
    dom.targetYawSelect.addEventListener('change', onTargetYawChange);
    dom.turretYawSelect.addEventListener('change', onTurretYawChange);
    dom.rangeInput.addEventListener('input', onRangeInput);
    dom.fireButton.addEventListener('click', fireShot);
    dom.resetButton.addEventListener('click', function () {
      resetDamage();
      resetView();
    });
    dom.xrayButton.addEventListener('click', toggleXray);

    dom.canvas.addEventListener('pointerdown', handlePointerDown);
    dom.canvas.addEventListener('pointermove', handlePointerMove);
    dom.canvas.addEventListener('pointerup', handlePointerUp);
    dom.canvas.addEventListener('pointercancel', handlePointerUp);
    dom.canvas.addEventListener('click', handleCanvasClick);
    dom.canvas.addEventListener('pointerleave', handlePointerLeave);
    dom.canvas.addEventListener('wheel', handleWheel, { passive: false });
    dom.canvas.addEventListener('dblclick', resetView);
    window.addEventListener('resize', resizeRenderer);

    var target = targetById(state.targetId);
    if (target) {
      buildTargetModel(target);
      resetOrbitFromTarget(target);
    }

    resizeRenderer();
    applyOrbit();
    updateCrosshairFromPointer();
    updateOverlay();
    updateResultPanel(null);
    updateModulePanel(null);
    tick();
  }

  init();
})();
