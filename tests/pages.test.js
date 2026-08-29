const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const pagePath = path.join(__dirname, '..', 'index.html');
const projectPath = path.join(__dirname, '..');
const publishedPages = ['index.html', '陆军.html', '载具.html', 'editor.html'];

function localReferences(html) {
  const references = [];
  for (const match of html.matchAll(/\bsrc\s*=\s*(["'])(.*?)\1/gi)) {
    references.push(match[2]);
  }
  for (const match of html.matchAll(/<(?:link|a)\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>/gi)) {
    references.push(match[2]);
  }
  return references.filter((reference) => {
    const value = reference.trim();
    return value && !value.startsWith('#') && !value.startsWith('?') &&
      !/^(?:mailto:|https?:\/\/)/i.test(value);
  });
}

function publishedFiles() {
  return [
    ...publishedPages.map((filename) => path.join(projectPath, filename)),
    ...fs.readdirSync(path.join(projectPath, 'css')).filter((filename) => filename.endsWith('.css')).map((filename) => path.join(projectPath, 'css', filename)),
    ...fs.readdirSync(path.join(projectPath, 'js')).filter((filename) => filename.endsWith('.js')).map((filename) => path.join(projectPath, 'js', filename))
  ];
}

function hasForbiddenRootRelativePath(source) {
  return /(?:\b(?:src|href)\s*=\s*["']|url\(\s*["']?|["'`])\/(?!\/)/i.test(source);
}

function readPage() {
  return fs.readFileSync(pagePath, 'utf8');
}

test('landing page exposes exactly the navy, army, and air branch buttons', () => {
  const html = readPage();
  const branches = [...html.matchAll(/\bdata-branch="([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(branches, ['navy', 'army', 'air']);
  assert.equal((html.match(/<button\b/g) || []).length, 3);
});

test('landing page provides the native pending-data dialog', () => {
  const html = readPage();

  assert.match(html, /<dialog\b[^>]*\bid="empty-state"/);
  assert.match(html, /data-empty-name/);
  assert.match(html, /data-dialog-close/);
});

test('landing page links only the required relative local stylesheet and script', () => {
  const html = readPage();

  assert.match(html, /<link\b[^>]*href="css\/styles\.css"/);
  assert.match(html, /<script\b[^>]*src="js\/home\.js"/);
  assert.doesNotMatch(html, /(?:src|href)="\//);
});

test('landing page carries Chinese document metadata and accessible branch semantics', () => {
  const html = readPage();

  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<html\b[^>]*\blang="zh-CN"/);
  assert.match(html, /<meta\b[^>]*\bname="viewport"/);
  assert.match(html, /<meta\b[^>]*\bname="description"/);
  assert.match(html, /<h1\b[^>]*>/);
  assert.match(html, /<button\b[^>]*data-branch="army"[^>]*>[\s\S]*?122[\s\S]*?<\/button>/);
});

test('army page exposes the interactive research canvas contract in dependency order', () => {
  const armyPath = path.join(__dirname, '..', '陆军.html');
  const html = fs.readFileSync(armyPath, 'utf8');

  assert.match(html, /<html\b[^>]*\blang="zh-CN"/);
  assert.match(html, /<meta\b[^>]*charset="UTF-8"/i);
  assert.match(html, /<meta\b[^>]*\bname="viewport"/);
  assert.match(html, /<a\b[^>]*href="首页\.html"/);
  for (const id of ['vehicle-search', 'search-status', 'zoom-in', 'zoom-out', 'reset-view', 'research-canvas', 'research-layer', 'graph-status']) {
    assert.match(html, new RegExp('\\bid="' + id + '"'));
  }
  assert.match(html, /<defs>[\s\S]*?<marker\b/);

  const scriptSources = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(scriptSources.slice(-3), ['js/data.js', 'js/core.js', 'js/army.js']);
});

test('army research region keeps semantics without making the canvas a dead-end focus stop', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '陆军.html'), 'utf8');
  const canvasTag = html.match(/<svg\b[^>]*\bid="research-canvas"[^>]*>/)?.[0];

  assert.ok(canvasTag, 'army page exposes the research canvas SVG');
  assert.match(canvasTag, /\brole="region"/);
  assert.match(canvasTag, /\baria-label="[^"]+"/);
  assert.doesNotMatch(canvasTag, /\btabindex=/i, 'the canvas itself is not a dead-end keyboard focus stop');
});

test('army arrowhead declares a visible non-black fill on the dark canvas', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '陆军.html'), 'utf8');
  const arrowheadPath = html.match(/<marker\b[^>]*\bid="arrowhead"[\s\S]*?<path\b[^>]*>/)?.[0];

  assert.ok(arrowheadPath, 'army page defines an arrowhead path');
  assert.match(arrowheadPath, /\bfill="(?!black|#000(?:000)?\b)[^"]+"/i, 'arrowhead declares a non-black fill');
});

test('vehicle page provides the detail regions, relative breadcrumbs, and script dependencies', () => {
  const vehiclePath = path.join(__dirname, '..', '载具.html');
  const html = fs.readFileSync(vehiclePath, 'utf8');

  assert.match(html, /<html\b[^>]*\blang="zh-CN"/);
  assert.match(html, /<meta\b[^>]*\bcharset="UTF-8"/i);
  assert.match(html, /<meta\b[^>]*\bname="viewport"/);
  assert.match(html, /<meta\b[^>]*\bname="description"/);
  assert.match(html, /<a\b[^>]*href="首页\.html"/);
  assert.match(html, /<a\b[^>]*href="陆军\.html"/);
  for (const id of ['not-found', 'vehicle-title', 'wiki-url', 'wiki-link', 'previous-list', 'next-list']) {
    assert.match(html, new RegExp('\\bid="' + id + '"'));
  }

  const scriptSources = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(scriptSources.slice(-3), ['js/data.js', 'js/core.js', 'js/vehicle.js']);
});

test('fallback pending dialog moves focus, exposes modal semantics, and restores the triggering branch', () => {
  class FakeElement {
    constructor(document, dataset = {}) {
      this.document = document;
      this.dataset = dataset;
      this.attributes = new Map();
      this.listeners = new Map();
      this.classList = {
        values: new Set(),
        add: (value) => this.classList.values.add(value),
        remove: (value) => this.classList.values.delete(value),
        contains: (value) => this.classList.values.has(value),
      };
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    click() {
      this.listeners.get('click')();
    }

    focus() {
      this.document.activeElement = this;
    }

    setAttribute(name, value) {
      this.attributes.set(name, value);
    }

    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }

    hasAttribute(name) {
      return this.attributes.has(name);
    }

    removeAttribute(name) {
      this.attributes.delete(name);
    }
  }

  const document = { activeElement: null };
  const dialog = new FakeElement(document);
  const emptyName = new FakeElement(document);
  const closeControl = new FakeElement(document);
  const navy = new FakeElement(document, { branch: 'navy' });
  const army = new FakeElement(document, { branch: 'army' });
  const air = new FakeElement(document, { branch: 'air' });

  dialog.querySelector = (selector) => ({
    '[data-empty-name]': emptyName,
    '[data-dialog-close]': closeControl,
  })[selector] || null;
  document.querySelector = (selector) => (selector === '#empty-state' ? dialog : null);
  document.querySelectorAll = (selector) => (selector === '[data-branch]' ? [navy, army, air] : []);

  const script = fs.readFileSync(path.join(__dirname, '..', 'js', 'home.js'), 'utf8');
  vm.runInNewContext(script, { document, window: { location: {} } });

  navy.click();

  assert.equal(emptyName.textContent, '海军');
  assert.equal(document.activeElement, closeControl);
  assert.equal(dialog.hasAttribute('open'), true);
  assert.equal(dialog.classList.contains('is-fallback-visible'), true);
  assert.equal(dialog.getAttribute('role'), 'dialog');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');

  closeControl.click();

  assert.equal(dialog.hasAttribute('open'), false);
  assert.equal(dialog.classList.contains('is-fallback-visible'), false);
  assert.equal(dialog.hasAttribute('aria-modal'), false);
  assert.equal(document.activeElement, navy);
});

test('every local script, stylesheet, and navigation target resolves from its published page', () => {
  for (const filename of publishedPages) {
    const page = path.join(projectPath, filename);
    const html = fs.readFileSync(page, 'utf8');
    for (const reference of localReferences(html)) {
      const target = reference.split(/[?#]/, 1)[0];
      assert.ok(fs.existsSync(path.resolve(path.dirname(page), target)), `${filename} references existing ${reference}`);
    }
  }
});

test('root-relative path detector catches JavaScript literals without rejecting protocol or relative paths', () => {
  const samples = [
    "const asset = '/js/data.js';",
    "location.href = '/载具.html';",
    "const namespace = 'http://www.w3.org/2000/svg';",
    "const wiki = 'https://example.com/wiki';",
    "const asset = 'js/data.js';",
    "const parent = '../载具.html';"
  ];

  assert.deepEqual(samples.map(hasForbiddenRootRelativePath), [true, true, false, false, false, false]);
});

test('published assets contain no local-machine or root-relative deployment paths', () => {
  for (const filename of publishedFiles()) {
    const source = fs.readFileSync(filename, 'utf8');
    assert.doesNotMatch(source, /file:/i, `${path.basename(filename)} has no file URL`);
    assert.doesNotMatch(source, /(?<![a-z])[a-z]:[\\/]/i, `${path.basename(filename)} has no Windows absolute path`);
    assert.equal(hasForbiddenRootRelativePath(source), false, `${path.basename(filename)} has no root-relative asset path`);
    assert.doesNotMatch(source, /(?:localhost|127\.0\.0\.1)/i, `${path.basename(filename)} has no local server address`);
  }
});

test('published interactive scripts render without innerHTML', () => {
  for (const filename of ['army.js', 'vehicle.js']) {
    const source = fs.readFileSync(path.join(projectPath, 'js', filename), 'utf8');
    assert.doesNotMatch(source, /\binnerHTML\b/, `${filename} does not use innerHTML`);
  }
});
