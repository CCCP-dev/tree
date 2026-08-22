const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildIndex, getRelations, vehicleHref } = require('../js/core.js');

function loadData() {
  const filename = path.join(__dirname, '..', 'js', 'data.js');
  const source = fs.readFileSync(filename, 'utf8');
  const context = { globalThis: {} };
  vm.runInNewContext(source, context, { filename });
  return JSON.parse(JSON.stringify(context.globalThis.WT_TREE_DATA));
}

test('contains the deterministic War Thunder tree contract', () => {
  const data = loadData();
  assert.equal(data.nodes.length, 122);
  assert.equal(data.edges.length, 195);
  assert.equal(data.nodes.filter((node) => node.wikiUrl).length, 111);
  assert.equal(data.nodes.filter((node) => !node.wikiUrl).length, 11);
  const inferred = data.edges.filter((edge) => edge.inferred);
  assert.equal(inferred.length, 2);
  const namesById = new Map(data.nodes.map((node) => [node.id, node.name]));
  assert.deepEqual(inferred.map(({ from, to }) => [namesById.get(from), namesById.get(to)]).sort(), [
    ['25mm机炮', '反坦克短导弹'],
    ['88mm', '反坦克短导弹'],
  ]);
});

test('sorts node and edge records by ID for deterministic output', () => {
  const data = loadData();
  assert.deepEqual(data.nodes.map((node) => node.id), [...data.nodes].sort((a, b) => a.id.localeCompare(b.id)).map((node) => node.id));
  assert.deepEqual(data.edges.map((edge) => edge.id), [...data.edges].sort((a, b) => a.id.localeCompare(b.id)).map((edge) => edge.id));
});

test('generated data keeps its published node, edge, link, and inferred counts', () => {
  const data = loadData();

  assert.equal(data.nodes.length, 122);
  assert.equal(data.edges.length, 195);
  assert.equal(data.nodes.filter((node) => node.wikiUrl).length, 111);
  assert.equal(data.nodes.filter((node) => !node.wikiUrl).length, 11);
  assert.equal(data.edges.filter((edge) => edge.inferred).length, 2);
});

test('every generated edge connects existing nodes through the core relation index', () => {
  const data = loadData();
  const ids = new Set(data.nodes.map((node) => node.id));
  const index = buildIndex(data);

  for (const edge of data.edges) {
    assert.ok(ids.has(edge.from), `edge ${edge.id} has an existing source node`);
    assert.ok(ids.has(edge.to), `edge ${edge.id} has an existing target node`);
    assert.ok(
      getRelations(index, edge.from).next.some((node) => node.id === edge.to),
      `edge ${edge.id} appears in its source node's next relation`
    );
    assert.ok(
      getRelations(index, edge.to).previous.some((node) => node.id === edge.from),
      `edge ${edge.id} appears in its target node's previous relation`
    );
  }
});

test('every supplied wiki link is HTTPS', () => {
  const data = loadData();

  for (const node of data.nodes.filter((node) => node.wikiUrl)) {
    assert.match(node.wikiUrl, /^https:\/\//, `${node.id} has an HTTPS wiki URL`);
  }
});

test('every generated node detail link is relative and URL-encodes its id', () => {
  const data = loadData();

  for (const node of data.nodes) {
    assert.equal(vehicleHref(node.id), '载具.html?id=' + encodeURIComponent(node.id));
  }
});
