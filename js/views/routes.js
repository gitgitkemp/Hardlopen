// Routes: planner, opgeslagen routes, heatmap, segmenten
import { $, $$, esc, fmtKm, fmtTime, fmtShortDate, toast, download, slug, confirmDialog, haversine } from '../utils.js';
import { db, activities } from '../db.js';
import { createMap, latlngs, routeBetween, fetchElevations, startEndMarkers } from '../map.js';
import { lineChart, routeSvg } from '../charts.js';
import { routeToGPX } from '../gpx.js';
import { saveRoute, importFiles } from './io.js';
import { segmentEffort, elevationGain, predictTime, currentVdot } from '../stats.js';
import { onLeave } from '../router.js';
import { presetRoute } from './record.js';

const TABS = [['lijst', 'Mijn routes'], ['planner', 'Planner'], ['heatmap', 'Heatmap'], ['segmenten', 'Segmenten']];

export async function renderRoutes(view, tab = 'lijst', q) {
  view.innerHTML = `<header class="top"><h1>Routes</h1><button class="icon-btn" id="r-imp" title="GPX importeren">Import</button></header>
    <nav class="tabs">${TABS.map(([k, l]) => `<a href="#/routes/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</nav>
    <div id="r-body"></div>`;
  $('#r-imp').onclick = () => importFiles();
  const body = $('#r-body');
  ({ lijst, planner, heatmap, segmenten })[tab]?.(body, q);
}

async function lijst(el, q) {
  const routes = (await db.all('routes')).sort((a, b) => b.created - a.created);
  const acts = await activities();
  const vd = currentVdot(acts).vdot;
  const openId = q?.get('id');
  el.innerHTML = routes.length ? routes.map(r => `<div class="card route-card ${r.id === openId ? 'open' : ''}" data-id="${r.id}">
      <div class="row between"><div><b>${esc(r.name)}</b><p class="muted small">${fmtKm(r.distance)} km${r.elevGain ? ` · ↑${r.elevGain} m` : ''}${vd ? ` · ~${fmtTime(predictTime(vd, r.distance) * 1.15)} rustig` : ''}</p></div>${routeSvg(r.path, 90, 60, '#7d9fbd')}</div>
      <div class="route-detail" ${r.id === openId ? '' : 'hidden'}><div class="route-map" id="rm-${r.id}"></div><div class="chart-box" id="re-${r.id}"></div>
      <div class="row gap wrap"><a class="btn primary" href="#/rennen" data-run="${r.id}">Lopen</a><button class="btn ghost" data-gpx="${r.id}">GPX</button><button class="btn ghost danger" data-del="${r.id}">Verwijderen</button></div></div>
    </div>`).join('') : `<div class="empty"><p>Nog geen routes. Plan er een in de planner, importeer een GPX of sla een run op als route.</p><a class="btn primary" href="#/routes/planner">Route plannen</a></div>`;
  const maps = [];
  $$('.route-card').forEach(c => c.addEventListener('click', e => {
    if (e.target.closest('button,a')) return;
    const det = $('.route-detail', c);
    det.hidden = !det.hidden;
    if (!det.hidden && !c._map) {
      const r = routes.find(x => x.id === c.dataset.id);
      c._map = createMap($(`#rm-${r.id}`, c));
      if (c._map) {
        const pl = L.polyline(latlngs(r.path), { color: '#7d9fbd', weight: 5 }).addTo(c._map);
        startEndMarkers(c._map, r.path);
        c._map.fitBounds(pl.getBounds(), { padding: [20, 20] });
        maps.push(c._map);
      }
      if (r.path.some(p => p.ele != null)) {
        let d = 0;
        lineChart($(`#re-${r.id}`, c), { data: r.path.map((p, i) => { if (i) d += haversine(r.path[i - 1], p); return { x: d / 1000, y: p.ele }; }), color: '#8d8a82', unit: 'm', xFmt: v => `${v.toFixed(1)} km`, height: 90 });
      }
    }
  }));
  if (openId) $(`.route-card[data-id="${openId}"]`)?.dispatchEvent(new Event('click'));
  $$('[data-gpx]').forEach(b => b.onclick = () => { const r = routes.find(x => x.id === b.dataset.gpx); download(`${slug(r.name)}.gpx`, routeToGPX(r), 'application/gpx+xml'); });
  $$('[data-del]').forEach(b => b.onclick = async () => { if (await confirmDialog('Route verwijderen?', 'Verwijderen', true)) { await db.del('routes', b.dataset.del); lijst(el); } });
  $$('[data-run]').forEach(b => b.onclick = () => presetRoute(routes.find(x => x.id === b.dataset.run)));
  onLeave(() => maps.forEach(m => m.remove()));
}

