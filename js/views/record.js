// Rennen: voorbereiding, live scherm, opslaan
import { $, $$, esc, fmtTime, fmtPace, fmtKm, fmtNum, toast, modal, vibrate, confirmDialog } from '../utils.js';
import { settings, saveSettings, hrZoneOf, hrZones, ZONE_COLORS } from '../settings.js';
import { Recorder } from '../recorder.js';
import { heartRate, cadence, keepAwake, primeSpeech, speak, beep } from '../sensors.js';
import { createMap, latlngs, dotMarker, coloredTrack, startEndMarkers, fetchElevations } from '../map.js';
import { activities, db, saveActivity, clearLive, loadLive } from '../db.js';
import { presets, KIND_LABEL, workoutSummary, sessionToWorkout } from '../workouts.js';
import { finalize, paceSeries, zoneTimes } from '../stats.js';
import { lineChart } from '../charts.js';
import * as strava from '../strava.js';
import { navigate } from '../router.js';

let rec = null;
let setup = { mode: 'free', workout: null, ghost: null, route: null };

export function isRecording() { return rec && rec.state !== 'ready' && rec.state !== 'done'; }

// ---------- Voorbereiding ----------
export async function renderPrepare(view) {
  const s = settings();
  const acts = await activities();
  const today = s.plan?.sessions.find(x => new Date(x.date).toDateString() === new Date().toDateString() && x.type !== 'race');
  view.innerHTML = `
  <div class="prep">
    <div class="prep-map" id="prep-map"></div>
    <a class="icon-btn prep-close" href="#/" title="Sluiten">✕</a>
    <div class="gps-pill" id="gps-pill"><span class="sig"><i></i><i></i><i></i><i></i></span><span id="gps-txt">GPS zoeken...</span></div>
    <div class="prep-sheet">
      <div class="seg" id="mode-seg">
        ${[['free', 'Vrij'], ['workout', 'Workout'], ['plan', 'Schema'], ['ghost', 'Ghost'], ['route', 'Route']].map(([k, l]) => `<button data-mode="${k}" class="${setup.mode === k ? 'on' : ''}">${l}</button>`).join('')}
      </div>
      <div id="mode-detail" class="mode-detail"></div>
      <div class="sensor-row">
        <button class="chip ${heartRate.connected ? 'on' : ''}" id="hr-btn">❤ ${heartRate.connected ? `${esc(heartRate.device.name || 'HR')}` : 'Hartslagband'}</button>
        <button class="chip ${s._cad ? 'on' : ''}" id="cad-btn">👟 Cadans</button>
        <button class="chip ${s.voice ? 'on' : ''}" id="voice-btn">🔊 Stemcoach</button>
        <button class="chip ${s.autoPause ? 'on' : ''}" id="ap-btn">⏸ Auto-pauze</button>
      </div>
      <button class="start-btn" id="start-btn"><span>START</span></button>
    </div>
  </div>`;

  // Kaart met huidige locatie
  const map = createMap($('#prep-map'), { interactive: true });
  let me = null, first = true, routeLayer = null;
  const drawRoute = () => {
    if (!map) return;
    routeLayer?.remove();
    const pts = setup.route?.path || setup.ghost?.points;
    if (pts?.length) {
      routeLayer = L.polyline(latlngs(pts), { color: setup.route ? '#3fa7ff' : '#b93dff', weight: 4, opacity: 0.8, dashArray: setup.ghost ? '6 6' : null }).addTo(map);
      map.fitBounds(routeLayer.getBounds(), { padding: [30, 30] });
      first = false;
    }
  };
  // Opnemer alvast starten voor GPS lock
  rec?.destroy();
  rec = new Recorder({ settings: s });
  rec.on((type, data) => {
    if (type === 'fix') {
      const acc = Math.round(data.accuracy);
      const lvl = acc <= 8 ? 4 : acc <= 15 ? 3 : acc <= 30 ? 2 : 1;
      const pill = $('#gps-pill');
      if (!pill) return;
      pill.dataset.lvl = lvl;
      $('#gps-txt').textContent = lvl >= 3 ? `GPS sterk · ±${acc} m` : lvl === 2 ? `GPS matig · ±${acc} m` : `GPS zwak · ±${acc} m`;
      if (map) {
        if (!me) me = dotMarker(map).addTo(map);
        me.setLatLng([data.lat, data.lon]);
        if (first) { map.setView([data.lat, data.lon], 16); first = false; }
      }
    } else if (type === 'gps-error') {
      const t = $('#gps-txt'); if (t) t.textContent = 'GPS fout: ' + data;
    }
  });

  const renderDetail = () => {
    const el = $('#mode-detail');
    const m = setup.mode;
    if (m === 'free') {
      el.innerHTML = `<p class="muted small">Gewoon lopen. Auto-ronde elke ${s.autoLapKm} km, stem update elke ${s.voiceIntervalKm} km.</p>`;
    } else if (m === 'workout') {
      const list = presets(s.thresholdPace);
      el.innerHTML = `<div class="pick-list">${list.map(w => {
        const sum = workoutSummary(w.steps);
        return `<button class="pick ${setup.workout?.id === w.id ? 'on' : ''}" data-w="${w.id}"><b>${esc(w.name)}</b><span>${esc(w.desc)} · ~${Math.round(sum.time / 60)} min${sum.dist ? ` + ${fmtKm(sum.dist, 1)} km` : ''}</span></button>`;
      }).join('')}</div>`;
      $$('[data-w]', el).forEach(b => b.onclick = () => { setup.workout = list.find(w => w.id === b.dataset.w); renderDetail(); });
    } else if (m === 'plan') {
      if (!s.plan) { el.innerHTML = `<p class="muted small">Nog geen trainingsschema. <a href="#/training/schema">Maak er een aan</a>.</p>`; return; }
      if (!today) { el.innerHTML = `<p class="muted small">Vandaag staat er niets op je schema. Rustdag of vrije run!</p>`; return; }
      const w = sessionToWorkout(today);
      setup.workout = w ? { ...w, id: 'plan', planSession: today.id } : null;
      el.innerHTML = `<div class="pick on"><b>Vandaag: ${esc(today.title)}</b><span>${w ? `${w.steps.length} stap(pen)` : ''}</span></div>`;
    } else if (m === 'ghost') {
      const list = acts.filter(a => a.points?.length > 10).slice(0, 30);
      el.innerHTML = list.length ? `<p class="muted small">Ren tegen een eerdere run. Je hoort of je voor of achter ligt.</p><div class="pick-list">${list.map(a => `<button class="pick ${setup.ghost?.id === a.id ? 'on' : ''}" data-g="${a.id}"><b>${esc(a.name)}</b><span>${fmtKm(a.stats.distance)} km · ${fmtTime(a.stats.movingTime)} · ${fmtPace(a.stats.avgPace)} /km</span></button>`).join('')}</div>` : '<p class="muted small">Nog geen runs om tegen te racen.</p>';
      $$('[data-g]', el).forEach(b => b.onclick = () => { setup.ghost = list.find(a => a.id === b.dataset.g); renderDetail(); drawRoute(); });
    } else if (m === 'route') {
      db.all('routes').then(routes => {
        el.innerHTML = routes.length ? `<div class="pick-list">${routes.map(r => `<button class="pick ${setup.route?.id === r.id ? 'on' : ''}" data-r="${r.id}"><b>${esc(r.name)}</b><span>${fmtKm(r.distance)} km${r.elevGain ? ` · ↑${r.elevGain} m` : ''}</span></button>`).join('')}</div>` : `<p class="muted small">Nog geen routes. <a href="#/routes">Plan er een</a>.</p>`;
        $$('[data-r]', el).forEach(b => b.onclick = () => { setup.route = routes.find(r => r.id === b.dataset.r); renderDetail(); drawRoute(); });
      });
    }
  };
  renderDetail();
  drawRoute();

  $$('#mode-seg button').forEach(b => b.onclick = () => {
    setup = { mode: b.dataset.mode, workout: null, ghost: null, route: null };
    $$('#mode-seg button').forEach(x => x.classList.toggle('on', x === b));
    routeLayer?.remove();
    renderDetail();
  });
  $('#hr-btn').onclick = async () => {
    try {
      if (heartRate.connected) { heartRate.disconnect(); }
      else { const name = await heartRate.connect(); toast(`Verbonden met ${name}`); }
    } catch (e) { if (e.name !== 'NotFoundError') toast(e.message); }
    renderPrepare(view);
  };
  $('#cad-btn').onclick = async (e) => {
    const on = !e.currentTarget.classList.contains('on');
    if (on && !(await cadence.start())) { toast('Bewegingssensor niet beschikbaar'); return; }
    if (!on) cadence.stop();
    s._cad = on; e.currentTarget.classList.toggle('on', on);
  };
  $('#voice-btn').onclick = e => { saveSettings({ voice: !s.voice }); e.currentTarget.classList.toggle('on', s.voice); };
  $('#ap-btn').onclick = e => { saveSettings({ autoPause: !s.autoPause }); e.currentTarget.classList.toggle('on', s.autoPause); };
  $('#start-btn').onclick = () => {
    if (setup.mode === 'workout' && !setup.workout) return toast('Kies eerst een workout');
    if (setup.mode === 'ghost' && !setup.ghost) return toast('Kies eerst een ghost run');
    if (setup.mode === 'route' && !setup.route) return toast('Kies eerst een route');
    if (!rec.fix || rec.fix.accuracy > 50) {
      confirmDialog('GPS signaal is nog zwak. Toch starten? Je eerste meters kunnen minder nauwkeurig zijn.', 'Toch starten').then(ok => ok && begin(view));
    } else begin(view);
  };
}

