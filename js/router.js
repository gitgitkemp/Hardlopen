// Hash router
const routes = [];
let cleanup = null;

export function route(pattern, handler) {
  routes.push({ re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/?]+)') + '(?:\\?(?<query>.*))?$'), handler });
}

export function onLeave(fn) { cleanup = fn; }

export function navigate(hash) {
  if (location.hash === hash) render(); else location.hash = hash;
}

export async function render() {
  const hash = location.hash.slice(1) || '/';
  if (cleanup) { try { cleanup(); } catch { /* */ } cleanup = null; }
  for (const r of routes) {
    const m = hash.match(r.re);
    if (m) {
      const params = { ...(m.groups || {}) };
      params.q = new URLSearchParams(params.query || '');
      await r.handler(params);
      return;
    }
  }
  location.hash = '#/';
}

window.addEventListener('hashchange', render);
