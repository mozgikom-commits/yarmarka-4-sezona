(() => {
  const embedded = window.parent !== window;
  const trustedParent = 'https://xn--4-8sboi4afs.online';
  const navigation = performance.getEntriesByType('navigation')[0];
  const navigationType = navigation?.type || 'navigate';
  const postToParent = (type, payload = {}) => {
    if (!embedded) return;
    window.parent.postMessage({ type, page: location.href, ...payload }, trustedParent);
  };

  const pageHeight = () => Math.ceil(Math.max(
    document.documentElement.scrollHeight,
    document.body?.scrollHeight || 0,
    document.documentElement.offsetHeight,
    document.body?.offsetHeight || 0
  ));
  const reportHeight = () => postToParent('yarmarka-height', { height: pageHeight() });

  let pendingAnchor = null;
  let anchorFrame = 0;
  let lastAnchor = '';
  let lastAnchorTime = 0;
  const reportAnchor = (raw) => {
    if (!embedded || !raw) return;
    let id;
    try { id = decodeURIComponent(raw); } catch (_) { return; }
    if (!document.getElementById(id)) return;
    pendingAnchor = id;
    if (anchorFrame) return;
    anchorFrame = requestAnimationFrame(() => {
      anchorFrame = 0;
      const target = document.getElementById(pendingAnchor);
      if (!target) return;
      const now = performance.now();
      if (pendingAnchor === lastAnchor && now - lastAnchorTime < 250) return;
      lastAnchor = pendingAnchor;
      lastAnchorTime = now;
      const top = Math.round(target.getBoundingClientRect().top + window.scrollY);
      postToParent('yarmarka-scroll', { top });
      pendingAnchor = null;
    });
  };

  document.addEventListener('click', (event) => {
    if (!embedded || event.defaultPrevented || event.button !== 0
      || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href]');
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    let destination;
    try { destination = new URL(link.href, location.href); } catch (_) { return; }
    if (destination.origin !== location.origin) return;
    if (destination.pathname === location.pathname
      && destination.search === location.search
      && destination.hash) {
      reportAnchor(destination.hash.slice(1));
      return;
    }
    if (destination.pathname !== location.pathname || destination.search !== location.search) {
      postToParent('yarmarka-page-navigation', { from: location.href, to: destination.href });
    }
  });

  const syncHash = () => reportAnchor(location.hash.slice(1));
  window.addEventListener('hashchange', syncHash);
  window.addEventListener('popstate', syncHash);

  window.addEventListener('load', () => {
    reportHeight();
    postToParent('yarmarka-page-ready', { navigationType });
    if (location.hash) syncHash();
  });
  if ('ResizeObserver' in window) new ResizeObserver(reportHeight).observe(document.documentElement);
  document.fonts?.ready?.then(reportHeight).catch(() => {});
  document.addEventListener('load', (event) => {
    if (event.target instanceof HTMLImageElement) reportHeight();
  }, true);
  window.addEventListener('pageshow', reportHeight);
})();
