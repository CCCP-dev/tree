(function attachArmy(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.WTArmy = api;
  if (root && root.document) {
    api.init(root);
  }
}(globalThis, function createArmy() {
  const MIN_SCALE = 0.08;
  const MAX_SCALE = 2.5;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function finiteNumber(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function clampScale(value) {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, finiteNumber(value, 1)));
  }

  function fitViewport(graphWidth, graphHeight, viewportWidth, viewportHeight, padding) {
    const width = Math.max(1, finiteNumber(graphWidth, 1));
    const height = Math.max(1, finiteNumber(graphHeight, 1));
    const viewportW = Math.max(1, finiteNumber(viewportWidth, 1));
    const viewportH = Math.max(1, finiteNumber(viewportHeight, 1));
    const inset = Math.max(0, finiteNumber(padding, 0));
    const scale = clampScale(Math.min(
      Math.max(1, viewportW - inset * 2) / width,
      Math.max(1, viewportH - inset * 2) / height
    ));

    return {
      x: (viewportW - width * scale) / 2,
      y: (viewportH - height * scale) / 2,
      scale
    };
  }

  function setupAutoFit(measure, observe, schedule, onFit) {
    let active = true;
    let initialFitComplete = false;
    let observerScheduled = false;
    let windowResizeScheduled = false;

    function fitIfMeasurable(source) {
      if (!active) return;
      const size = measure() || {};
      if (Number.isFinite(size.width) && size.width > 0 && Number.isFinite(size.height) && size.height > 0) {
        onFit({ width: size.width, height: size.height });
        initialFitComplete = true;
      }
    }

    function requestObserverFit() {
      if (!active || initialFitComplete || observerScheduled) return;
      observerScheduled = true;
      schedule(() => {
        observerScheduled = false;
        if (!initialFitComplete) fitIfMeasurable('observer');
      });
    }

    function requestWindowResizeFit() {
      if (!active || windowResizeScheduled) return;
      windowResizeScheduled = true;
      schedule(() => {
        windowResizeScheduled = false;
        fitIfMeasurable('window');
      });
    }

    const stopObserving = typeof observe === 'function' ? observe(requestObserverFit, requestWindowResizeFit) : null;
    requestObserverFit();
    return function stopAutoFit() {
      active = false;
      if (typeof stopObserving === 'function') stopObserving();
    };
  }

  function safeInitialize(run, onError) {
    try {
      return run();
    } catch (error) {
      if (typeof onError === 'function') onError(error);
      return null;
    }
  }

  function zoomAroundPoint(state, pointerX, pointerY, factor) {
    const previousScale = clampScale(state && state.scale);
    const nextScale = clampScale(previousScale * finiteNumber(factor, 1));
    const x = finiteNumber(state && state.x, 0);
    const y = finiteNumber(state && state.y, 0);
    const pointX = finiteNumber(pointerX, 0);
    const pointY = finiteNumber(pointerY, 0);
    const worldX = (pointX - x) / previousScale;
    const worldY = (pointY - y) / previousScale;

    return { x: pointX - worldX * nextScale, y: pointY - worldY * nextScale, scale: nextScale };
  }

  function nodeValue(node, property) {
    return finiteNumber(node && node[property], 0);
  }

  function pathNumber(value) {
    return String(Math.round(finiteNumber(value, 0) * 1000) / 1000);
  }

  function pointInRect(point, rect) {
    return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
  }

  function edgePath(fromNode, toNode, edgeIndex, siblingCount, obstacles) {
    const startX = nodeValue(fromNode, 'layoutX') + nodeValue(fromNode, 'layoutWidth') / 2;
    const startY = nodeValue(fromNode, 'layoutY') + nodeValue(fromNode, 'layoutHeight');
    const endX = nodeValue(toNode, 'layoutX') + nodeValue(toNode, 'layoutWidth') / 2;
    const endY = nodeValue(toNode, 'layoutY');
    const midY = (startY + endY) / 2;
    return 'M ' + pathNumber(startX) + ' ' + pathNumber(startY) +
      ' L ' + pathNumber(startX) + ' ' + pathNumber(midY) +
      ' L ' + pathNumber(endX) + ' ' + pathNumber(midY) +
      ' L ' + pathNumber(endX) + ' ' + pathNumber(endY);
  }

  function wrapLabel(name, maxChars) {
    const text = String(name || '未命名载具');
    const limit = Math.max(1, Math.floor(finiteNumber(maxChars, 12)));
    const lines = [];
    for (let index = 0; index < text.length; index += limit) {
      lines.push(text.slice(index, index + limit));
    }
    return lines.slice(0, 3).length ? lines.slice(0, 3) : ['未命名载具'];
  }

  function labelMetrics(node) {
    const width = nodeValue(node, 'layoutWidth');
    const height = nodeValue(node, 'layoutHeight');
    const hasWiki = !!(node && node.wikiUrl);
    const availableWidth = Math.max(44, width - (hasWiki ? 34 : 24));
    const maxChars = Math.max(4, Math.floor(availableWidth / 8.6));
    const lines = wrapLabel(node && node.name, maxChars);
    const lineHeight = 12;
    const totalHeight = lines.length * lineHeight;
    return {
      lines,
      lineHeight,
      startY: Math.max(18, (height - totalHeight) / 2 + 5),
      centerX: width / 2 - (hasWiki ? 6 : 0)
    };
  }

  const MARKER_USERS = [
    { id: 'user1', label: 'user1', color: '#e36b6b' },
    { id: 'user2', label: 'user2', color: '#6bc9e3' },
    { id: 'user3', label: 'user3', color: '#8ed66d' },
    { id: 'user4', label: 'user4', color: '#c98ce3' }
  ];
  const MARKER_STORAGE_KEY = 'wt-tree-army-markers-v1';

  function cloneSelections(source) {
    const result = new Map();
    for (const [id, set] of source.entries()) {
      result.set(id, new Set(set));
    }
    return result;
  }

  function loadMarkerState(storage) {
    if (!storage || typeof storage.getItem !== 'function') {
      return { enabled: false, activeUser: MARKER_USERS[0].id, selections: new Map() };
    }
    try {
      const raw = storage.getItem(MARKER_STORAGE_KEY);
      if (!raw) return { enabled: false, activeUser: MARKER_USERS[0].id, selections: new Map() };
      const parsed = JSON.parse(raw);
      const selections = new Map();
      for (const user of MARKER_USERS) selections.set(user.id, new Set());
      for (const entry of Array.isArray(parsed.selections) ? parsed.selections : []) {
        if (!entry || !entry.nodeId || !Array.isArray(entry.users)) continue;
        const set = selections.get(entry.nodeId) || new Set();
        for (const userId of entry.users) {
          if (MARKER_USERS.some((user) => user.id === userId)) set.add(userId);
        }
        selections.set(entry.nodeId, set);
      }
      const activeUser = MARKER_USERS.some((user) => user.id === parsed.activeUser) ? parsed.activeUser : MARKER_USERS[0].id;
      return { enabled: !!parsed.enabled, activeUser, selections };
    } catch (error) {
      return { enabled: false, activeUser: MARKER_USERS[0].id, selections: new Map() };
    }
  }

  function saveMarkerState(storage, state) {
    if (!storage || typeof storage.setItem !== 'function') return;
    try {
      const selections = [];
      for (const [nodeId, set] of state.selections.entries()) {
        if (!set || !set.size) continue;
        selections.push({ nodeId, users: Array.from(set) });
      }
      storage.setItem(MARKER_STORAGE_KEY, JSON.stringify({
        enabled: !!state.enabled,
        activeUser: state.activeUser,
        selections
      }));
    } catch (error) {
      return;
    }
  }

  function init(environment) {
    let status = null;
    return safeInitialize(() => {
    const root = environment || globalThis;
    const document = root && root.document;
    if (!document) return null;
    const canvas = document.querySelector('#research-canvas');
    const layer = document.querySelector('#research-layer');
    status = document.querySelector('#graph-status');
    const search = document.querySelector('#vehicle-search');
    const searchStatus = document.querySelector('#search-status');
    const zoomIn = document.querySelector('#zoom-in');
    const zoomOut = document.querySelector('#zoom-out');
    const reset = document.querySelector('#reset-view');
    const markerToggle = document.querySelector('#marker-toggle');
    const markerClear = document.querySelector('#marker-clear');
    const markerUsers = document.querySelector('#marker-users');
    const data = root.WT_TREE_DATA;
    const core = root.WTCore;
    const storage = root.localStorage;

    if (!canvas || !layer || !status || !search || !searchStatus || !zoomIn || !zoomOut || !reset || !markerToggle || !markerClear || !markerUsers) return null;
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges) || !core ||
        typeof core.layoutGraph !== 'function' || typeof core.buildIndex !== 'function' ||
        typeof core.searchNodes !== 'function' || typeof core.vehicleHref !== 'function') {
      status.textContent = '研发树数据未能加载。请返回首页后重试。';
      status.classList.add('is-error');
      return null;
    }

    const graph = core.layoutGraph(data, { nodeWidth: 164, nodeHeight: 66, columnGap: 44, rowGap: 92 });
    const index = core.buildIndex(data);
    const nodeElements = new Map();
    const nodeMarkers = new Map();
    const markerState = loadMarkerState(storage);
    const nodeSelections = markerState.selections;
    let viewport = { x: 0, y: 0, scale: 1 };
    let dragging = null;
    let markerEnabled = markerState.enabled;
    let activeMarkerUser = markerState.activeUser;

    for (const node of graph.nodes) {
      if (!nodeSelections.has(node.id)) nodeSelections.set(node.id, new Set());
    }

    function activeUserConfig() {
      return MARKER_USERS.find((user) => user.id === activeMarkerUser) || MARKER_USERS[0];
    }

    function refreshMarkerToggle() {
      markerToggle.textContent = markerEnabled ? '关闭标记' : '开始标记';
      markerToggle.classList.toggle('is-on', markerEnabled);
      markerToggle.setAttribute('aria-pressed', String(markerEnabled));
    }

    function refreshUserButtons() {
      for (const button of markerUsers.querySelectorAll('button')) {
        button.classList.toggle('is-active', button.getAttribute('data-user-id') === activeMarkerUser);
      }
    }

    function markerEntries(node) {
      const selected = nodeSelections.get(node.id) || new Set();
      return MARKER_USERS.filter((user) => selected.has(user.id));
    }

    function renderNodeMarkers(node, group) {
      let existing = nodeMarkers.get(node.id);
      if (existing) existing.remove();
      const markers = markerEntries(node);
      if (!markers.length) {
        nodeMarkers.delete(node.id);
        return;
      }
      const markerGroup = createSvg('g');
      markerGroup.setAttribute('class', 'vehicle-node__markers');
      markers.forEach((user, index) => {
        const marker = createSvg('circle');
        marker.setAttribute('class', 'vehicle-node__marker');
        marker.setAttribute('cx', 12 + index * 11);
        marker.setAttribute('cy', node.layoutHeight - 11);
        marker.setAttribute('r', '4');
        marker.setAttribute('fill', user.color);
        marker.setAttribute('aria-hidden', 'true');
        markerGroup.append(marker);
      });
      group.append(markerGroup);
      nodeMarkers.set(node.id, markerGroup);
    }

    function toggleMarker(node) {
      const selections = nodeSelections.get(node.id) || new Set();
      if (selections.has(activeMarkerUser)) selections.delete(activeMarkerUser);
      else selections.add(activeMarkerUser);
      nodeSelections.set(node.id, selections);
      const group = nodeElements.get(node.id);
      if (group) renderNodeMarkers(node, group);
      saveMarkerState(storage, { enabled: markerEnabled, activeUser: activeMarkerUser, selections: nodeSelections });
    }

    function setMarkerEnabled(value) {
      markerEnabled = !!value;
      refreshMarkerToggle();
      saveMarkerState(storage, { enabled: markerEnabled, activeUser: activeMarkerUser, selections: nodeSelections });
    }

    function clearMarkers() {
      for (const node of graph.nodes) {
        nodeSelections.set(node.id, new Set());
        const group = nodeElements.get(node.id);
        if (group) renderNodeMarkers(node, group);
      }
      if (storage && typeof storage.removeItem === 'function') {
        storage.removeItem(MARKER_STORAGE_KEY);
      }
    }

    refreshMarkerToggle();
    MARKER_USERS.forEach((user, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'marker-user';
      button.style.setProperty('--marker-color', user.color);
      button.setAttribute('data-user-id', user.id);
      button.textContent = user.label;
      button.addEventListener('click', () => {
        activeMarkerUser = user.id;
        refreshUserButtons();
        setMarkerEnabled(true);
        saveMarkerState(storage, { enabled: markerEnabled, activeUser: activeMarkerUser, selections: nodeSelections });
      });
      if (index === 0) button.classList.add('is-active');
      markerUsers.append(button);
    });
    refreshUserButtons();
    markerToggle.addEventListener('click', () => {
      setMarkerEnabled(!markerEnabled);
      if (markerEnabled) refreshUserButtons();
      saveMarkerState(storage, { enabled: markerEnabled, activeUser: activeMarkerUser, selections: nodeSelections });
    });
    markerClear.addEventListener('click', () => {
      clearMarkers();
      saveMarkerState(storage, { enabled: markerEnabled, activeUser: activeMarkerUser, selections: nodeSelections });
    });

    function applyViewport() {
      layer.setAttribute('transform', 'translate(' + viewport.x + ' ' + viewport.y + ') scale(' + viewport.scale + ')');
    }

    function canvasRect() {
      const rect = canvas.getBoundingClientRect();
      return { width: finiteNumber(rect.width, 0), height: finiteNumber(rect.height, 0), left: finiteNumber(rect.left, 0), top: finiteNumber(rect.top, 0) };
    }

    function resetViewport() {
      const rect = canvasRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      viewport = fitViewport(graph.width, graph.height, rect.width, rect.height, 48);
      applyViewport();
      return true;
    }

    function centerNode(node) {
      const rect = canvasRect();
      const nodeCenterX = node.layoutX + node.layoutWidth / 2;
      const nodeCenterY = node.layoutY + node.layoutHeight / 2;
      viewport = {
        x: rect.width / 2 - nodeCenterX * viewport.scale,
        y: rect.height / 2 - nodeCenterY * viewport.scale,
        scale: viewport.scale
      };
      applyViewport();
    }

    function navigate(node) {
      root.location.href = core.vehicleHref(node.id);
    }

    function createSvg(name) {
      return document.createElementNS(SVG_NS, name);
    }

    const edgesGroup = createSvg('g');
    edgesGroup.setAttribute('class', 'graph-edges');
    const nodesGroup = createSvg('g');
    nodesGroup.setAttribute('class', 'graph-nodes');
    const graphNodes = new Map(graph.nodes.map((node) => [node.id, node]));
    const edgeGroups = new Map();
    for (const edge of graph.edges) {
      const fromNode = graphNodes.get(edge.from);
      const toNode = graphNodes.get(edge.to);
      if (!fromNode || !toNode) continue;
      const sourceBand = Math.round(nodeValue(fromNode, 'layoutX') / 140);
      const targetBand = Math.round(nodeValue(toNode, 'layoutX') / 140);
      const spanBand = Math.round(Math.abs(nodeValue(toNode, 'layoutX') - nodeValue(fromNode, 'layoutX')) / 180);
      const key = sourceBand + ':' + targetBand + ':' + spanBand;
      if (!edgeGroups.has(key)) edgeGroups.set(key, []);
      edgeGroups.get(key).push(edge);
    }
    for (const siblings of edgeGroups.values()) {
      siblings.sort((left, right) => {
        const leftFrom = graphNodes.get(left.from);
        const leftTo = graphNodes.get(left.to);
        const rightFrom = graphNodes.get(right.from);
        const rightTo = graphNodes.get(right.to);
        const leftMidY = (nodeValue(leftFrom, 'layoutY') + nodeValue(leftTo, 'layoutY')) / 2;
        const rightMidY = (nodeValue(rightFrom, 'layoutY') + nodeValue(rightTo, 'layoutY')) / 2;
        return leftMidY - rightMidY || String(left.id).localeCompare(String(right.id), 'zh-CN');
      });
    }

    graph.edges.forEach((edge) => {
      const fromNode = graphNodes.get(edge.from);
      const toNode = graphNodes.get(edge.to);
      if (!fromNode || !toNode) return;
      const sourceBand = Math.round(nodeValue(fromNode, 'layoutX') / 140);
      const targetBand = Math.round(nodeValue(toNode, 'layoutX') / 140);
      const spanBand = Math.round(Math.abs(nodeValue(toNode, 'layoutX') - nodeValue(fromNode, 'layoutX')) / 180);
      const key = sourceBand + ':' + targetBand + ':' + spanBand;
      const siblings = edgeGroups.get(key) || [edge];
      const edgeIndex = siblings.findIndex((candidate) => candidate.id === edge.id);
      const path = createSvg('path');
      path.setAttribute('class', 'graph-edge');
      path.setAttribute('d', edgePath(fromNode, toNode, edgeIndex, siblings.length, graph.nodes));
      edgesGroup.append(path);
    });

    for (const node of graph.nodes) {
      const group = createSvg('g');
      group.setAttribute('class', 'vehicle-node');
      group.setAttribute('data-node-id', node.id);
      group.setAttribute('role', 'link');
      group.setAttribute('tabindex', '0');
      group.setAttribute('aria-label', '查看 ' + String(node.name || '未命名载具') + ' 的详情');
      group.setAttribute('transform', 'translate(' + node.layoutX + ' ' + node.layoutY + ')');

      const rect = createSvg('rect');
      rect.setAttribute('width', node.layoutWidth);
      rect.setAttribute('height', node.layoutHeight);
      rect.setAttribute('rx', '7');
      group.append(rect);

      const text = createSvg('text');
      const metrics = labelMetrics(node);
      text.setAttribute('x', metrics.centerX);
      text.setAttribute('y', metrics.startY);
      text.setAttribute('text-anchor', 'middle');
      metrics.lines.forEach((line, position) => {
        const span = createSvg('tspan');
        span.setAttribute('x', metrics.centerX);
        span.setAttribute('dy', position === 0 ? '0' : String(metrics.lineHeight));
        span.textContent = line;
        text.append(span);
      });
      group.append(text);

      if (node.wikiUrl) {
        const indicator = createSvg('circle');
        indicator.setAttribute('class', 'vehicle-node__wiki');
        indicator.setAttribute('cx', node.layoutWidth - 12);
        indicator.setAttribute('cy', '12');
        indicator.setAttribute('r', '4');
        indicator.setAttribute('aria-hidden', 'true');
        group.append(indicator);
      }

      renderNodeMarkers(node, group);

      group.addEventListener('click', (event) => {
        if (markerEnabled) {
          event.preventDefault();
          event.stopImmediatePropagation();
          toggleMarker(node);
          return;
        }
        navigate(node);
      });
      group.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (markerEnabled) toggleMarker(node);
          else navigate(node);
        }
      });
      nodeElements.set(node.id, group);
      nodesGroup.append(group);
    }

    layer.append(edgesGroup, nodesGroup);
    status.textContent = '已加载 ' + graph.nodes.length + ' 个载具与 ' + graph.edges.length + ' 条研发关系。拖动空白区域平移，滚轮缩放。';
    const stopAutoFit = setupAutoFit(
      canvasRect,
      (notifyObserver, notifyWindowResize) => {
        const cleanups = [];
        if (typeof root.ResizeObserver === 'function') {
          const observer = new root.ResizeObserver(notifyObserver);
          observer.observe(canvas);
          cleanups.push(() => observer.disconnect());
        }
        if (typeof root.addEventListener === 'function') {
          root.addEventListener('resize', notifyWindowResize);
          cleanups.push(() => root.removeEventListener('resize', notifyWindowResize));
        }
        return () => cleanups.forEach((cleanup) => cleanup());
      },
      (run) => {
        if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(run);
        else run();
      },
      resetViewport
    );

    canvas.addEventListener('pointerdown', (event) => {
      if (event.target.closest && event.target.closest('.vehicle-node')) return;
      const rect = canvasRect();
      dragging = { pointerId: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top, viewportX: viewport.x, viewportY: viewport.y };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!dragging || dragging.pointerId !== event.pointerId) return;
      const rect = canvasRect();
      viewport = Object.assign({}, viewport, {
        x: dragging.viewportX + event.clientX - rect.left - dragging.x,
        y: dragging.viewportY + event.clientY - rect.top - dragging.y
      });
      applyViewport();
    });
    function endDrag(event) {
      if (dragging && dragging.pointerId === event.pointerId) {
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        dragging = null;
      }
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = canvasRect();
      viewport = zoomAroundPoint(viewport, event.clientX - rect.left, event.clientY - rect.top, event.deltaY < 0 ? 1.12 : 1 / 1.12);
      applyViewport();
    }, { passive: false });

    function zoomBy(factor) {
      const rect = canvasRect();
      viewport = zoomAroundPoint(viewport, rect.width / 2, rect.height / 2, factor);
      applyViewport();
    }
    zoomIn.addEventListener('click', () => zoomBy(1.2));
    zoomOut.addEventListener('click', () => zoomBy(1 / 1.2));
    reset.addEventListener('click', resetViewport);

    search.addEventListener('input', () => {
      for (const element of nodeElements.values()) element.classList.remove('is-search-match');
      const query = search.value.trim();
      if (!query) {
        searchStatus.textContent = '';
        return;
      }
      const matches = core.searchNodes(index, query);
      for (const node of matches) {
        const element = nodeElements.get(node.id);
        if (element) element.classList.add('is-search-match');
      }
      if (!matches.length) {
        searchStatus.textContent = '未找到匹配的载具。';
        return;
      }
      const first = matches[0];
      centerNode(graphNodes.get(first.id));
      nodeElements.get(first.id).focus();
      searchStatus.textContent = '找到 ' + matches.length + ' 个匹配载具，已定位第一个结果。';
    });

    return { graph, nodeElements, getViewport: () => Object.assign({}, viewport), resetViewport, destroy: stopAutoFit };
    }, () => {
      if (!status) return;
      status.textContent = '研发树加载失败。请返回首页后重试。';
      status.classList.add('is-error');
    });
  }

  return { clampScale, fitViewport, setupAutoFit, safeInitialize, zoomAroundPoint, edgePath, wrapLabel, labelMetrics, init, MARKER_USERS };
}));
