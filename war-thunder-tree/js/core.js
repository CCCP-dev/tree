(function attachCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.WTCore = api;
}(globalThis, function createCore() {
  const DEFAULT_LAYOUT = {
    nodeWidth: 180,
    nodeHeight: 72,
    columnGap: 32,
    rowGap: 40
  };

  function compareNodes(left, right) {
    const xDifference = numberOr(left.originalX, 0) - numberOr(right.originalX, 0);
    if (xDifference !== 0) return xDifference;

    const nameDifference = String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN');
    if (nameDifference !== 0) return nameDifference;

    return String(left.id).localeCompare(String(right.id), 'zh-CN');
  }

  function compareByOriginalY(left, right) {
    const yDifference = numberOr(left.originalY, 0) - numberOr(right.originalY, 0);
    return yDifference || compareNodes(left, right);
  }

  function numberOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function buildIndex(data) {
    const nodesById = new Map();
    const incoming = new Map();
    const outgoing = new Map();

    for (const node of data.nodes || []) {
      nodesById.set(node.id, node);
      incoming.set(node.id, []);
      outgoing.set(node.id, []);
    }

    for (const edge of data.edges || []) {
      if (nodesById.has(edge.from) && nodesById.has(edge.to)) {
        outgoing.get(edge.from).push(edge.to);
        incoming.get(edge.to).push(edge.from);
      }
    }

    return { data, nodesById, incoming, outgoing };
  }

  function getRelations(index, id) {
    const node = index.nodesById.get(id);
    if (!node) return null;

    return {
      node,
      previous: (index.incoming.get(id) || []).map((previousId) => index.nodesById.get(previousId)),
      next: (index.outgoing.get(id) || []).map((nextId) => index.nodesById.get(nextId))
    };
  }

  function searchNodes(index, query) {
    const normalized = String(query || '').trim().toLocaleLowerCase('zh-CN');
    if (!normalized) return [];
    return Array.from(index.nodesById.values())
      .filter((node) => String(node.name || '').toLocaleLowerCase('zh-CN').includes(normalized))
      .sort((left, right) => {
        const nameDifference = String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN');
        return nameDifference || String(left.id).localeCompare(String(right.id), 'zh-CN');
      });
  }

  function layoutGraph(data, options) {
    const settings = Object.assign({}, DEFAULT_LAYOUT, options || {});
    const nodeWidth = positiveNumber(settings.nodeWidth, DEFAULT_LAYOUT.nodeWidth);
    const nodeHeight = positiveNumber(settings.nodeHeight, DEFAULT_LAYOUT.nodeHeight);
    const nodes = (data.nodes || []).map((node) => Object.assign({}, node));
    const edges = (data.edges || []).map((edge) => Object.assign({}, edge));
    const minX = nodes.length ? Math.min(...nodes.map((node) => numberOr(node.originalX, 0))) : 0;
    const minY = nodes.length ? Math.min(...nodes.map((node) => numberOr(node.originalY, 0))) : 0;
    const padding = nonNegativeNumber(settings.padding, 40);
    let graphWidth = nodeWidth + padding * 2;
    let graphHeight = nodeHeight + padding * 2;

    for (const node of nodes) {
      node.layoutX = numberOr(node.originalX, 0) - minX + padding;
      node.layoutY = numberOr(node.originalY, 0) - minY + padding;
      node.layoutWidth = positiveNumber(node.width, nodeWidth);
      node.layoutHeight = positiveNumber(node.height, nodeHeight);
      graphWidth = Math.max(graphWidth, node.layoutX + node.layoutWidth + padding);
      graphHeight = Math.max(graphHeight, node.layoutY + node.layoutHeight + padding);
    }

    return { nodes, edges, width: graphWidth, height: graphHeight };
  }

  function findComponents(nodes, nodesById, undirected) {
    const seen = new Set();
    const components = [];
    for (const start of nodes) {
      if (seen.has(start.id)) continue;
      const queue = [start.id];
      const componentNodes = [];
      seen.add(start.id);
      for (let position = 0; position < queue.length; position += 1) {
        const id = queue[position];
        componentNodes.push(nodesById.get(id));
        for (const neighbor of undirected.get(id)) {
          if (!seen.has(neighbor)) {
            seen.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
      components.push({
        nodes: componentNodes,
        minOriginalX: Math.min(...componentNodes.map((node) => numberOr(node.originalX, 0)))
      });
    }
    return components.sort((left, right) => left.minOriginalX - right.minOriginalX || compareNodes(left.nodes[0], right.nodes[0]));
  }

  function assignLevels(component, edges, nodesById) {
    const ids = new Set(component.nodes.map((node) => node.id));
    const incomingCount = new Map(component.nodes.map((node) => [node.id, 0]));
    const children = new Map(component.nodes.map((node) => [node.id, []]));
    const parents = new Map(component.nodes.map((node) => [node.id, []]));
    for (const edge of edges) {
      if (ids.has(edge.from) && ids.has(edge.to) && nodesById.has(edge.from) && nodesById.has(edge.to)) {
        incomingCount.set(edge.to, incomingCount.get(edge.to) + 1);
        children.get(edge.from).push(edge.to);
        parents.get(edge.to).push(edge.from);
      }
    }

    const levels = new Map();
    const queue = component.nodes.filter((node) => incomingCount.get(node.id) === 0).sort(compareNodes);
    for (let position = 0; position < queue.length; position += 1) {
      const node = queue[position];
      const parentLevels = parents.get(node.id).map((parentId) => levels.get(parentId)).filter(Number.isFinite);
      levels.set(node.id, parentLevels.length ? Math.max(...parentLevels) + 1 : 0);
      for (const childId of children.get(node.id)) {
        incomingCount.set(childId, incomingCount.get(childId) - 1);
        if (incomingCount.get(childId) === 0) queue.push(nodesById.get(childId));
      }
      if (position + 1 < queue.length) {
        queue.slice(position + 1).sort(compareNodes).forEach((queuedNode, index) => {
          queue[position + 1 + index] = queuedNode;
        });
      }
    }

    const unresolved = component.nodes.filter((node) => !levels.has(node.id)).sort(compareByOriginalY);
    let fallbackLevel = levels.size ? Math.max(...levels.values()) + 1 : 0;
    for (const node of unresolved) {
      const resolvedParentLevels = parents.get(node.id).map((parentId) => levels.get(parentId)).filter(Number.isFinite);
      if (resolvedParentLevels.length) fallbackLevel = Math.max(fallbackLevel, Math.max(...resolvedParentLevels) + 1);
      levels.set(node.id, fallbackLevel);
      fallbackLevel += 1;
    }
    return levels;
  }

  function positiveNumber(value, fallback) {
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function nonNegativeNumber(value, fallback) {
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  function vehicleHref(id) {
    return '载具.html?id=' + encodeURIComponent(id);
  }

  return { buildIndex, getRelations, searchNodes, layoutGraph, vehicleHref };
}));
