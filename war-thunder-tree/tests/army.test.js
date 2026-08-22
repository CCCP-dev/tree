const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../js/core.js');
const army = require('../js/army.js');

function createElement(tagName, document) {
  const attributes = new Map();
  const listeners = new Map();
  const classes = new Set();
  return {
    tagName,
    children: [],
    parentNode: null,
    textContent: '',
    value: '',
    listeners,
    set className(value) {
      classes.clear();
      String(value).split(/\s+/).filter(Boolean).forEach((name) => classes.add(name));
    },
    get className() {
      return Array.from(classes).join(' ');
    },
    style: {
      setProperty() {}
    },
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle: (name, force) => {
        const next = force === undefined ? !classes.has(name) : !!force;
        if (next) classes.add(name);
        else classes.delete(name);
        return next;
      }
    },
    append(...children) {
      for (const child of children) {
        if (child && typeof child === 'object') child.parentNode = this;
        this.children.push(child);
      }
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
      if (name === 'class') {
        classes.clear();
        String(value).split(/\s+/).filter(Boolean).forEach((token) => classes.add(token));
      }
    },
    getAttribute(name) {
      return attributes.get(name) || null;
    },
    getBoundingClientRect() {
      return { width: 800, height: 600, left: 0, top: 0 };
    },
    querySelectorAll(selector) {
      if (selector === 'button') return this.children.filter((child) => child.tagName === 'button');
      return [];
    },
    remove() {
      if (!this.parentNode) return;
      const index = this.parentNode.children.indexOf(this);
      if (index >= 0) this.parentNode.children.splice(index, 1);
      this.parentNode = null;
    },
    closest() {
      return null;
    },
    focus() {
      document.activeElement = this;
    },
    setPointerCapture() {},
    hasPointerCapture() {
      return false;
    },
    releasePointerCapture() {}
  };
}

function createBrowserEnvironment(overrides = {}) {
  const elements = {};
  const storage = new Map();
  const document = {
    activeElement: null,
    querySelector(selector) {
      return elements[selector] || null;
    },
    createElement(tagName) {
      return createElement(tagName, document);
    },
    createElementNS(namespace, tagName) {
      assert.equal(namespace, 'http://www.w3.org/2000/svg');
      return createElement(tagName, document);
    }
  };
  for (const selector of [
    '#research-canvas', '#research-layer', '#graph-status', '#vehicle-search',
    '#search-status', '#zoom-in', '#zoom-out', '#reset-view', '#marker-toggle', '#marker-clear', '#marker-users'
  ]) {
    elements[selector] = createElement(selector.slice(1), document);
  }

  const data = {
    meta: { source: 'army-browser-test' },
    nodes: [
      { id: 'root', name: 'Root', wikiUrl: '', originalX: 0, originalY: 0, width: 100, height: 50 },
      { id: 'child', name: 'Child', wikiUrl: '', originalX: 100, originalY: 100, width: 100, height: 50 }
    ],
    edges: [{ id: 'root-child', from: 'root', to: 'child', inferred: false }]
  };
  let layoutCalls = 0;
  let indexCalls = 0;
  const observed = [];
  const environment = {
    document,
    location: { href: '' },
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
      removeItem(key) {
        storage.delete(key);
      }
    },
    WT_TREE_DATA: data,
    WTCore: {
      ...core,
      layoutGraph(...args) {
        layoutCalls += 1;
        return core.layoutGraph(...args);
      },
      buildIndex(...args) {
        indexCalls += 1;
        return core.buildIndex(...args);
      }
    },
    ResizeObserver: class {
      constructor(callback) {
        this.callback = callback;
      }
      observe(element) {
        observed.push(element);
      }
      disconnect() {}
    },
    requestAnimationFrame(callback) {
      callback();
    },
    addEventListener() {},
    removeEventListener() {},
    ...overrides
  };
  return { environment, document, elements, storage, calls: { layout: () => layoutCalls, index: () => indexCalls }, observed };
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

test('init is safe to call from Node without a DOM', () => {
  assert.equal(army.init(), null);
});

test('init uses the supplied browser environment to layout, index, and render a literal graph', () => {
  const fixture = createBrowserEnvironment();
  let result;

  assert.doesNotThrow(() => {
    result = withGlobalDocument(fixture.document, () => army.init(fixture.environment));
  });

  assert.equal(fixture.calls.layout(), 1);
  assert.equal(fixture.calls.index(), 1);
  assert.ok(result);
  const [edgesGroup, nodesGroup] = fixture.elements['#research-layer'].children;
  assert.equal(edgesGroup.children.length, 1);
  assert.equal(nodesGroup.children.length, 2);
});

