// Lichte SVG grafieken met touch-scrubbing
import { esc } from './utils.js';

const NS = 'http://www.w3.org/2000/svg';

function niceTicks(min, max, n = 4) {
  const span = max - min || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= step0) || step0;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

/**
 * opts: { data: [{x, y}], color, fill, height, invert, yFmt, xFmt, label, unit, onScrub(i|null), minY, maxY, refLines:[{y,label,color}] }
 */
export function lineChart(el, opts) {
  const data = opts.data.filter(d => d.y != null && isFinite(d.y));
  el.innerHTML = '';
  if (data.length < 2) { el.innerHTML = '<div class="chart-empty">Geen data</div>'; return; }
  const W = el.clientWidth || 340, H = opts.height || 140;
  const pad = { l: 42, r: 8, t: 10, b: 20 };
  const xs = data.map(d => d.x), ys = data.map(d => d.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = opts.minY ?? Math.min(...ys), y1 = opts.maxY ?? Math.max(...ys);
  if (y1 - y0 < 1e-6) { y0 -= 1; y1 += 1; }
  const yPad = (y1 - y0) * 0.08; y0 -= yPad; y1 += yPad;
  const sx = x => pad.l + (x - x0) / (x1 - x0 || 1) * (W - pad.l - pad.r);
  const sy = y => {
    const f = (y - y0) / (y1 - y0);
    return opts.invert ? pad.t + f * (H - pad.t - pad.b) : H - pad.b - f * (H - pad.t - pad.b);
  };
  // Downsample voor performance
  const step = Math.max(1, Math.floor(data.length / (W * 1.5)));
  const pts = data.filter((_, i) => i % step === 0);
  const path = pts.map((d, i) => `${i ? 'L' : 'M'}${sx(d.x).toFixed(1)},${sy(d.y).toFixed(1)}`).join('');
  const base = opts.invert ? pad.t + (H - pad.t - pad.b) : H - pad.b;
  const area = `${path}L${sx(pts[pts.length - 1].x).toFixed(1)},${base}L${sx(pts[0].x).toFixed(1)},${base}Z`;
  const ticks = niceTicks(y0, y1, 3);
  const xt = niceTicks(x0, x1, 4);
  const gid = 'g' + Math.random().toString(36).slice(2, 7);
  const color = opts.color || 'var(--accent)';
  el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none">
    <defs><linearGradient id="${gid}" x1="0" x2="0" y1="${opts.invert ? 1 : 0}" y2="${opts.invert ? 0 : 1}">
      <stop offset="0" stop-color="${color}" stop-opacity=".45"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    ${ticks.map(t => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${sy(t)}" y2="${sy(t)}" class="grid"/><text x="${pad.l - 6}" y="${sy(t) + 4}" class="axis" text-anchor="end">${esc(opts.yFmt ? opts.yFmt(t) : (y1 - y0 < 10 ? t.toFixed(1) : Math.round(t)))}</text>`).join('')}
    ${xt.map(t => `<text x="${sx(t)}" y="${H - 4}" class="axis" text-anchor="middle">${esc(opts.xFmt ? opts.xFmt(t) : t)}</text>`).join('')}
    ${(opts.refLines || []).map(r => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${sy(r.y)}" y2="${sy(r.y)}" stroke="${r.color || '#fff'}" stroke-dasharray="4 4" stroke-width="1"/>`).join('')}
    ${opts.fill === false ? '' : `<path d="${area}" fill="url(#${gid})"/>`}
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    <line class="scrub" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" visibility="hidden"/>
    <circle class="scrub-dot" r="4" fill="${color}" visibility="hidden"/>
  </svg><div class="chart-tip" hidden></div>`;
  const svg = el.querySelector('svg');
  const line = svg.querySelector('.scrub'), dot = svg.querySelector('.scrub-dot'), tip = el.querySelector('.chart-tip');
  const show = (i) => {
    if (i == null) { line.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.hidden = true; return; }
    const d = data[i];
    const x = sx(d.x), y = sy(d.y);
    line.setAttribute('x1', x); line.setAttribute('x2', x); line.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.innerHTML = `<b>${esc(opts.yFmt ? opts.yFmt(d.y) : Math.round(d.y))}</b> ${esc(opts.unit || '')}<span>${esc(opts.xFmt ? opts.xFmt(d.x) : d.x)}</span>`;
    const px = x / W * el.clientWidth;
    tip.style.left = Math.min(Math.max(px - 40, 0), el.clientWidth - 90) + 'px';
  };
  el._show = (xVal) => {
    if (xVal == null) return show(null);
    let lo = 0, hi = data.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (data[m].x < xVal) lo = m; else hi = m; }
    show(Math.abs(data[lo].x - xVal) < Math.abs(data[hi].x - xVal) ? lo : hi);
  };
  const handle = e => {
    const r = svg.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const xv = x0 + ((cx / r.width * W) - pad.l) / (W - pad.l - pad.r) * (x1 - x0);
    el._show(xv);
    opts.onScrub?.(Math.max(x0, Math.min(x1, xv)));
  };
  const end = () => { show(null); opts.onScrub?.(null); };
  svg.addEventListener('pointermove', handle);
  svg.addEventListener('pointerdown', handle);
  svg.addEventListener('pointerleave', end);
  svg.addEventListener('touchmove', handle, { passive: true });
  svg.addEventListener('touchend', end);
}

/** items: [{label, value, color, title}] */
export function barChart(el, items, { height = 120, fmt = v => Math.round(v), highlightLast = true } = {}) {
  const max = Math.max(...items.map(i => i.value), 1);
  el.innerHTML = `<div class="bars" style="height:${height}px">${items.map((it, i) => `
    <div class="bar-col" title="${esc(it.title || '')}">
      <div class="bar-val">${it.value ? esc(fmt(it.value)) : ''}</div>
      <div class="bar" style="height:${Math.max(2, it.value / max * (height - 34))}px;background:${it.color || (highlightLast && i === items.length - 1 ? 'var(--accent)' : 'var(--bar)')}"></div>
      <div class="bar-label">${esc(it.label)}</div>
    </div>`).join('')}</div>`;
}

/** Horizontale zone-verdeling */
export function zoneBars(el, values, zones, colors, fmt) {
  const total = values.reduce((a, b) => a + b, 0) || 1;
  el.innerHTML = zones.map((z, i) => `
    <div class="zone-row">
      <span class="zone-name"><i style="background:${colors[i + 1]}"></i>Z${i + 1} ${esc(z.name)}</span>
      <span class="zone-range">${esc(z.range || '')}</span>
      <div class="zone-track"><div style="width:${values[i] / total * 100}%;background:${colors[i + 1]}"></div></div>
      <span class="zone-pct">${Math.round(values[i] / total * 100)}%</span>
      <span class="zone-time">${esc(fmt(values[i]))}</span>
    </div>`).join('');
}

/** Mini routekaart als SVG (zonder tegels) */
export function routeSvg(points, w = 120, h = 80, stroke = 'var(--accent)') {
  const pts = points.filter(p => p.lat != null);
  if (pts.length < 2) return `<svg viewBox="0 0 ${w} ${h}" class="mini-route"></svg>`;
  const lats = pts.map(p => p.lat), lons = pts.map(p => p.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const k = Math.cos((minLat + maxLat) / 2 * Math.PI / 180);
  const spanX = (maxLon - minLon) * k || 1e-5, spanY = maxLat - minLat || 1e-5;
  const scale = Math.min((w - 10) / spanX, (h - 10) / spanY);
  const ox = (w - spanX * scale) / 2, oy = (h - spanY * scale) / 2;
  const step = Math.max(1, Math.floor(pts.length / 150));
  const d = pts.filter((_, i) => i % step === 0 || i === pts.length - 1)
    .map((p, i) => `${i ? 'L' : 'M'}${(ox + (p.lon - minLon) * k * scale).toFixed(1)},${(h - oy - (p.lat - minLat) * scale).toFixed(1)}`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" class="mini-route"><path d="${d}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
