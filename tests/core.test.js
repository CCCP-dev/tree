const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildIndex,
  getRelations,
  searchNodes,
  layoutGraph,
  vehicleHref
} = require('../js/core.js');

function fixture() {
  return {
    meta: { source: 'test' },
    nodes: [
      { id: 'a', name: 'Alpha', wikiUrl: '', originalX: 100, originalY: 0, width: 120, height: 60 },
      { id: 'b', name: 'Bravo', wikiUrl: '', originalX: 50, originalY: 100, width: 120, height: 60 },
      { id: 'c', name: 'Charlie', wikiUrl: '', originalX: 200, originalY: 100, width: 120, height: 60 },
      { id: 'kv1', name: 'KV1（早）', wikiUrl: '', originalX: 350, originalY: 0, width: 120, height: 60 }
    ],
    edges: [
      { id: 'a-b', from: 'a', to: 'b', inferred: false },
      { id: 'a-c', from: 'a', to: 'c', inferred: false }
    ]
  };
}

test('buildIndex exposes A successors and B predecessor through getRelations', () => {
  const index = buildIndex(fixture());

  const fromA = getRelations(index, 'a');
  const fromB = getRelations(index, 'b');

  assert.deepEqual(fromA.next.map((node) => node.id), ['b', 'c']);
  assert.deepEqual(fromB.previous.map((node) => node.id), ['a']);
});

test('getRelations returns null for an unknown id', () => {
  assert.equal(getRelations(buildIndex(fixture()), 'missing'), null);
});

test('searchNodes trims case-insensitive queries and finds Chinese-named KV1', () => {
  const results = searchNodes(buildIndex(fixture()), '  kv1 ');

  assert.deepEqual(results.map((node) => node.id), ['kv1']);
});

test('searchNodes returns no matches for an empty query', () => {
  const index = buildIndex(fixture());

  assert.deepEqual(searchNodes(index, ''), []);
  assert.deepEqual(searchNodes(index, '   '), []);
});

test('vehicleHref encodes an id in a relative URL', () => {
  assert.equal(vehicleHref('id with space'), '载具.html?id=id%20with%20space');
});

test('layoutGraph puts successors below their parent at distinct horizontal positions', () => {
  const layout = layoutGraph(fixture(), {
    nodeWidth: 120,
    nodeHeight: 60,
    columnGap: 30,
    rowGap: 40
  });
  const nodes = new Map(layout.nodes.map((node) => [node.id, node]));

  assert.ok(nodes.get('b').layoutY > nodes.get('a').layoutY);
  assert.ok(nodes.get('c').layoutY > nodes.get('a').layoutY);
  assert.notEqual(nodes.get('b').layoutX, nodes.get('c').layoutX);
});

test('layoutGraph copies input data rather than mutating it', () => {
  const data = fixture();
  const before = structuredClone(data);

  layoutGraph(data, { nodeWidth: 120, nodeHeight: 60, columnGap: 30, rowGap: 40 });

  assert.deepEqual(data, before);
});

test('layoutGraph gives every cycle node finite coordinates', () => {
  const data = {
    meta: {},
    nodes: [
      { id: 'x', name: 'X', wikiUrl: '', originalX: 0, originalY: 0, width: 100, height: 50 },
      { id: 'y', name: 'Y', wikiUrl: '', originalX: 100, originalY: 50, width: 100, height: 50 }
    ],
    edges: [
      { id: 'x-y', from: 'x', to: 'y', inferred: false },
      { id: 'y-x', from: 'y', to: 'x', inferred: false }
    ]
  };

  const layout = layoutGraph(data, { nodeWidth: 100, nodeHeight: 50, columnGap: 20, rowGap: 30 });

  assert.equal(layout.nodes.length, 2);
  assert.deepEqual(layout.nodes.map((node) => node.id).sort(), ['x', 'y']);
  for (const node of layout.nodes) {
    assert.ok(Number.isFinite(node.layoutX));
    assert.ok(Number.isFinite(node.layoutY));
  }
});