async function begin(view) {
  const s = settings();
  primeSpeech();
  if (s._cad && !cadence.active) await cadence.start();
  rec.workout = setup.workout;
  rec.ghost = setup.ghost;
  if (setup.route) {
    const r = setup.route;
    if (!r.cum) { r.cum = [0]; for (let i = 1; i < r.path.length; i++) r.cum.push(r.cum[i - 1] + L.latLng(r.path[i - 1].lat, r.path[i - 1].lon).distanceTo([r.path[i].lat, r.path[i].lon])); }
    rec.route = r;
  }
  if (s.keepAwake) keepAwake(true);
  // Aftellen
  const n = s.countdown || 0;
  if (n > 0) {
    const cd = document.createElement('div');
    cd.className = 'countdown';
    document.body.appendChild(cd);
    let skip = false;
    cd.onclick = () => { skip = true; };
    for (let i = n; i > 0 && !skip; i--) {
      cd.innerHTML = `<span>${i}</span><small>tik om over te slaan</small>`;
      beep(700, 120); vibrate(60);
      await new Promise(r => setTimeout(r, 1000));
    }
    cd.remove();
  }
  beep(1300, 300); vibrate(300);
  speak(setup.workout ? `Workout gestart: ${setup.workout.name}` : 'Run gestart', s.voice);
  rec.start();
  showLive();
}