test('init contains environment failures and reports them through graph status', () => {
  const fixture = createBrowserEnvironment();
  Object.defineProperty(fixture.environment, 'WT_TREE_DATA', {
    get() {
      throw new Error('data getter failed');
    }
  });

  assert.doesNotThrow(() => withGlobalDocument(fixture.document, () => army.init(fixture.environment)));
  assert.equal(fixture.elements['#graph-status'].classList.contains('is-error'), true);
  assert.notEqual(fixture.elements['#graph-status'].textContent, '');
});

test('safeInitialize reports initialization errors without letting them escape', () => {
  const failure = new Error('layout failed');
  let reported;

  assert.doesNotThrow(() => army.safeInitialize(() => { throw failure; }, (error) => { reported = error; }));
  assert.equal(reported, failure);
});

test('clampScale constrains values to the supported zoom range', () => {
  assert.equal(army.clampScale(0.01), 0.08);
  assert.equal(army.clampScale(1.25), 1.25);
  assert.equal(army.clampScale(8), 2.5);
});

test('fitViewport fits the real research graph inside 48px padding', () => {
  const fitted = army.fitViewport(2704, 5754, 1280, 720, 48);

  assert.equal(fitted.x >= 48, true);
  assert.equal(fitted.y >= 48, true);
  assert.equal(fitted.x + 2704 * fitted.scale <= 1232, true);
  assert.equal(fitted.y + 5754 * fitted.scale <= 672, true);
});

test('fitViewport remains finite when graph or viewport dimensions are zero', () => {
  for (const dimensions of [[0, 0, 0, 0], [1, 1, 320, 200]]) {
    const viewport = army.fitViewport(...dimensions, 48);
    assert.equal(Number.isFinite(viewport.x), true);
    assert.equal(Number.isFinite(viewport.y), true);
    assert.equal(Number.isFinite(viewport.scale), true);
  }
});

test('setupAutoFit uses observer sizing only for the first fit and preserves window resize refits', () => {
  const measurements = [{ width: 0, height: 0 }, { width: 640, height: 480 }, { width: 800, height: 600 }];
  const fitted = [];
  let notifyObserver;
  let notifyWindowResize;

  army.setupAutoFit(
    () => measurements.shift(),
    (observerNotify, windowResizeNotify) => {
      notifyObserver = observerNotify;
      notifyWindowResize = windowResizeNotify;
      return () => {};
    },
    (run) => run(),
    (size) => fitted.push(size)
  );

  assert.deepEqual(fitted, []);
  notifyObserver();
  assert.deepEqual(fitted, [{ width: 640, height: 480 }]);
  notifyObserver();
  assert.deepEqual(fitted, [{ width: 640, height: 480 }]);
  notifyWindowResize();
  assert.deepEqual(fitted, [{ width: 640, height: 480 }, { width: 800, height: 600 }]);
});

test('zoomAroundPoint keeps the pointer world coordinate stable', () => {
  const state = { x: 40, y: 65, scale: 1 };
  const pointerX = 160;
  const pointerY = 125;
  const before = { x: (pointerX - state.x) / state.scale, y: (pointerY - state.y) / state.scale };
  const zoomed = army.zoomAroundPoint(state, pointerX, pointerY, 1.5);

  assert.deepEqual(
    { x: (pointerX - zoomed.x) / zoomed.scale, y: (pointerY - zoomed.y) / zoomed.scale },
    before
  );
  assert.equal(zoomed.scale, 1.5);
});

test('edgePath deterministically connects bottom-center to top-center with a soft lane curve', () => {
  const from = { layoutX: 10, layoutY: 20, layoutWidth: 100, layoutHeight: 50 };
  const to = { layoutX: 200, layoutY: 300, layoutWidth: 100, layoutHeight: 50 };

  assert.match(army.edgePath(from, to, 0, 1), /^M 60 70 C [-0-9.]+ [-0-9.]+, [-0-9.]+ [-0-9.]+, 250 300$/);
});

