// Activiteit detail: kaart, grafieken, splits, zones, records, delen
import { $, $$, esc, fmtTime, fmtPace, fmtKm, fmtNum, fmtDate, fmtShortDate, toast, modal, download, slug, confirmDialog } from '../utils.js';
import { settings, saveSettings, hrZones, paceZones, ZONE_COLORS } from '../settings.js';
import { activities, saveActivity, deleteActivity, db } from '../db.js';
import { createMap, latlngs, coloredTrack, startEndMarkers, dotMarker } from '../map.js';
import { lineChart, zoneBars, barChart } from '../charts.js';
import { splits, paceSeries, zoneTimes, BEST_EFFORTS, matchedRuns, segmentEffort, finalize, interpAt } from '../stats.js';
import { toGPX, toTCX } from '../gpx.js';
import * as strava from '../strava.js';
import { correctElevation } from './record.js';
import { navigate, onLeave } from '../router.js';
import { uid } from '../utils.js';

export async function renderActivity(view, id, q) {
  const acts = await activities();
  const act = acts.find(a => a.id === id);
  if (!act) { view.innerHTML = '<p class="empty">Activiteit niet gevonden</p>'; return; }
  const s = settings();
  const st = act.stats;
  const pts = act.points || [];
  const hasGps = pts.some(p => p.lat != null);
  const hasHr = pts.some(p => p.hr > 0);
  const hasCad = pts.some(p => p.cad > 0);
  const hasEle = pts.some(p => p.ele != null);
  const sp = splits(pts);
  const ps = paceSeries(pts);
  const shoe = s.shoes.find(x => x.id === act.shoeId);

  // Records vergelijken met alle eerdere runs
  const prior = acts.filter(a => a.start < act.start);
  const effortRows = BEST_EFFORTS.filter(([d]) => act.efforts?.[d]).map(([d, label]) => {
    const t = act.efforts[d].time;
    const allBetter = acts.filter(a => a.id !== act.id && a.efforts?.[d]?.time < t).length;
    const priorBest = Math.min(...prior.map(a => a.efforts?.[d]?.time ?? Infinity));
    const rank = allBetter + 1;
    return { d, label, t, rank, prAtTime: t < priorBest };
  });

  const rel = st.load;
  const relLabel = rel < 25 ? 'Licht' : rel < 60 ? 'Gemiddeld' : rel < 120 ? 'Zwaar' : rel < 200 ? 'Heel zwaar' : 'Extreem';

  view.innerHTML = `
  <header class="top sub"><button class="icon-btn" onclick="history.back()">←</button><h1 class="ellipsis">${esc(act.name)}</h1><button class="icon-btn" id="a-menu">⋯</button></header>
  ${hasGps ? `<div class="detail-map-wrap"><div id="a-map" class="detail-map"></div>
    <div class="map-toggle seg small" id="a-color">
      <button data-c="pace" class="on">Tempo</button>${hasHr ? '<button data-c="hr">Hartslag</button>' : ''}${hasEle ? '<button data-c="ele">Hoogte</button>' : ''}
    </div></div>` : ''}
  <section class="detail-head">
    <p class="muted small">${fmtDate(act.start)}${act.source !== 'tempo' ? ` · geïmporteerd (${esc(act.source)})` : ''}${act.workout ? ` · ${esc(act.workout.name)}` : ''}</p>
    ${act.description ? `<p class="desc">${esc(act.description)}</p>` : ''}
    <div class="stat-grid big">
      <div><span>Afstand</span><b>${fmtKm(st.distance)}<small> km</small></b></div>
      <div><span>Gem. tempo</span><b>${fmtPace(st.avgPace)}<small> /km</small></b></div>
      <div><span>Bewegingstijd</span><b>${fmtTime(st.movingTime)}</b></div>
    </div>
    <div class="stat-grid">
      <div><span>Stijging</span><b>${st.elevGain} m</b></div>
      <div><span>GAP</span><b>${fmtPace(st.gap)} /km</b></div>
      <div><span>Totale tijd</span><b>${fmtTime(st.elapsedTime)}</b></div>
      ${st.avgHr ? `<div><span>Gem. hartslag</span><b>${st.avgHr} bpm</b></div><div><span>Max. hartslag</span><b>${st.maxHr} bpm</b></div>` : ''}
      ${st.avgCad ? `<div><span>Cadans</span><b>${st.avgCad} spm</b></div>` : ''}
      <div><span>Max. snelheid</span><b>${fmtPace(1000 / st.maxSpeed)} /km</b></div>
      <div><span>Calorieën</span><b>${st.calories}</b></div>
      ${act.rpe ? `<div><span>Inspanning</span><b>${act.rpe}/10</b></div>` : ''}
      ${shoe ? `<div><span>Schoenen</span><b>${esc(shoe.name)}</b></div>` : ''}
    </div>
  </section>

  <section class="card strava-card" id="a-strava"></section>

  <section class="card">
    <h3>Relatieve inspanning <span class="info" title="Trainingsbelasting op basis van hartslag (TRIMP) of tempo t.o.v. drempel">ⓘ</span></h3>
    <div class="effort"><b>${rel}</b><span>${relLabel}</span><div class="effort-bar"><i style="width:${Math.min(100, rel / 2.5)}%"></i></div></div>
    <p class="muted small" id="a-effort-cmp"></p>
  </section>

  <section class="card">
    <h3>Analyse</h3>
    <div class="chart-label">Tempo <em>${fmtPace(st.avgPace)} gem.</em></div><div id="c-pace" class="chart-box"></div>
    ${hasHr ? `<div class="chart-label">Hartslag <em>${st.avgHr} gem.</em></div><div id="c-hr" class="chart-box"></div>` : ''}
    ${hasEle ? `<div class="chart-label">Hoogte <em>↑${st.elevGain} m ↓${st.elevLoss} m${act.elevCorrected ? ' · gecorrigeerd' : ''}</em></div><div id="c-ele" class="chart-box"></div>` : ''}
    ${hasCad ? `<div class="chart-label">Cadans <em>${st.avgCad} spm</em></div><div id="c-cad" class="chart-box"></div>` : ''}
  </section>

  ${sp.length ? `<section class="card"><h3>Splits</h3>
    <div class="split-table">
      <div class="split-row head"><span>Km</span><span>Tempo</span><span></span><span>Hoogte</span>${hasHr ? '<span>HR</span>' : ''}</div>
      ${(() => {
        const full = sp.filter(x => !x.partial).map(x => x.pace);
        const fast = Math.min(...full), slow = Math.max(...sp.map(x => x.pace));
        return sp.map(x => `<div class="split-row ${x.pace === fast && full.length > 1 ? 'best' : ''}"><span>${x.partial ? fmtNum(x.dist / 1000, 2) : x.n}</span><span>${fmtPace(x.pace)}</span>
          <span class="split-bar"><i style="width:${Math.max(8, (fast / x.pace) * 100)}%"></i></span><span>${x.elev > 0 ? '+' : ''}${x.elev} m</span>${hasHr ? `<span>${x.hr || '-'}</span>` : ''}</div>`).join('');
      })()}
    </div></section>` : ''}

  ${act.laps?.length > 1 ? `<section class="card"><h3>Rondes</h3><div class="lap-table">
    <div class="lap-row head"><span>#</span><span>Afstand</span><span>Tijd</span><span>Tempo</span><span>HR</span></div>
    ${act.laps.map(l => `<div class="lap-row"><span>${l.n}</span><span>${fmtKm(l.dist)}</span><span>${fmtTime(l.time)}</span><span>${fmtPace(l.pace)}</span><span>${l.hr || '-'}</span></div>`).join('')}
  </div></section>` : ''}

  ${effortRows.length ? `<section class="card"><h3>Beste prestaties</h3>
    <div class="effort-list">${effortRows.map(e => `<div class="effort-row"><span>${e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : ''} ${e.label}</span><b>${fmtTime(e.t)}</b><em>${e.rank === 1 ? 'Persoonlijk record' : e.rank <= 3 ? `${e.rank}e snelste ooit` : ''}</em></div>`).join('')}</div>
  </section>` : ''}

  ${hasHr ? `<section class="card"><h3>Hartslagzones</h3><div id="z-hr"></div></section>` : ''}
  <section class="card"><h3>Tempozones</h3><div id="z-pace"></div></section>

  <section class="card" id="a-matched" hidden><h3>Vergelijkbare runs</h3><div id="m-chart"></div><div id="m-list"></div></section>
  <section class="card" id="a-segs" hidden><h3>Segmenten</h3><div id="seg-list"></div></section>
  `;

  // --- Kaart ---
  let map, trackGroup, marker;
  if (hasGps) {
    map = createMap($('#a-map'));
    if (map) {
      const ll = latlngs(pts);
      const drawColor = c => {
        trackGroup?.remove();
        const vals = c === 'hr' ? pts.map(p => p.hr || null) : c === 'ele' ? pts.map(p => p.ele) : ps.map(p => p.pace);
        trackGroup = coloredTrack(map, pts, vals, { invert: c === 'pace' });
      };
      drawColor('pace');
      startEndMarkers(map, pts);
      map.fitBounds(L.polyline(ll).getBounds(), { padding: [24, 24] });
      marker = dotMarker(map, 'pin-scrub');
      $$('#a-color button').forEach(b => b.onclick = () => { $$('#a-color button').forEach(x => x.classList.toggle('on', x === b)); drawColor(b.dataset.c); });
    }
  }
  // --- Grafieken met gesynchroniseerde scrub ---
  const charts = [];
  const scrub = x => {
    charts.forEach(c => c._show?.(x));
    if (!marker || !map) return;
    if (x == null) { marker.remove(); return; }
    const lat = interpAt(pts, x * 1000, 'lat'), lon = interpAt(pts, x * 1000, 'lon');
    if (lat != null && lon != null) marker.setLatLng([lat, lon]).addTo(map);
  };
  const xf = v => `${fmtNum(v, 1)} km`;
  const mk = (sel, data, o) => { const el = $(sel); if (!el) return; lineChart(el, { data, xFmt: xf, onScrub: scrub, ...o }); charts.push(el); };
  const paceVals = ps.map(p => p.pace).filter(Boolean).sort((a, b) => a - b);
  const pMax = paceVals[Math.floor(paceVals.length * 0.97)] || 600;
  mk('#c-pace', ps.map(p => ({ x: p.d / 1000, y: p.pace && p.pace <= pMax * 1.05 ? p.pace : null })), { invert: true, yFmt: fmtPace, unit: '/km', refLines: [{ y: st.avgPace, color: '#ffffff55' }] });
  mk('#c-hr', pts.map(p => ({ x: p.d / 1000, y: p.hr || null })), { color: '#ff3d5a', unit: 'bpm', refLines: hrZones().slice(1).map((z, i) => ({ y: z.min, color: ZONE_COLORS[i + 2] + '66' })) });
  mk('#c-ele', pts.map(p => ({ x: p.d / 1000, y: p.ele })), { color: '#9aa7b5', unit: 'm' });
  mk('#c-cad', pts.map(p => ({ x: p.d / 1000, y: p.cad || null })), { color: '#b93dff', unit: 'spm' });

  // --- Zones ---
  if (hasHr) zoneBars($('#z-hr'), zoneTimes(pts, 'hr'), hrZones().map(z => ({ ...z, range: `${z.min}-${z.max}` })), ZONE_COLORS, fmtTime);
  zoneBars($('#z-pace'), zoneTimes(pts, 'pace'), paceZones().map(z => ({ ...z, range: z.fast === 0 ? `< ${fmtPace(z.slow)}` : z.slow === Infinity ? `> ${fmtPace(z.fast)}` : `${fmtPace(z.fast)}-${fmtPace(z.slow)}` })), ZONE_COLORS, fmtTime);

  // Inspanning vergelijken met laatste 3 weken
  const recent = acts.filter(a => a.start < act.start && a.start > act.start - 21 * 86400000);
  if (recent.length) {
    const avg = recent.reduce((t, a) => t + a.stats.load, 0) / recent.length;
    $('#a-effort-cmp').textContent = rel > avg * 1.2 ? `Zwaarder dan je gemiddelde van de afgelopen 3 weken (${Math.round(avg)}).` : rel < avg * 0.8 ? `Lichter dan je gemiddelde van de afgelopen 3 weken (${Math.round(avg)}).` : `Rond je gemiddelde van de afgelopen 3 weken (${Math.round(avg)}).`;
  }

  // --- Vergelijkbare runs ---
  if (hasGps) {
    setTimeout(() => {
      const matches = matchedRuns(act, acts);
      if (matches.length > 1) {
        $('#a-matched').hidden = false;
        barChart($('#m-chart'), matches.slice(-10).map(a => ({ label: fmtShortDate(a.start), value: 1800 - Math.min(1800, a.stats.avgPace), color: a.id === act.id ? 'var(--accent)' : 'var(--bar)', title: fmtPace(a.stats.avgPace) })), { fmt: v => fmtPace(1800 - v), highlightLast: false });
        const best = matches.reduce((b, a) => a.stats.movingTime < b.stats.movingTime ? a : b);
        $('#m-list').innerHTML = `<p class="muted small">${matches.length} keer gelopen. Snelste: ${fmtTime(best.stats.movingTime)} op ${fmtShortDate(best.start)}${best.id === act.id ? ' (deze run!)' : ''}.</p>`;
      }
    }, 30);
  }

  // --- Segmenten ---
  const segs = await db.all('segments');
  const segRows = segs.map(sg => ({ sg, e: segmentEffort(sg, act) })).filter(x => x.e);
  if (segRows.length) {
    $('#a-segs').hidden = false;
    $('#seg-list').innerHTML = segRows.map(({ sg, e }) => {
      const all = acts.map(a => segmentEffort(sg, a)).filter(Boolean).sort((a, b) => a.time - b.time);
      const rank = all.findIndex(x => x.actId === act.id) + 1;
      return `<div class="effort-row"><span>${rank === 1 ? '👑' : ''} ${esc(sg.name)}</span><b>${fmtTime(e.time)}</b><em>${rank}/${all.length}</em></div>`;
    }).join('');
  }

  // --- Strava ---
  const renderStrava = () => {
    const el = $('#a-strava');
    if (act.stravaId) {
      el.innerHTML = `<div class="row between"><div><b>Op Strava</b><p class="muted small">Gedeeld met je volgers</p></div><a class="btn strava-btn" href="${strava.activityUrl(act.stravaId)}" target="_blank" rel="noopener">Bekijk op Strava ↗</a></div>`;
    } else if (strava.isConnected()) {
      el.innerHTML = `<div class="row between"><div><b>Delen met vrienden</b><p class="muted small" id="sv-status">Upload naar je Strava account</p></div><button class="btn strava-btn" id="sv-up">Upload naar Strava</button></div>`;
      $('#sv-up').onclick = doUpload;
    } else {
      el.innerHTML = `<div><b>Delen op Strava</b><p class="muted small">Koppel Strava in je profiel voor uploaden met één tik, of exporteer een bestand en upload het handmatig.</p>
        <div class="row gap wrap"><a class="btn ghost" href="#/profiel">Strava koppelen</a><button class="btn ghost" id="sv-man">Bestand + handmatig uploaden</button></div></div>`;
      $('#sv-man').onclick = () => { download(`${slug(act.name)}.tcx`, toTCX(act), 'application/xml'); setTimeout(() => window.open(strava.manualUploadUrl, '_blank'), 400); };
    }
  };
  const doUpload = async () => {
    const btn = $('#sv-up'); const status = $('#sv-status');
    if (btn) btn.disabled = true;
    try {
      const sid = await strava.upload(act, msg => { if (status) status.textContent = msg; });
      act.stravaId = sid;
      act.stravaUploadedAt = Date.now();
      await saveActivity(act);
      toast('Gedeeld op Strava! 🚀');
      renderStrava();
    } catch (e) {
      toast(e.message, 5000);
      if (status) status.textContent = e.message;
      if (btn) btn.disabled = false;
    }
  };
  renderStrava();
  if (q.get('strava') === '1' && !act.stravaId && strava.isConnected()) { history.replaceState(null, '', `#/activiteit/${act.id}`); doUpload(); }

  // --- Menu ---
  $('#a-menu').onclick = () => {
    const close = modal(`<div class="menu">
      <button data-a="edit">✏️ Bewerken</button>
      <button data-a="share">📸 Deelafbeelding maken</button>
      <button data-a="gpx">⬇ Exporteer GPX</button>
      <button data-a="tcx">⬇ Exporteer TCX (met hartslag/cadans)</button>
      ${hasGps && navigator.onLine ? '<button data-a="elev">⛰ Hoogte corrigeren</button>' : ''}
      ${hasGps ? '<button data-a="segment">📍 Segment maken van deel van deze run</button>' : ''}
      ${hasGps ? '<button data-a="route">🗺 Opslaan als route</button>' : ''}
      ${act.stravaId ? '<button data-a="unlink">Strava koppeling loshalen</button>' : ''}
      <button data-a="delete" class="danger">🗑 Verwijderen</button>
      <button data-close>Annuleren</button></div>`, {
      onMount: (m) => $$('[data-a]', m).forEach(b => b.onclick = async () => {
        close();
        const a = b.dataset.a;
        if (a === 'gpx') download(`${slug(act.name)}.gpx`, toGPX(act), 'application/gpx+xml');
        if (a === 'tcx') download(`${slug(act.name)}.tcx`, toTCX(act), 'application/xml');
        if (a === 'edit') editDialog(act);
        if (a === 'share') shareImage(act);
        if (a === 'segment') segmentDialog(act);
        if (a === 'route') { const { saveRoute } = await import('./io.js'); await saveRoute(act.name, pts.filter(p => p.lat != null).filter((_, i) => i % 3 === 0).map(({ lat, lon, ele }) => ({ lat, lon, ele }))); toast('Route opgeslagen'); }
        if (a === 'elev') { toast('Hoogte ophalen...'); try { await correctElevation(act); finalize(act); await saveActivity(act); toast('Hoogte gecorrigeerd'); renderActivity(view, id, q); } catch (e) { toast(e.message); } }
        if (a === 'unlink') { act.stravaId = null; await saveActivity(act); renderStrava(); }
        if (a === 'delete' && await confirmDialog('Deze activiteit definitief verwijderen?', 'Verwijderen', true)) { await deleteActivity(act.id); toast('Verwijderd'); navigate('#/'); }
      }),
    });
  };
  onLeave(() => map?.remove());
}