// ---------- Live scherm ----------
function showLive() {
  document.body.classList.add('recording');
  const s = settings();
  const live = document.createElement('div');
  live.className = 'live';
  live.id = 'live';
  const pages = ['Statistieken', 'Kaart', 'Rondes', 'Grafieken'];
  live.innerHTML = `
    <div class="live-top">
      <span class="gps-mini" id="l-gps"><span class="sig"><i></i><i></i><i></i><i></i></span></span>
      <span class="live-state" id="l-state">Bezig</span>
      <span class="live-clock" id="l-clock"></span>
    </div>
    <div class="live-pages" id="l-pages">
      <section class="lp lp-stats">
        <div id="l-workout" class="l-workout" hidden></div>
        <div id="l-ghost" class="l-ghost" hidden></div>
        <div id="l-route" class="l-ghost" hidden></div>
        <div class="big-metric"><div class="v" id="l-time">0:00</div><div class="k">Tijd</div></div>
        <div class="big-metric dist"><div class="v" id="l-dist">0,00</div><div class="k">Kilometer</div></div>
        <div class="grid3">
          <div class="m"><div class="v" id="l-pace">--:--</div><div class="k">Tempo nu /km</div></div>
          <div class="m"><div class="v" id="l-avg">--:--</div><div class="k">Gem. tempo</div></div>
          <div class="m"><div class="v" id="l-lap">--:--</div><div class="k" id="l-lap-k">Ronde 1</div></div>
        </div>
        <div class="hr-block" id="l-hr-block">
          <div class="hr-main"><span class="heart">❤</span><span class="v" id="l-hr">--</span><span class="k" id="l-hrz"></span></div>
          <div class="zone-strip">${[1, 2, 3, 4, 5].map(z => `<i data-z="${z}" style="--c:${ZONE_COLORS[z]}"></i>`).join('')}</div>
        </div>
        <div class="grid3">
          <div class="m"><div class="v" id="l-cad">--</div><div class="k">Cadans spm</div></div>
          <div class="m"><div class="v" id="l-elev">0</div><div class="k">Stijging m</div></div>
          <div class="m"><div class="v" id="l-kcal">0</div><div class="k">Calorieën</div></div>
        </div>
        <div class="grid2">
          <div class="m"><div class="v" id="l-elapsed">0:00</div><div class="k">Totale tijd</div></div>
          <div class="m"><div class="v" id="l-lapd">0,00</div><div class="k">Ronde afstand</div></div>
        </div>
      </section>
      <section class="lp lp-map">
        <div id="l-map" class="l-map"></div>
        <div class="map-strip"><div><b id="lm-time">0:00</b><span>tijd</span></div><div><b id="lm-dist">0,00</b><span>km</span></div><div><b id="lm-pace">--:--</b><span>/km</span></div></div>
      </section>
      <section class="lp lp-laps"><h3>Rondes</h3><div id="l-laps" class="lap-table"></div></section>
      <section class="lp lp-charts">
        <h3>Tempo</h3><div id="l-c-pace" class="chart-box"></div>
        <h3>Hartslag</h3><div id="l-c-hr" class="chart-box"></div>
        <h3>Tijd in hartslagzones</h3><div id="l-zones"></div>
      </section>
    </div>
    <div class="dots" id="l-dots">${pages.map((p, i) => `<i class="${i ? '' : 'on'}" title="${p}"></i>`).join('')}</div>
    <div class="live-ctrl" id="l-ctrl"></div>
    <div class="lock-layer" id="l-lock" hidden><div class="lock-ring" id="l-unlock"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="45"/></svg><span>🔒</span></div><p>Houd vast om te ontgrendelen</p></div>
  `;
  document.body.appendChild(live);

  // Paginering
  const pagesEl = $('#l-pages', live);
  let mapInit = false, map, trackLine, me, routeLine;
  pagesEl.addEventListener('scroll', () => {
    const i = Math.round(pagesEl.scrollLeft / pagesEl.clientWidth);
    $$('#l-dots i', live).forEach((d, k) => d.classList.toggle('on', k === i));
    if (i === 1 && !mapInit) {
      mapInit = true;
      map = createMap($('#l-map', live));
      if (map) {
        trackLine = L.polyline([], { color: '#c6ff3d', weight: 5 }).addTo(map);
        me = dotMarker(map).addTo(map);
        const rp = rec.route?.path || rec.ghost?.points;
        if (rp) routeLine = L.polyline(latlngs(rp), { color: rec.route ? '#3fa7ff' : '#b93dff', weight: 4, opacity: 0.6, dashArray: '6 6' }).addTo(map);
        renderMap(true);
      }
    }
    if (i === 3) renderCharts();
  }, { passive: true });

  const renderMap = (fit = false) => {
    if (!map) return;
    const ll = latlngs(rec.points);
    trackLine.setLatLngs(ll);
    const f = rec.fix;
    if (f) { me.setLatLng([f.lat, f.lon]); if (!fit) map.panTo([f.lat, f.lon], { animate: true }); }
    if (fit) { if (ll.length > 1) map.fitBounds(trackLine.getBounds(), { padding: [40, 40] }); else if (f) map.setView([f.lat, f.lon], 17); }
  };

  const renderCharts = () => {
    const ps = paceSeries(rec.points);
    lineChart($('#l-c-pace', live), { data: ps.map(p => ({ x: p.d / 1000, y: p.pace && p.pace < 900 ? p.pace : null })), invert: true, yFmt: fmtPace, xFmt: v => fmtNum(v, 1), unit: '/km', height: 120 });
    lineChart($('#l-c-hr', live), { data: rec.points.map(p => ({ x: p.d / 1000, y: p.hr || null })), color: '#ff3d5a', xFmt: v => fmtNum(v, 1), unit: 'bpm', height: 120 });
    const zt = zoneTimes(rec.points, 'hr');
    $('#l-zones', live).innerHTML = hrZones().map((z, i) => `<div class="zone-row"><span class="zone-name"><i style="background:${ZONE_COLORS[i + 1]}"></i>Z${i + 1}</span><div class="zone-track"><div style="width:${zt[i] / (zt.reduce((a, b) => a + b, 0) || 1) * 100}%;background:${ZONE_COLORS[i + 1]}"></div></div><span class="zone-time">${fmtTime(zt[i])}</span></div>`).join('');
  };

  const renderLaps = () => {
    const cur = rec.lapStats();
    const rows = [...rec.laps.map(l => ({ ...l })), { n: rec.laps.length + 1, dist: cur.d, time: cur.m, pace: cur.pace, hr: 0, current: true }];
    const fastest = Math.min(...rec.laps.map(l => l.pace).filter(Boolean));
    $('#l-laps', live).innerHTML = `<div class="lap-row head"><span>#</span><span>Afstand</span><span>Tijd</span><span>Tempo</span><span>HR</span></div>` +
      rows.reverse().map(l => `<div class="lap-row ${l.current ? 'cur' : ''} ${l.pace === fastest ? 'best' : ''}"><span>${l.n}</span><span>${fmtKm(l.dist)}</span><span>${fmtTime(l.time)}</span><span>${fmtPace(l.pace)}</span><span>${l.hr || '-'}</span></div>`).join('');
  };

  const ctrl = $('#l-ctrl', live);
  const renderCtrl = () => {
    if (rec.state === 'running' || rec.state === 'autopaused') {
      ctrl.innerHTML = `<button class="cbtn" id="c-lap">Ronde</button><button class="cbtn big pause" id="c-pause">❚❚</button><button class="cbtn" id="c-lock">🔒</button>`;
      $('#c-lap', ctrl).onclick = () => { rec.lap(false); renderLaps(); };
      $('#c-pause', ctrl).onclick = () => { if (rec.state === 'autopaused') { rec._mt = rec.moving; rec.state = 'paused'; rec.emit('state', 'paused'); } else rec.pause(false); };
      $('#c-lock', ctrl).onclick = () => lock(true);
    } else if (rec.state === 'paused') {
      ctrl.innerHTML = `<button class="cbtn big resume" id="c-resume">▶ Hervat</button><button class="cbtn big stop hold" id="c-stop"><span>■ Stop</span><i></i></button>`;
      $('#c-resume', ctrl).onclick = () => rec.resume(false);
      holdButton($('#c-stop', ctrl), 900, () => finishRun());
    }
  };

  const lockLayer = $('#l-lock', live);
  const lock = on => { lockLayer.hidden = !on; vibrate(40); };
  holdButton($('#l-unlock', live), 1200, () => lock(false));

  const stateLabel = { running: 'Bezig', paused: 'Gepauzeerd', autopaused: 'Auto-pauze' };
  let raf = 0;
  const render = () => {
    raf = 0;
    if (!document.getElementById('live')) return;
    const st = rec.state;
    live.dataset.state = st;
    $('#l-state', live).textContent = stateLabel[st] || '';
    $('#l-clock', live).textContent = new Date().toTimeString().slice(0, 5);
    const t = fmtTime(rec.moving), d = fmtKm(rec.distance);
    const cp = rec.currentPace();
    $('#l-time', live).textContent = t;
    $('#l-dist', live).textContent = d;
    $('#l-pace', live).textContent = fmtPace(cp);
    $('#l-avg', live).textContent = fmtPace(rec.avgPace());
    const lp = rec.lapStats();
    $('#l-lap', live).textContent = fmtPace(lp.pace);
    $('#l-lap-k', live).textContent = `Ronde ${rec.laps.length + 1}`;
    $('#l-lapd', live).textContent = fmtKm(lp.d);
    $('#l-elapsed', live).textContent = fmtTime(rec.elapsed);
    const hr = heartRate.current();
    $('#l-hr-block', live).classList.toggle('off', !hr);
    $('#l-hr', live).textContent = hr || '--';
    const z = hrZoneOf(hr);
    $('#l-hrz', live).textContent = hr ? `Z${z} ${hrZones()[z - 1]?.name || ''}` : 'geen sensor';
    $$('.zone-strip i', live).forEach(i => i.classList.toggle('on', +i.dataset.z === z));
    $('#l-cad', live).textContent = cadence.active ? (cadence.spm() || '--') : '--';
    $('#l-elev', live).textContent = Math.round(rec.elevGain);
    $('#l-kcal', live).textContent = Math.round(1.036 * s.weight * rec.distance / 1000);
    $('#lm-time', live).textContent = t; $('#lm-dist', live).textContent = d; $('#lm-pace', live).textContent = fmtPace(cp);
    const f = rec.fix;
    if (f) $('#l-gps', live).dataset.lvl = f.accuracy <= 8 ? 4 : f.accuracy <= 15 ? 3 : f.accuracy <= 30 ? 2 : 1;

    // Workout paneel
    const wEl = $('#l-workout', live);
    if (rec.workout) {
      wEl.hidden = false;
      const step = rec.step;
      if (step) {
        const pr = rec.stepProgress();
        const next = rec.workout.steps[rec.stepIdx + 1];
        const rem = step.dur.type === 'time' ? fmtTime(pr.remaining) : `${Math.round(pr.remaining)} m`;
        let paceInd = '';
        if (step.pace) {
          const status = !cp ? '' : cp < step.pace[0] ? 'fast' : cp > step.pace[1] ? 'slow' : 'ok';
          paceInd = `<div class="target ${status}">Doel ${fmtPace(step.pace[0])}–${fmtPace(step.pace[1])} <b>${status === 'fast' ? '▼ rustiger' : status === 'slow' ? '▲ sneller' : status === 'ok' ? '✓ op tempo' : ''}</b></div>`;
        }
        wEl.dataset.kind = step.kind;
        wEl.innerHTML = `<div class="w-head"><span>${esc(step.label || KIND_LABEL[step.kind])}${step.rep ? ` ${step.rep}` : ''}</span><span>Stap ${rec.stepIdx + 1}/${rec.workout.steps.length}</span></div>
          <div class="w-rem">${rem}</div>
          <div class="w-bar"><i style="width:${pr.frac * 100}%"></i></div>${paceInd}
          ${next ? `<div class="w-next">Hierna: ${esc(next.label || KIND_LABEL[next.kind])} ${next.dur.type === 'time' ? fmtTime(next.dur.value) : `${next.dur.value} m`}</div>` : ''}`;
      } else {
        wEl.dataset.kind = 'done';
        wEl.innerHTML = '<div class="w-rem">✓ Workout klaar</div>';
      }
    }
    const g = rec.ghostDelta();
    const gEl = $('#l-ghost', live);
    if (rec.ghost) {
      gEl.hidden = false;
      gEl.className = 'l-ghost ' + (g == null ? '' : g <= 0 ? 'ahead' : 'behind');
      gEl.textContent = g == null ? `Ghost: ${rec.ghost.name}` : `${g <= 0 ? 'Voor' : 'Achter'} op ghost: ${fmtTime(Math.abs(g))}`;
    }
    const rp = rec.routeProgress();
    const rEl = $('#l-route', live);
    if (rec.route && rp) {
      rEl.hidden = false;
      rEl.className = 'l-ghost ' + (rp.off > 60 ? 'behind' : 'ahead');
      rEl.textContent = rp.off > 60 ? `⚠ Van de route af (${Math.round(rp.off)} m)` : `Nog ${fmtKm(rp.remaining)} km op route`;
    }
    if (mapInit && pagesEl.scrollLeft > pagesEl.clientWidth * 0.5 && pagesEl.scrollLeft < pagesEl.clientWidth * 1.5) renderMap();
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(render); };
  rec.on((type) => {
    if (type === 'state') { renderCtrl(); schedule(); }
    else if (type === 'lap' || type === 'step') { renderLaps(); schedule(); }
    else schedule();
  });
  renderCtrl();
  renderLaps();
  render();
  setInterval(() => { if (document.getElementById('live')) { const i = Math.round(pagesEl.scrollLeft / pagesEl.clientWidth); if (i === 3) renderCharts(); if (i === 2) renderLaps(); } }, 5000);
}

