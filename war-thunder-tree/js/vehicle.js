(function attachVehicle(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WTVehicle = api;
  if (root && root.document) api.init(root);
}(globalThis, function createVehicle() {
  const NO_WIKI_MESSAGE = '暂无维基链接';
  const EMPTY_PREVIOUS_MESSAGE = '暂无前置研发载具。';
  const EMPTY_NEXT_MESSAGE = '暂无后续研发载具。';

  function createViewModel(data, core, id) {
    if (!id || !data || !core || typeof core.buildIndex !== 'function' || typeof core.getRelations !== 'function') return null;
    const relations = core.getRelations(core.buildIndex(data), id);
    if (!relations || !relations.node) return null;
    return { node: relations.node, previous: relations.previous || [], next: relations.next || [] };
  }

  function setHidden(element, hidden) {
    if (element) element.hidden = hidden;
  }

  function renderRelatedList(document, container, nodes, core, emptyMessage) {
    while (container.firstChild) container.removeChild(container.firstChild);
    if (!nodes.length) {
      const empty = document.createElement('p');
      empty.className = 'relation-empty';
      empty.textContent = emptyMessage;
      container.append(empty);
      return;
    }
    for (const node of nodes) {
      const link = document.createElement('a');
      link.className = 'related-card';
      link.href = core.vehicleHref(node.id);
      link.textContent = String(node.name || node.id);
      container.append(link);
    }
  }

  function showNotFound(document, elements, message) {
    setHidden(elements.detail, true);
    setHidden(elements.notFound, false);
    if (elements.message) elements.message.textContent = message;
    document.title = '未找到载具｜战争雷霆科技树';
  }

  function init(environment) {
    const root = environment || globalThis;
    const document = root && root.document;
    if (!document) return null;
    const elements = {
      detail: document.querySelector('#vehicle-detail'),
      notFound: document.querySelector('#not-found'),
      message: document.querySelector('#not-found-message'),
      title: document.querySelector('#vehicle-title'),
      wikiUrl: document.querySelector('#wiki-url'),
      wikiLink: document.querySelector('#wiki-link'),
      previous: document.querySelector('#previous-list'),
      next: document.querySelector('#next-list')
    };

    if (!elements.detail || !elements.notFound || !elements.title || !elements.wikiUrl || !elements.wikiLink || !elements.previous || !elements.next) {
      showNotFound(document, elements, '载具详情页结构不完整，请返回研发总览后重试。');
      return null;
    }

    const id = new URLSearchParams(root.location && root.location.search || '').get('id');
    const core = root.WTCore;
    const model = createViewModel(root.WT_TREE_DATA, core, id);
    if (!model || !core || typeof core.vehicleHref !== 'function') {
      showNotFound(document, elements, '未找到该载具，请返回研发总览后重新选择。');
      return null;
    }

    setHidden(elements.detail, false);
    setHidden(elements.notFound, true);
    elements.title.textContent = String(model.node.name || model.node.id);
    document.title = elements.title.textContent + '｜战争雷霆科技树';

    if (model.node.wikiUrl) {
      elements.wikiUrl.textContent = String(model.node.wikiUrl);
      elements.wikiLink.href = String(model.node.wikiUrl);
      elements.wikiLink.target = '_blank';
      elements.wikiLink.rel = 'noopener noreferrer';
      setHidden(elements.wikiLink, false);
    } else {
      elements.wikiUrl.textContent = NO_WIKI_MESSAGE;
      elements.wikiLink.removeAttribute('href');
      elements.wikiLink.removeAttribute('target');
      elements.wikiLink.removeAttribute('rel');
      setHidden(elements.wikiLink, true);
    }
    renderRelatedList(document, elements.previous, model.previous, core, EMPTY_PREVIOUS_MESSAGE);
    renderRelatedList(document, elements.next, model.next, core, EMPTY_NEXT_MESSAGE);
    return model;
  }

  return { createViewModel, init };
}));
