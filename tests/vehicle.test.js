const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../js/core.js');
const vehicle = require('../js/vehicle.js');

function fixture() {
  return {
    meta: { source: 'vehicle-test' },
    nodes: [
      { id: 'previous-a', name: '前置 A', wikiUrl: '', originalX: 0, originalY: 0, width: 120, height: 60 },
      { id: 'previous-b', name: '前置 B', wikiUrl: '', originalX: 120, originalY: 0, width: 120, height: 60 },
      { id: 'target node', name: '目标载具', wikiUrl: 'https://example.test/target', originalX: 60, originalY: 100, width: 120, height: 60 },
      { id: '后续 节点', name: '后续 A', wikiUrl: '', originalX: 0, originalY: 200, width: 120, height: 60 },
      { id: 'next-b', name: '后续 B', wikiUrl: '', originalX: 120, originalY: 200, width: 120, height: 60 },
      { id: 'unlinked', name: '独立载具', wikiUrl: '', originalX: 300, originalY: 0, width: 120, height: 60 }
    ],
    edges: [
      { id: 'previous-a-target', from: 'previous-a', to: 'target node', inferred: false },
      { id: 'previous-b-target', from: 'previous-b', to: 'target node', inferred: false },
      { id: 'target-next-a', from: 'target node', to: '后续 节点', inferred: false },
      { id: 'target-next-b', from: 'target node', to: 'next-b', inferred: false }
    ]
  };
}

function createElement(tagName) {
  const attributes = new Map();
  return {
    tagName,
    children: [],
    hidden: false,
    className: '',
    textContent: '',
    append(...nodes) {
      this.children.push(...nodes);
    },
    removeChild(node) {
      this.children.splice(this.children.indexOf(node), 1);
    },
    removeAttribute(name) {
      attributes.delete(name);
      delete this[name];
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    get firstChild() {
      return this.children[0] || null;
    }
  };
}

function createDocument(elements) {
  return {
    title: '',
    querySelector(selector) {
      return elements[selector] || null;
    },
    createElement
  };
}

function withGlobalDocument(document, run) {
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    return run();
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
}

test('createViewModel returns every predecessor and successor in the research direction', () => {
  const model = vehicle.createViewModel(fixture(), core, 'target node');

  assert.deepEqual(model.previous.map((node) => node.id), ['previous-a', 'previous-b']);
  assert.deepEqual(model.next.map((node) => node.id), ['后续 节点', 'next-b']);
});

test('createViewModel rejects unknown and empty ids', () => {
  assert.equal(vehicle.createViewModel(fixture(), core, 'missing'), null);
  assert.equal(vehicle.createViewModel(fixture(), core, ''), null);
});

test('createViewModel keeps an unlinked node valid with an empty wiki URL', () => {
  const model = vehicle.createViewModel(fixture(), core, 'unlinked');

  assert.equal(model.node.name, '独立载具');
  assert.equal(model.node.wikiUrl, '');
  assert.deepEqual(model.previous, []);
  assert.deepEqual(model.next, []);
});

test('related ids containing spaces or Unicode receive usable internal hrefs through the core helper', () => {
  const model = vehicle.createViewModel(fixture(), core, 'target node');

  assert.equal(core.vehicleHref(model.node.id), '载具.html?id=target%20node');
  assert.equal(core.vehicleHref(model.next[0].id), '载具.html?id=%E5%90%8E%E7%BB%AD%20%E8%8A%82%E7%82%B9');
});

test('init renders a linked vehicle, safe wiki link, and every related card from the supplied environment', () => {
  const elements = {
    '#vehicle-detail': createElement('main'),
    '#not-found': createElement('section'),
    '#not-found-message': createElement('p'),
    '#vehicle-title': createElement('h1'),
    '#wiki-url': createElement('p'),
    '#wiki-link': createElement('a'),
    '#previous-list': createElement('div'),
    '#next-list': createElement('div')
  };
  const document = createDocument(elements);
  const environment = {
    document,
    location: { search: '?id=target%20node' },
    WT_TREE_DATA: fixture(),
    WTCore: core
  };

  const model = withGlobalDocument(document, () => vehicle.init(environment));

  assert.equal(model.node.id, 'target node');
  assert.equal(elements['#vehicle-title'].textContent, '目标载具');
  assert.equal(elements['#wiki-url'].textContent, 'https://example.test/target');
  assert.equal(elements['#wiki-link'].href, 'https://example.test/target');
  assert.equal(elements['#wiki-link'].target, '_blank');
  assert.equal(elements['#wiki-link'].rel, 'noopener noreferrer');
  assert.equal(elements['#previous-list'].children.length, 2);
  assert.equal(elements['#next-list'].children.length, 2);
  assert.equal(elements['#previous-list'].children[0].href, '载具.html?id=previous-a');
  assert.equal(elements['#next-list'].children[0].href, '载具.html?id=%E5%90%8E%E7%BB%AD%20%E8%8A%82%E7%82%B9');
});

test('init shows a recoverable Chinese error panel when a normal detail element is missing', () => {
  const elements = {
    '#vehicle-detail': createElement('main'),
    '#not-found': createElement('section'),
    '#not-found-message': createElement('p'),
    '#vehicle-title': createElement('h1'),
    '#wiki-url': createElement('p'),
    '#wiki-link': createElement('a'),
    '#previous-list': createElement('div')
  };
  const document = createDocument(elements);
  const environment = {
    document,
    location: { search: '?id=target%20node' },
    WT_TREE_DATA: fixture(),
    WTCore: core
  };

  assert.doesNotThrow(() => withGlobalDocument(document, () => vehicle.init(environment)));
  assert.equal(elements['#vehicle-detail'].hidden, true);
  assert.equal(elements['#not-found'].hidden, false);
  assert.match(elements['#not-found-message'].textContent, /加载失败|无法显示/);
});