async function planner(el) {
  el.innerHTML = `<div class="planner">
    <div id="pl-map" class="planner-map"></div>
    <div class="planner-bar">
      <div class="pl-stats"><b id="pl-dist">0,00 km</b><span class="muted small" id="pl-hint">Tik op de kaart om punten toe te voegen</span></div>
      <div class="row gap wrap">
        <label class="check small"><input type="checkbox" id="pl-snap" checked> Volg paden</label>
        <button class="btn ghost small" id="pl-undo">Ongedaan</button>
        <button class="btn ghost small" id="pl-loop">Terug naar start</button>
        <button class="btn ghost small" id="pl-rev">Omdraaien</button>
        <button class="btn ghost small" id="pl-clear">Wissen</button>
      </div>
      <div class="row gap"><input id="pl-name" placeholder="Naam van de route" class="grow"><button class="btn primary" id="pl-save">Opslaan</button></div>
    </div></div>`;
  const map = createMap($('#pl-map'));
  if (!map) return;
  navigator.geolocation?.getCurrentPosition(p => map.setView([p.coords.latitude, p.coords.longitude], 15), () => {}, { timeout: 8000 });
  const waypoints = []; // {lat, lon}
  const legs = []; // array van paden tussen waypoints
  const line = L.polyline([], { color: '#7d9fbd', weight: 5 }).addTo(map);
  const markers = L.layerGroup().addTo(map);
  const path = () => {
    const out = [];
    legs.forEach((leg, i) => out.push(...(i ? leg.slice(1) : leg)));
    if (!legs.length && waypoints.length) out.push(waypoints[0]);
    return out;
  };
  const dist = p => p.reduce((t, x, i) => (i ? t + haversine(p[i - 1], x) : 0), 0);
  const redraw = () => {
    const p = path();
    line.setLatLngs(latlngs(p));
    markers.clearLayers();
    waypoints.forEach((w, i) => L.marker([w.lat, w.lon], { icon: L.divIcon({ className: `pin ${i === 0 ? 'pin-start' : 'pin-way'}`, iconSize: [14, 14] }) }).addTo(markers));
    $('#pl-dist').textContent = `${fmtKm(dist(p))} km`;
    $('#pl-hint').textContent = waypoints.length ? `${waypoints.length} punten` : 'Tik op de kaart om punten toe te voegen';
  };
  let busy = false;
  const add = async (pt) => {
    if (busy) return;
    busy = true;
    const prev = waypoints[waypoints.length - 1];
    waypoints.push(pt);
    if (prev) legs.push($('#pl-snap').checked ? await routeBetween(prev, pt) : [prev, pt]);
    busy = false;
    redraw();
  };
  map.on('click', e => add({ lat: e.latlng.lat, lon: e.latlng.lng }));
  $('#pl-undo').onclick = () => { waypoints.pop(); legs.pop(); redraw(); };
  $('#pl-clear').onclick = () => { waypoints.length = 0; legs.length = 0; redraw(); };
  $('#pl-loop').onclick = () => { if (waypoints.length > 1) add({ ...waypoints[0] }); };
  $('#pl-rev').onclick = () => { waypoints.reverse(); legs.reverse(); legs.forEach(l => l.reverse()); redraw(); };
  $('#pl-save').onclick = async () => {
    const p = path();
    if (p.length < 2) return toast('Voeg minstens 2 punten toe');
    const btn = $('#pl-save'); btn.disabled = true; btn.textContent = 'Hoogte ophalen...';
    // Verdunnen + hoogte
    const thin = p.filter((x, i) => i === 0 || i === p.length - 1 || haversine(p[Math.max(0, i - 1)], x) > 5);
    try {
      const sample = thin.length > 300 ? thin.filter((_, i) => i % Math.ceil(thin.length / 300) === 0) : thin;
      const ele = await fetchElevations(sample);
      sample.forEach((x, i) => { x.ele = ele[i]; });
    } catch { /* zonder hoogte */ }
    const r = await saveRoute($('#pl-name').value.trim() || `Route ${fmtKm(dist(p), 1)} km`, thin.map(({ lat, lon, ele }) => ({ lat, lon, ele: ele ?? null })));
    r.elevGain = Math.round(elevationGain(r.path.filter(x => x.ele != null), 2).gain);
    await db.put('routes', r);
    toast('Route opgeslagen');
    location.hash = `#/routes/lijst?id=${r.id}`;
  };
  onLeave(() => map.remove());
}

