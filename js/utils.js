// Algemene helpers: formatteren, geo-berekeningen, DOM
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const R = 6371008.8;
const rad = d => d * Math.PI / 180;
export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Tijd in seconden -> h:mm:ss of m:ss
export function fmtTime(sec, alwaysHours = false) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 || alwaysHours ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Tempo in sec/km -> m:ss
export function fmtPace(secPerKm) {
  if (!isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 1800) return '--:--';
  const m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtKm(m, dec = 2) {
  return (m / 1000).toFixed(dec).replace('.', ',');
}

export function fmtNum(n, dec = 0) {
  return Number(n || 0).toFixed(dec).replace('.', ',');
}

export function parsePace(str) {
  const m = String(str).trim().match(/^(\d{1,2})[:.,](\d{1,2})$/);
  if (!m) return null;
  return +m[1] * 60 + +m[2];
}

export function parseTime(str) {
  const parts = String(str).trim().split(':').map(Number);
  if (parts.some(isNaN)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

const DAYS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
export const MONTHS_LONG = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

export function fmtDate(ts, withTime = true) {
  const d = new Date(ts);
  const base = `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return withTime ? `${base} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : base;
}
export function fmtShortDate(ts) {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function runTitle(ts) {
  const h = new Date(ts).getHours();
  if (h < 6) return 'Nachtrun';
  if (h < 12) return 'Ochtendrun';
  if (h < 14) return 'Lunchrun';
  if (h < 18) return 'Middagrun';
  if (h < 22) return 'Avondrun';
  return 'Nachtrun';
}

export function startOfWeek(ts) {
  const d = new Date(ts);
  const day = (d.getDay() + 6) % 7; // maandag = 0
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.getTime();
}

export function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function toast(msg, ms = 2600) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms);
}

export function download(filename, content, mime = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept, multiple = false) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve([...input.files]);
    input.click();
  });
}

export function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* niet ondersteund */ }
}

export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'run';
}

// Eenvoudige modal
export function modal(html, { onMount, wide = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}">${html}</div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  onMount?.(wrap.firstElementChild, close);
  return close;
}

export function confirmDialog(text, okLabel = 'OK', danger = false) {
  return new Promise(resolve => {
    modal(`<p class="modal-text">${esc(text)}</p>
      <div class="row gap end"><button class="btn ghost" data-close>Annuleren</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" id="cfm-ok">${esc(okLabel)}</button></div>`, {
      onMount: (m, close) => {
        m.parentElement.addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === m.parentElement) resolve(false); });
        $('#cfm-ok', m).onclick = () => { close(); resolve(true); };
      }
    });
  });
}
