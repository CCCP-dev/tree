(function () {
  const STORAGE_KEY = 'wt-tree-editor-draft-v1';
  const BRANCHES = [{ id: 'army', label: '陆军' }];
  const state = {
    branch: 'army',
    draft: null,
    selectedId: null,
    query: '',
    dragging: null,
    dragOffsetX: 0,
    dragOffsetY: 0,
    panning: false,
    panStartX: 0,
    panStartY: 0,
    panViewX: 0,
    panViewY: 0,
    previewMap: { x: 0, y: 0, width: 1600, height: 900 },
    previewZoom: 1,
    newNodeIds: new Set()
  };

  const branchSelect = document.getElementById('branch-select');
  const nodeSearch = document.getElementById('node-search');
  const nodeList = document.getElementById('node-list');
  const preview = document.getElementById('editor-preview');
  const previewTransform = document.getElementById('preview-transform');
  const form = document.getElementById('node-form');
  const addNodeButton = document.getElementById('add-node');
  const edgeFromSelect = document.getElementById('edge-from');
  const edgeToSelect = document.getElementById('edge-to');
  const addEdgeButton = document.getElementById('add-edge');
  const edgeList = document.getElementById('edge-list');
  const previewZoomIn = document.getElementById('preview-zoom-in');
  const previewZoomOut = document.getElementById('preview-zoom-out');
  const previewZoomReset = document.getElementById('preview-zoom-reset');
  const fields = { id: document.getElementById('node-id'), name: document.getElementById('node-name'), wiki: document.getElementById('node-wiki') };

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function getData() { return globalThis.WT_TREE_DATA ? clone(globalThis.WT_TREE_DATA) : { meta: {}, nodes: [], edges: [] }; }
  function loadDraft() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; } }
  function saveDraft() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.draft)); }
  function finiteNumber(value, fallback) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
  function nodeText(node) { return String((node && node.name) || '').trim() || '未命名'; }
  function labelWidth(node) { return Math.max(88, 18 + nodeText(node).length * 12); }
  function labelHeight(node) { return Math.max(54, Math.ceil(nodeText(node).length / 7) * 18 + 24); }
  function syncNodeSize(node) { node.width = labelWidth(node); node.height = labelHeight(node); }
  function syncAllNodeSize() { for (const node of state.draft.nodes || []) syncNodeSize(node); }
  function markNewNode(id) { state.newNodeIds.add(id); }
  function clearNewNodeMarks() { state.newNodeIds.clear(); }
  function previewScale() {
    const box = preview.getBoundingClientRect();
    return Math.min(box.width / state.previewMap.width, box.height / state.previewMap.height);
  }
  function nodeById(id) { return (state.draft.nodes || []).find((node) => node.id === id) || null; }
  function nodeLabel(id) { const node = nodeById(id); return node ? (node.name || node.id) : id; }
  function edgeSignature(edge) { return `${edge.from}::${edge.to}`; }
  function relatedEdgesForSelected() {
    const edges = state.draft.edges || [];
    if (!state.selectedId) return edges;
    return edges.filter((edge) => edge.from === state.selectedId || edge.to === state.selectedId);
  }
  function fillEdgeSelect(select, selectedId) {
    const nodes = state.draft.nodes || [];
    select.innerHTML = '';
    for (const node of nodes) {
      const option = document.createElement('option');
      option.value = node.id;
      option.textContent = node.name || node.id;
      select.appendChild(option);
    }
    if (selectedId && nodes.some((node) => node.id === selectedId)) select.value = selectedId;
    else if (nodes[0]) select.value = nodes[0].id;
  }
  function syncEdgeSelects() {
    fillEdgeSelect(edgeFromSelect, state.selectedId);
    fillEdgeSelect(edgeToSelect, (state.draft.nodes || [])[1] ? (state.draft.nodes || [])[1].id : state.selectedId);
    if (edgeToSelect.value === edgeFromSelect.value) {
      const alt = (state.draft.nodes || []).find((node) => node.id !== edgeFromSelect.value);
      if (alt) edgeToSelect.value = alt.id;
    }
  }
  function addEdge(from = edgeFromSelect.value, to = edgeToSelect.value) {
    if (!from || !to || from === to) return;
    const nodes = state.draft.nodes || [];
    if (!nodes.some((node) => node.id === from) || !nodes.some((node) => node.id === to)) return;
    const edges = state.draft.edges || (state.draft.edges = []);
    if (edges.some((edge) => edge.from === from && edge.to === to)) return;
    edges.push({ from, to });
    saveDraft();
    render();
  }
  function removeEdge(index) {
    const edges = state.draft.edges || [];
    if (index < 0 || index >= edges.length) return;
    edges.splice(index, 1);
    saveDraft();
    render();
  }
  function renderEdgeList() {
    edgeList.innerHTML = '';
    const edges = relatedEdgesForSelected();
    if (!edges.length) {
      const empty = document.createElement('p');
      empty.className = 'edge-empty';
      empty.textContent = state.selectedId ? '当前节点没有关联连线。' : '当前还没有连线。';
      edgeList.appendChild(empty);
      return;
    }
    edges.forEach((edge, index) => {
      const row = document.createElement('div');
      row.className = 'edge-row' + (state.selectedId && (edge.from === state.selectedId || edge.to === state.selectedId) ? ' is-related' : '');
      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'edge-item';
      label.textContent = `${nodeLabel(edge.from)} → ${nodeLabel(edge.to)}`;
      label.addEventListener('click', () => {
        if (nodeById(edge.from)) edgeFromSelect.value = edge.from;
        if (nodeById(edge.to)) edgeToSelect.value = edge.to;
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'button button--subtle edge-delete';
      remove.textContent = '删除';
      remove.addEventListener('click', () => {
        const allEdges = state.draft.edges || [];
        const targetIndex = allEdges.indexOf(edge);
        if (targetIndex >= 0) removeEdge(targetIndex);
      });
      row.append(label, remove);
      edgeList.appendChild(row);
    });
  }
  function uniqueNodeId(base) {
    const safeBase = String(base || 'new_node').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'new_node';
    const taken = new Set((state.draft.nodes || []).map((node) => String(node.id || '')));
    if (!taken.has(safeBase)) return safeBase;
    let index = 2;
    while (taken.has(`${safeBase}_${index}`)) index += 1;
    return `${safeBase}_${index}`;
  }
  function createNode() {
    const nodes = state.draft.nodes || [];
    const selected = nodes.find((item) => item.id === state.selectedId) || nodes[0] || null;
    const baseName = '新节点';
    const id = uniqueNodeId('new_node');
    const node = {
      id,
      name: baseName,
      wikiUrl: null,
      originalX: selected ? finiteNumber(selected.originalX, 0) + 240 : 80,
      originalY: selected ? finiteNumber(selected.originalY, 0) + 120 : 80
    };
    syncNodeSize(node);
    nodes.push(node);
    markNewNode(id);
    if (selected && selected.id !== id) {
      const edges = state.draft.edges || (state.draft.edges = []);
      const exists = edges.some((edge) => edge.from === selected.id && edge.to === id);
      if (!exists) edges.push({ from: selected.id, to: id });
    }
    state.selectedId = id;
    saveDraft();
    selectNode(id);
  }

  function previewMetrics() {
    const nodes = state.draft.nodes || [];
    if (!nodes.length) return { x: 0, y: 0, width: 1600, height: 900 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of nodes) {
      const x = finiteNumber(node.originalX, 0), y = finiteNumber(node.originalY, 0), w = finiteNumber(node.width, 96), h = finiteNumber(node.height, 54);
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
    }
    const margin = 60;
    const worldWidth = Math.max(1, maxX - minX);
    const worldHeight = Math.max(1, maxY - minY);
    const centerX = minX + worldWidth / 2;
    const centerY = minY + worldHeight / 2;
    const viewWidth = Math.max(160, (worldWidth + margin * 2) / state.previewZoom);
    const viewHeight = Math.max(120, (worldHeight + margin * 2) / state.previewZoom);
    return {
      x: centerX - viewWidth / 2,
      y: centerY - viewHeight / 2,
      width: viewWidth,
      height: viewHeight
    };
  }
  function worldToScreen(x, y) {
    const box = preview.getBoundingClientRect();
    const scale = previewScale();
    const offsetX = (box.width - state.previewMap.width * scale) / 2;
    const offsetY = (box.height - state.previewMap.height * scale) / 2;
    return {
      x: offsetX + (x - state.previewMap.x) * scale,
      y: offsetY + (y - state.previewMap.y) * scale
    };
  }
  function screenToWorld(x, y) {
    const box = preview.getBoundingClientRect();
    const scale = previewScale();
    const offsetX = (box.width - state.previewMap.width * scale) / 2;
    const offsetY = (box.height - state.previewMap.height * scale) / 2;
    return {
      x: state.previewMap.x + (x - offsetX) / scale,
      y: state.previewMap.y + (y - offsetY) / scale
    };
  }
  function filteredNodes() { const query = String(state.query || '').trim().toLowerCase(); return (state.draft.nodes || []).filter((node) => !query || String(node.name || '').toLowerCase().includes(query)); }
  function selectNode(id) { state.selectedId = id; const node = (state.draft.nodes || []).find((item) => item.id === id); if (!node) return render(); fields.id.value = node.id || ''; fields.name.value = node.name || ''; fields.wiki.value = node.wikiUrl || ''; render(); }
  function applyForm() { const node = (state.draft.nodes || []).find((item) => item.id === fields.id.value); if (!node) return; node.name = fields.name.value.trim(); node.wikiUrl = fields.wiki.value.trim() || null; syncNodeSize(node); saveDraft(); render(); }
  function download(name, content) { const blob = new Blob([content], { type: 'application/json;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }
  async function savePair(nameA, contentA, nameB, contentB) {
    if (typeof window.showDirectoryPicker === 'function') {
      const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
      const writeFile = async (name, content) => {
        const handle = await dir.getFileHandle(name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
      };
      await writeFile(nameA, contentA);
      await writeFile(nameB, contentB);
      return true;
    }
    return false;
  }
  function renderList() { nodeList.innerHTML = ''; filteredNodes().slice(0, 400).forEach((node) => { const item = document.createElement('button'); item.type = 'button'; item.className = 'node-item' + (node.id === state.selectedId ? ' is-active' : ''); item.textContent = node.name || node.id; item.addEventListener('click', () => selectNode(node.id)); nodeList.appendChild(item); }); }
  function renderPreview() {
    previewTransform.innerHTML = '';
    syncAllNodeSize();
    const baseMap = previewMetrics();
    state.previewMap = {
      x: baseMap.x + state.panViewX,
      y: baseMap.y + state.panViewY,
      width: baseMap.width,
      height: baseMap.height
    };
    preview.setAttribute('viewBox', `${state.previewMap.x} ${state.previewMap.y} ${state.previewMap.width} ${state.previewMap.height}`);
    const nodes = state.draft.nodes || []; const edges = state.draft.edges || []; const index = new Map(nodes.map((node) => [node.id, node]));
    for (const edge of edges.slice(0, 500)) {
      const from = index.get(edge.from); const to = index.get(edge.to); if (!from || !to) continue;
      const startX = finiteNumber(from.originalX, 0) + finiteNumber(from.width, 96) / 2;
      const startY = finiteNumber(from.originalY, 0) + finiteNumber(from.height, 54);
      const endX = finiteNumber(to.originalX, 0) + finiteNumber(to.width, 96) / 2;
      const endY = finiteNumber(to.originalY, 0);
      const midY = (startY + endY) / 2;
      const related = state.selectedId && (edge.from === state.selectedId || edge.to === state.selectedId);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('class', 'preview-edge' + (related ? ' is-related' : '')); path.setAttribute('d', `M ${startX} ${startY} L ${startX} ${midY} L ${endX} ${midY} L ${endX} ${endY}`); previewTransform.appendChild(path);
    }
    for (const node of nodes.slice(0, 300)) {
      const x = finiteNumber(node.originalX, 0), y = finiteNumber(node.originalY, 0), w = finiteNumber(node.width, 96), h = finiteNumber(node.height, 54), topLeft = { x, y };
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g'); group.setAttribute('class', 'preview-node' + (node.id === state.selectedId ? ' is-selected' : '') + (state.newNodeIds.has(node.id) ? ' is-new' : '')); group.dataset.nodeId = node.id;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); rect.setAttribute('x', topLeft.x); rect.setAttribute('y', topLeft.y); rect.setAttribute('width', w); rect.setAttribute('height', h);
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text'); text.setAttribute('x', topLeft.x + 10); text.setAttribute('y', topLeft.y + 24); text.textContent = nodeText(node);
      const note = document.createElementNS('http://www.w3.org/2000/svg', 'text'); note.setAttribute('class', 'node-note'); note.setAttribute('x', topLeft.x + 10); note.setAttribute('y', topLeft.y + h - 10); note.textContent = '拖动调整';
      group.append(rect, text, note); previewTransform.appendChild(group);
    }
  }
  function render() { renderList(); renderPreview(); syncEdgeSelects(); renderEdgeList(); }
  function findNodeByPoint(screenX, screenY) { const world = screenToWorld(screenX, screenY); const nodes = state.draft.nodes || []; for (let index = nodes.length - 1; index >= 0; index -= 1) { const node = nodes[index]; const left = finiteNumber(node.originalX, 0); const top = finiteNumber(node.originalY, 0); const right = left + finiteNumber(node.width, 96); const bottom = top + finiteNumber(node.height, 54); if (world.x >= left && world.x <= right && world.y >= top && world.y <= bottom) return node; } return null; }
  function getPointerPoint(event) { const rect = preview.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
  function beginDrag(event, node) { const point = screenToWorld(getPointerPoint(event).x, getPointerPoint(event).y); state.dragging = node.id; state.dragOffsetX = point.x - finiteNumber(node.originalX, 0); state.dragOffsetY = point.y - finiteNumber(node.originalY, 0); preview.setPointerCapture(event.pointerId); }
  function moveDrag(event) { if (!state.dragging) return; const node = (state.draft.nodes || []).find((item) => item.id === state.dragging); if (!node) return; const point = screenToWorld(getPointerPoint(event).x, getPointerPoint(event).y); node.originalX = Math.max(0, point.x - state.dragOffsetX); node.originalY = Math.max(0, point.y - state.dragOffsetY); saveDraft(); renderPreview(); }
  function endDrag(event) { if (!state.dragging) return; state.dragging = null; try { preview.releasePointerCapture(event.pointerId); } catch (_) {} saveDraft(); render(); }
  function beginPan(event) {
    const point = getPointerPoint(event);
    state.panning = true;
    state.panStartX = point.x;
    state.panStartY = point.y;
    preview.setPointerCapture(event.pointerId);
    preview.classList.add('is-panning');
  }
  function movePan(event) {
    if (!state.panning) return;
    const point = getPointerPoint(event);
    const scale = previewScale() || 1;
    state.panViewX -= (point.x - state.panStartX) / scale;
    state.panViewY -= (point.y - state.panStartY) / scale;
    state.panStartX = point.x;
    state.panStartY = point.y;
    renderPreview();
  }
  function endPan(event) {
    if (!state.panning) return;
    state.panning = false;
    try { preview.releasePointerCapture(event.pointerId); } catch (_) {}
    preview.classList.remove('is-panning');
    renderPreview();
  }
  function init() {
    branchSelect.innerHTML = BRANCHES.map((branch) => `<option value="${branch.id}">${branch.label}</option>`).join('');
    branchSelect.value = state.branch; state.draft = loadDraft() || getData(); syncAllNodeSize(); const first = state.draft.nodes && state.draft.nodes[0]; if (first) state.selectedId = first.id; if (state.selectedId) selectNode(state.selectedId); render();
    branchSelect.addEventListener('change', () => { state.branch = branchSelect.value; }); nodeSearch.addEventListener('input', () => { state.query = nodeSearch.value; renderList(); }); form.addEventListener('submit', (event) => { event.preventDefault(); applyForm(); });
    addNodeButton.addEventListener('click', () => { createNode(); });
    addEdgeButton.addEventListener('click', () => { addEdge(); });
    edgeFromSelect.addEventListener('change', () => { if (edgeToSelect.value === edgeFromSelect.value) { const alt = (state.draft.nodes || []).find((node) => node.id !== edgeFromSelect.value); if (alt) edgeToSelect.value = alt.id; } });
    document.getElementById('reset-draft').addEventListener('click', () => { state.draft = getData(); clearNewNodeMarks(); syncAllNodeSize(); state.selectedId = state.draft.nodes[0] && state.draft.nodes[0].id; saveDraft(); render(); });
    document.getElementById('export-draft').addEventListener('click', () => download('wt-tree-draft.json', JSON.stringify(state.draft, null, 2)));
    document.getElementById('commit-draft').addEventListener('click', async () => {
      const committed = clone(state.draft);
      const content = 'globalThis.WT_TREE_DATA = Object.freeze(' + JSON.stringify(committed) + ');';
      clearNewNodeMarks();
      const wroteToFolder = await savePair('data.js', content, 'data.text.js', content);
      if (!wroteToFolder) {
        download('data.js', content);
        download('data.text.js', content);
      }
    });
    previewZoomIn.addEventListener('click', () => { state.previewZoom = Math.min(40, Math.round((state.previewZoom + 0.15) * 100) / 100); renderPreview(); });
    previewZoomOut.addEventListener('click', () => { state.previewZoom = Math.max(0.4, Math.round((state.previewZoom - 0.15) * 100) / 100); renderPreview(); });
    previewZoomReset.addEventListener('click', () => { state.previewZoom = 1; renderPreview(); });
    preview.addEventListener('wheel', (event) => { event.preventDefault(); state.previewZoom = Math.max(0.4, Math.min(40, Math.round((state.previewZoom + (event.deltaY < 0 ? 0.1 : -0.1)) * 100) / 100)); renderPreview(); }, { passive: false });
    preview.addEventListener('pointerdown', (event) => { const point = getPointerPoint(event); const target = findNodeByPoint(point.x, point.y); if (target) { state.selectedId = target.id; selectNode(target.id); beginDrag(event, target); return; } beginPan(event); });
    preview.addEventListener('pointermove', (event) => { moveDrag(event); movePan(event); });
    preview.addEventListener('pointerup', (event) => { endDrag(event); endPan(event); });
    preview.addEventListener('pointercancel', (event) => { endDrag(event); endPan(event); });
  }
  init();
}());