async function heatmap(el) {
  const acts = (await activities()).filter(a => a.points?.some(p => p.lat != null));
  el.innerHTML = `<div class="heat-wrap"><div id="hm-map" class="heat-map"></div>
    <div class="seg small heat-seg" id="hm-range">${[['all', 'Alles'], ['365', 'Jaar'], ['90', '90 d'], ['30', '30 d']].map(([k, l], i) => `<button data-r="${k}" class="${i ? '' : 'on'}">${l}</button>`).join('')}</div></div>
    <p class="muted small center">${acts.length} runs met GPS. Hoe feller de lijn, hoe vaker je daar loopt.</p>`;
  const map = createMap($('#hm-map'), { style: 'dark' });
  if (!map) return;
  let layer;
  const draw = range => {
    layer?.remove();
    layer = L.layerGroup().addTo(map);
    const since = range === 'all' ? 0 : Date.now() - +range * 86400000;
    const list = acts.filter(a => a.start >= since);
    const bounds = [];
    list.forEach(a => {
      const ll = latlngs(a.points.filter((_, i) => i % 3 === 0));
      bounds.push(...ll);
      L.polyline(ll, { color: '#e8a33a', weight: 3, opacity: Math.max(0.12, Math.min(0.6, 4 / list.length)) }).addTo(layer);
      L.polyline(ll, { color: '#d9b44a', weight: 1, opacity: Math.max(0.08, Math.min(0.4, 2 / list.length)) }).addTo(layer);
    });
    if (bounds.length) map.fitBounds(bounds, { padding: [20, 20] });
  };
  draw('all');
  $$('#hm-range button').forEach(b => b.onclick = () => { $$('#hm-range button').forEach(x => x.classList.toggle('on', x === b)); draw(b.dataset.r); });
  onLeave(() => map.remove());
}

async function segmenten(el) {
  const segs = await db.all('segments');
  const acts = await activities();
  el.innerHTML = segs.length ? segs.map(sg => {
    const efforts = acts.map(a => segmentEffort(sg, a)).filter(Boolean).sort((a, b) => a.time - b.time);
    return `<section class="card"><div class="row between"><div><b>${esc(sg.name)}</b><p class="muted small">${fmtKm(sg.distance)} km · ${efforts.length} pogingen</p></div>${routeSvg(sg.path, 80, 50, '#d0804a')}</div>
      <div class="effort-list">${efforts.slice(0, 10).map((e, i) => `<a class="effort-row" href="#/activiteit/${e.actId}"><span><i class="rank">${i + 1}</i>${fmtShortDate(e.start)} ${new Date(e.start).getFullYear()}</span><b>${fmtTime(e.time)}</b><em>${fmtTime(e.time / (sg.distance / 1000))} /km</em></a>`).join('') || '<p class="muted small">Nog geen pogingen</p>'}</div>
      <button class="btn ghost small danger" data-del="${sg.id}">Verwijderen</button></section>`;
  }).join('') : `<div class="empty"><p>Nog geen segmenten. Open een run, tik op ⋯ en kies "Segment maken". Daarna zie je bij elke run op dat stuk je tijd en ranking.</p></div>`;
  $$('[data-del]').forEach(b => b.onclick = async () => { if (await confirmDialog('Segment verwijderen?', 'Verwijderen', true)) { await db.del('segments', b.dataset.del); segmenten(el); } });
}