function holdButton(btn, ms, fn) {
  let t = null;
  const start = e => {
    e.preventDefault();
    btn.classList.add('holding');
    btn.style.setProperty('--hold', `${ms}ms`);
    t = setTimeout(() => { btn.classList.remove('holding'); vibrate(120); fn(); }, ms);
  };
  const cancel = () => { clearTimeout(t); btn.classList.remove('holding'); };
  btn.addEventListener('pointerdown', start);
  btn.addEventListener('pointerup', cancel);
  btn.addEventListener('pointerleave', cancel);
  btn.addEventListener('pointercancel', cancel);
}

// ---------- Afronden en opslaan ----------
async function finishRun() {
  const act = rec.finish();
  keepAwake(false);
  cadence.stop();
  speak('Run beëindigd. Goed gedaan!', settings().voice);
  document.getElementById('live')?.remove();
  document.body.classList.remove('recording');
  if (act.points.length < 2 || (act.points[act.points.length - 1].d || 0) < 10) {
    clearLive();
    const keep = await confirmDialog('Deze run is erg kort (minder dan 10 m). Toch opslaan?', 'Opslaan');
    if (!keep) { rec = null; navigate('#/'); return; }
  }
  finalize(act);
  showSave(act);
}

function showSave(act) {
  const s = settings();
  const st = act.stats;
  const shoes = s.shoes.filter(x => !x.retired);
  const close = modal(`
    <div class="save">
      <h2>Run opslaan</h2>
      <div id="save-map" class="save-map"></div>
      <div class="save-stats">
        <div><b>${fmtKm(st.distance)}</b><span>km</span></div>
        <div><b>${fmtTime(st.movingTime)}</b><span>tijd</span></div>
        <div><b>${fmtPace(st.avgPace)}</b><span>/km</span></div>
        <div><b>${st.elevGain}</b><span>m ↑</span></div>
      </div>
      <label class="field"><span>Titel</span><input id="sv-name" value="${esc(act.name)}"></label>
      <label class="field"><span>Hoe ging het?</span><textarea id="sv-desc" rows="3" placeholder="Beschrijving voor jou en je Strava vrienden"></textarea></label>
      <label class="field"><span>Ervaren inspanning: <b id="rpe-v">5</b>/10 <em id="rpe-l">Gemiddeld</em></span><input type="range" min="1" max="10" value="5" id="sv-rpe"></label>
      ${shoes.length ? `<label class="field"><span>Schoenen</span><select id="sv-shoe"><option value="">Geen</option>${shoes.map(x => `<option value="${x.id}" ${x.id === s.defaultShoe ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : ''}
      <label class="check"><input type="checkbox" id="sv-elev" checked> Hoogte corrigeren met hoogtekaart (nauwkeuriger)</label>
      ${strava.isConnected() ? `<label class="check"><input type="checkbox" id="sv-strava" ${s.strava.autoUpload ? 'checked' : ''}> Direct delen op Strava</label>` : ''}
      <div class="row gap">
        <button class="btn danger ghost" id="sv-discard">Verwijderen</button>
        <button class="btn primary grow" id="sv-save">Opslaan</button>
      </div>
    </div>`, {
    wide: true,
    onMount: (m) => {
      const map = createMap($('#save-map', m), { interactive: false });
      if (map) {
        const ll = latlngs(act.points);
        if (ll.length > 1) {
          const ps = paceSeries(act.points);
          const g = coloredTrack(map, act.points, ps.map(p => p.pace), { invert: true });
          startEndMarkers(map, act.points);
          map.fitBounds(L.polyline(ll).getBounds(), { padding: [20, 20] });
          void g;
        }
      }
      const RPE = ['', 'Heel licht', 'Licht', 'Licht', 'Gemiddeld', 'Gemiddeld', 'Zwaar', 'Zwaar', 'Heel zwaar', 'Heel zwaar', 'Maximaal'];
      $('#sv-rpe', m).oninput = e => { $('#rpe-v', m).textContent = e.target.value; $('#rpe-l', m).textContent = RPE[e.target.value]; };
      $('#sv-discard', m).onclick = async () => {
        if (await confirmDialog('Deze run definitief verwijderen?', 'Verwijderen', true)) { clearLive(); close(); rec = null; navigate('#/'); }
      };
      $('#sv-save', m).onclick = async () => {
        const btn = $('#sv-save', m);
        btn.disabled = true; btn.textContent = 'Opslaan...';
        act.name = $('#sv-name', m).value.trim() || act.name;
        act.description = $('#sv-desc', m).value.trim();
        act.rpe = +$('#sv-rpe', m).value;
        act.shoeId = $('#sv-shoe', m)?.value || null;
        if ($('#sv-elev', m).checked && navigator.onLine) {
          try { await correctElevation(act); } catch { /* offline: gebruik GPS hoogte */ }
        }
        finalize(act);
        // Schema-sessie afvinken
        if (act.workout && setup.workout?.planSession && s.plan) {
          const sess = s.plan.sessions.find(x => x.id === setup.workout.planSession);
          if (sess) { sess.done = act.id; saveSettings({ plan: s.plan }); }
        } else if (s.plan) {
          const sess = s.plan.sessions.find(x => new Date(x.date).toDateString() === new Date(act.start).toDateString() && !x.done);
          if (sess) { sess.done = act.id; saveSettings({ plan: s.plan }); }
        }
        await saveActivity(act);
        clearLive();
        rec = null;
        const share = $('#sv-strava', m)?.checked;
        close();
        navigate(`#/activiteit/${act.id}${share ? '?strava=1' : ''}`);
        toast('Run opgeslagen 🎉');
      };
    },
  });
}

export async function correctElevation(act) {
  const withPos = act.points.map((p, i) => ({ p, i })).filter(x => x.p.lat != null);
  if (!withPos.length) return;
  // Steekproef van max ~400 punten, daarna interpoleren
  const step = Math.max(1, Math.ceil(withPos.length / 400));
  const sample = withPos.filter((_, k) => k % step === 0 || k === withPos.length - 1);
  const elev = await fetchElevations(sample.map(x => x.p));
  for (let k = 0; k < sample.length - 1; k++) {
    const a = sample[k], b = sample[k + 1];
    for (let i = a.i; i <= b.i; i++) {
      const f = b.i === a.i ? 0 : (i - a.i) / (b.i - a.i);
      if (elev[k] != null && elev[k + 1] != null) act.points[i].ele = Math.round((elev[k] + (elev[k + 1] - elev[k]) * f) * 10) / 10;
    }
  }
  act.elevCorrected = true;
}

// ---------- Herstel na crash ----------
export async function checkRecovery() {
  const live = loadLive();
  if (!live?.points?.length) return;
  const ok = await confirmDialog(`Er is een onafgemaakte run gevonden (${fmtKm(live.distance)} km, ${fmtTime(live._mt)}). Doorgaan?`, 'Hervatten');
  if (!ok) {
    const save = await confirmDialog('Wil je de run tot nu toe opslaan?', 'Opslaan');
    clearLive();
    if (save) {
      const r = new Recorder({ settings: settings(), restore: { ...live, state: 'paused', _runSince: 0 } });
      rec = r;
      finishRun();
    }
    return;
  }
  rec?.destroy();
  rec = new Recorder({ settings: settings(), restore: { ...live, state: 'paused', _runSince: 0 } });
  if (settings().keepAwake) keepAwake(true);
  showLive();
}

window.addEventListener('beforeunload', e => {
  if (isRecording()) { rec.persist(); e.preventDefault(); e.returnValue = ''; }
});

export function leavePrepare() {
  if (rec && rec.state === 'ready') { rec.destroy(); rec = null; }
}

export function presetRoute(route) {
  setup = { mode: 'route', workout: null, ghost: null, route };
}