function editDialog(act) {
  const s = settings();
  modal(`<h2>Bewerken</h2>
    <label class="field"><span>Titel</span><input id="e-name" value="${esc(act.name)}"></label>
    <label class="field"><span>Beschrijving</span><textarea id="e-desc" rows="4">${esc(act.description || '')}</textarea></label>
    <label class="field"><span>Inspanning (1-10)</span><input id="e-rpe" type="number" min="1" max="10" value="${act.rpe || ''}"></label>
    ${s.shoes.length ? `<label class="field"><span>Schoenen</span><select id="e-shoe"><option value="">Geen</option>${s.shoes.map(x => `<option value="${x.id}" ${x.id === act.shoeId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : ''}
    <div class="row gap end"><button class="btn ghost" data-close>Annuleren</button><button class="btn primary" id="e-save">Opslaan</button></div>`, {
    onMount: (m, close) => {
      $('#e-save', m).onclick = async () => {
        act.name = $('#e-name', m).value.trim() || act.name;
        act.description = $('#e-desc', m).value.trim();
        act.rpe = +$('#e-rpe', m).value || null;
        if ($('#e-shoe', m)) act.shoeId = $('#e-shoe', m).value || null;
        await saveActivity(act);
        close();
        location.reload();
      };
    },
  });
}

function segmentDialog(act) {
  const total = act.stats.distance / 1000;
  modal(`<h2>Segment maken</h2>
    <p class="muted small">Een segment is een stuk route waarop je je tijden over alle runs vergelijkt (persoonlijk klassement).</p>
    <label class="field"><span>Naam</span><input id="sg-name" placeholder="bijv. Brug sprint"></label>
    <div class="row gap"><label class="field grow"><span>Van km</span><input id="sg-from" type="number" step="0.1" min="0" max="${total}" value="0"></label>
    <label class="field grow"><span>Tot km</span><input id="sg-to" type="number" step="0.1" min="0" max="${total}" value="${Math.min(1, total).toFixed(1)}"></label></div>
    <div class="row gap end"><button class="btn ghost" data-close>Annuleren</button><button class="btn primary" id="sg-save">Maken</button></div>`, {
    onMount: (m, close) => {
      $('#sg-save', m).onclick = async () => {
        const from = +$('#sg-from', m).value * 1000, to = +$('#sg-to', m).value * 1000;
        if (to - from < 100) return toast('Segment moet minstens 100 m zijn');
        const pts = act.points;
        const at = d => ({ lat: interpAt(pts, d, 'lat'), lon: interpAt(pts, d, 'lon') });
        const path = pts.filter(p => p.d >= from && p.d <= to && p.lat != null).map(({ lat, lon }) => ({ lat, lon }));
        await db.put('segments', { id: uid(), name: $('#sg-name', m).value.trim() || 'Segment', start: at(from), end: at(to), distance: to - from, path, created: Date.now() });
        close();
        toast('Segment gemaakt');
        location.reload();
      };
    },
  });
}

// Deelafbeelding (1080x1350) met route en stats
async function shareImage(act) {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#11151c'); grad.addColorStop(1, '#05070a');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  const pts = act.points.filter(p => p.lat != null);
  if (pts.length > 1) {
    const lats = pts.map(p => p.lat), lons = pts.map(p => p.lon);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const k = Math.cos((minLat + maxLat) / 2 * Math.PI / 180);
    const box = { x: 90, y: 160, w: W - 180, h: 720 };
    const spanX = (maxLon - minLon) * k || 1e-5, spanY = maxLat - minLat || 1e-5;
    const sc = Math.min(box.w / spanX, box.h / spanY);
    const ox = box.x + (box.w - spanX * sc) / 2, oy = box.y + (box.h - spanY * sc) / 2;
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.shadowColor = '#c6ff3d'; g.shadowBlur = 30;
    g.strokeStyle = '#c6ff3d'; g.lineWidth = 12;
    g.beginPath();
    pts.forEach((p, i) => { const x = ox + (p.lon - minLon) * k * sc, y = oy + (maxLat - p.lat) * sc; i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
    g.shadowBlur = 0;
  }
  g.fillStyle = '#fff';
  g.font = '700 54px system-ui, sans-serif';
  g.fillText(act.name, 90, 110);
  g.fillStyle = '#8a96a6';
  g.font = '400 32px system-ui, sans-serif';
  g.fillText(fmtDate(act.start), 90, 960);
  const st = act.stats;
  const items = [['Afstand', `${fmtKm(st.distance)} km`], ['Tempo', `${fmtPace(st.avgPace)} /km`], ['Tijd', fmtTime(st.movingTime)]];
  if (st.elevGain) items.push(['Stijging', `${st.elevGain} m`]);
  if (st.avgHr) items.push(['Hartslag', `${st.avgHr} bpm`]);
  items.slice(0, 3).forEach(([k2, v], i) => {
    const x = 90 + i * 320;
    g.fillStyle = '#8a96a6'; g.font = '400 30px system-ui, sans-serif'; g.fillText(k2.toUpperCase(), x, 1060);
    g.fillStyle = '#fff'; g.font = '800 64px system-ui, sans-serif'; g.fillText(v, x, 1140);
  });
  items.slice(3).forEach(([k2, v], i) => {
    const x = 90 + i * 320;
    g.fillStyle = '#8a96a6'; g.font = '400 30px system-ui, sans-serif'; g.fillText(k2.toUpperCase(), x, 1210);
    g.fillStyle = '#fff'; g.font = '700 48px system-ui, sans-serif'; g.fillText(v, x, 1268);
  });
  g.fillStyle = '#c6ff3d'; g.font = '800 34px system-ui, sans-serif';
  g.textAlign = 'right'; g.fillText('TEMPO', W - 90, 110);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], `${slug(act.name)}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: act.name, text: `${fmtKm(st.distance)} km in ${fmtTime(st.movingTime)} 🏃` }); return; } catch { /* geannuleerd */ }
  }
  download(file.name, blob);
}

export { saveSettings };