test('edgePath avoids an obstacle placed between the source and target nodes', () => {
  const from = { layoutX: 10, layoutY: 20, layoutWidth: 100, layoutHeight: 50 };
  const to = { layoutX: 200, layoutY: 300, layoutWidth: 100, layoutHeight: 50 };
  const obstacle = { layoutX: 120, layoutY: 150, layoutWidth: 60, layoutHeight: 70 };
  const path = army.edgePath(from, to, 0, 1, [obstacle]);
  const numbers = path.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const start = { x: numbers[0], y: numbers[1] };
  const controlA = { x: numbers[2], y: numbers[3] };
  const controlB = { x: numbers[4], y: numbers[5] };
  const end = { x: numbers[6], y: numbers[7] };
  const rect = {
    left: obstacle.layoutX,
    right: obstacle.layoutX + obstacle.layoutWidth,
    top: obstacle.layoutY,
    bottom: obstacle.layoutY + obstacle.layoutHeight
  };

  function cubicPoint(t) {
    const u = 1 - t;
    return {
      x: u * u * u * start.x + 3 * u * u * t * controlA.x + 3 * u * t * t * controlB.x + t * t * t * end.x,
      y: u * u * u * start.y + 3 * u * u * t * controlA.y + 3 * u * t * t * controlB.y + t * t * t * end.y
    };
  }

  for (let step = 1; step < 24; step += 1) {
    const point = cubicPoint(step / 24);
    assert.equal(point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom, false);
  }
});

test('wrapLabel splits a long Chinese vehicle name into readable text-only lines', () => {
  const lines = army.wrapLabel('中华人民共和国主战坦克', 4);

  assert.deepEqual(lines, ['中华人民', '共和国主', '战坦克']);
  assert.equal(lines.length >= 1 && lines.length <= 3, true);
  assert.equal(lines.join(''), '中华人民共和国主战坦克');
  assert.equal(lines.some((line) => /[<>]/.test(line)), false);
});

test('labelMetrics keeps text inside the node and clears the wiki badge corner', () => {
  const metrics = army.labelMetrics({
    name: 'm4a3e2（76）',
    wikiUrl: 'https://example.com',
    layoutWidth: 96,
    layoutHeight: 54
  });

  assert.deepEqual(metrics.lines, ['m4a3e2（', '76）']);
  assert.equal(metrics.centerX, 42);
  assert.equal(metrics.startY >= 18, true);
  assert.equal(metrics.startY + metrics.lines.length * metrics.lineHeight <= 44, true);
});

test('marker toggle preserves existing markers when disabled', () => {
  const fixture = createBrowserEnvironment();
  const result = withGlobalDocument(fixture.document, () => army.init(fixture.environment));

  assert.ok(result);
  const toggle = fixture.elements['#marker-toggle'];
  const users = fixture.elements['#marker-users'].children;
  const node = fixture.elements['#research-layer'].children[1].children[0];
  const click = (element) => element.listeners.get('click')({ preventDefault() {}, stopImmediatePropagation() {} });

  click(toggle);
  click(users[0]);
  click(node);

  const markerGroup = node.children.find((child) => child.classList.contains('vehicle-node__markers'));
  assert.ok(markerGroup);
  assert.equal(markerGroup.children.length, 1);
  assert.equal(markerGroup.children[0].getAttribute('fill'), '#e36b6b');

  click(toggle);
  click(node);

  const markerGroupAfterDisable = node.children.find((child) => child.classList.contains('vehicle-node__markers'));
  assert.ok(markerGroupAfterDisable);
  assert.equal(markerGroupAfterDisable.children.length, 1);
});

test('marker state restores from localStorage on init', () => {
  const fixture = createBrowserEnvironment();
  fixture.storage.set('wt-tree-army-markers-v1', JSON.stringify({
    enabled: true,
    activeUser: 'user2',
    selections: [
      { nodeId: 'root', users: ['user1', 'user3'] }
    ]
  }));

  const result = withGlobalDocument(fixture.document, () => army.init(fixture.environment));
  assert.ok(result);

  const toggle = fixture.elements['#marker-toggle'];
  const userButtons = fixture.elements['#marker-users'].children;
  assert.equal(toggle.textContent, '关闭标记');
  assert.equal(userButtons[1].classList.contains('is-active'), true);

  const node = fixture.elements['#research-layer'].children[1].children[0];
  const markerGroup = node.children.find((child) => child.classList.contains('vehicle-node__markers'));
  assert.ok(markerGroup);
  assert.equal(markerGroup.children.length, 2);
  assert.deepEqual(
    markerGroup.children.map((child) => child.getAttribute('fill')).sort(),
    ['#8ed66d', '#e36b6b']
  );
});
