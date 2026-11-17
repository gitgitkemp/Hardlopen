// Home: weekoverzicht en activiteitenfeed
import { $, esc, fmtTime, fmtPace, fmtKm, fmtDate, startOfWeek, startOfDay } from '../utils.js';
import { settings } from '../settings.js';
import { activities } from '../db.js';
import { routeSvg } from '../charts.js';
import { streakWeeks, BEST_EFFORTS } from '../stats.js';
import { importFiles } from './io.js';

export async function renderFeed(view) {
  const s = settings();
  const acts = await activities();
  const wk = startOfWeek(Date.now());
  const week = acts.filter(a => a.start >= wk);
  const wDist = week.reduce((t, a) => t + a.stats.distance, 0);
  const wTime = week.reduce((t, a) => t + a.stats.movingTime, 0);
  const wElev = week.reduce((t, a) => t + a.stats.elevGain, 0);
  const goal = s.weeklyGoalKm * 1000;
  const pct = Math.min(1, wDist / goal);
  const yStart = new Date(new Date().getFullYear(), 0, 1).getTime();
  const yDist = acts.filter(a => a.start >= yStart).reduce((t, a) => t + a.stats.distance, 0);
  const dayOfYear = (Date.now() - yStart) / 86400000;
  const yExpected = s.yearGoalKm * 1000 * dayOfYear / 365;
  const streak = streakWeeks(acts);
  const prs = prMap(acts);

  // Dagen van de week
  const days = [...Array(7)].map((_, i) => {
    const d0 = wk + i * 86400000;
    const dist = week.filter(a => startOfDay(a.start) === startOfDay(d0 + 3600000)).reduce((t, a) => t + a.stats.distance, 0);
    return { l: 'MDWDVZZ'[i], dist, today: startOfDay(Date.now()) === startOfDay(d0 + 3600000) };
  });
  const maxDay = Math.max(...days.map(d => d.dist), 1);
  const todaySession = s.plan?.sessions.find(x => new Date(x.date).toDateString() === new Date().toDateString());
  const now = new Date();
  const dateLine = now.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });

  view.innerHTML = `
  <header class="top"><div><span class="eyebrow">${esc(dateLine)}</span><h1>Tempo</h1></div><button class="text-btn" id="imp">Import</button></header>
  <section class="card week">
    <div class="eyebrow">Deze week</div>
    <div class="week-num"><b>${fmtKm(wDist, 1)}</b><span>/ ${s.weeklyGoalKm} km</span></div>
    <div class="line-bar"><i style="width:${pct * 100}%"></i></div>
    <div class="week-days">${days.map(d => `<div class="${d.today ? 'today' : ''}"><i style="height:${d.dist ? Math.max(8, d.dist / maxDay * 100) : 0}%"></i><span>${d.l}</span></div>`).join('')}</div>
    <div class="stat-grid">
      <div><span>Runs</span><b>${week.length}</b></div>
      <div><span>Tijd</span><b>${fmtTime(wTime)}</b></div>
      <div><span>Stijging</span><b>${wElev} m</b></div>
      <div><span>Reeks</span><b>${streak} ${streak === 1 ? 'week' : 'weken'}</b></div>
      <div><span>${now.getFullYear()}</span><b>${fmtKm(yDist, 0)} km</b></div>
      <div><span>Jaardoel</span><b class="${yDist >= yExpected ? 'up' : 'down'}">${yDist >= yExpected ? 'op schema' : `${fmtKm(yExpected - yDist, 0)} km achter`}</b></div>
    </div>
  </section>
  ${todaySession ? `<a class="card today-card" href="#/rennen"><span class="eyebrow">Vandaag op je schema</span><b>${esc(todaySession.title)}</b><span class="${todaySession.done ? 'muted' : 'go'}">${todaySession.done ? 'gedaan' : 'starten'}</span></a>` : ''}
  <h2 class="section-title">Activiteiten</h2>
  <div id="feed-list">${acts.length ? acts.slice(0, 50).map(a => card(a, prs)).join('') : `
    <div class="empty">
      <p>Nog geen runs. Druk op de knop onderin om je eerste run op te nemen, of importeer GPX/TCX bestanden of je Strava historie.</p>
      <div class="row gap center"><a class="btn primary" href="#/rennen">Run starten</a><a class="btn ghost" href="#/profiel">Strava importeren</a></div>
    </div>`}</div>
  ${acts.length > 50 ? `<p class="muted center small">+ ${acts.length - 50} oudere activiteiten (zie Training → Kalender)</p>` : ''}`;
  $('#imp').onclick = () => importFiles();
}

// Welke activiteit heeft welk all-time record?
export function prMap(acts) {
  const best = {};
  for (const a of acts) for (const [d, e] of Object.entries(a.efforts || {})) {
    if (!best[d] || e.time < best[d].time) best[d] = { time: e.time, id: a.id };
  }
  const out = {};
  for (const [d, b] of Object.entries(best)) (out[b.id] ||= []).push(+d);
  return out;
}

export function card(a, prs = {}) {
  const st = a.stats;
  const pr = prs[a.id] || [];
  return `<a class="card act-card" href="#/activiteit/${a.id}">
    <div class="act-head">
      <div><b>${esc(a.name)}</b><span>${fmtDate(a.start)}</span></div>
      <div class="badges">${a.workout ? '<span class="badge">workout</span>' : ''}${pr.length ? `<span class="badge pr">${pr.length} PR</span>` : ''}${a.stravaId ? '<span class="badge strava" title="Op Strava">strava</span>' : ''}</div>
    </div>
    <div class="act-body">
      <div class="act-stats">
        <div><span>Afstand</span><b>${fmtKm(st.distance)} km</b></div>
        <div><span>Tempo</span><b>${fmtPace(st.avgPace)} /km</b></div>
        <div><span>Tijd</span><b>${fmtTime(st.movingTime)}</b></div>
        ${st.avgHr ? `<div><span>Hartslag</span><b>${st.avgHr}</b></div>` : `<div><span>Stijging</span><b>${st.elevGain} m</b></div>`}
      </div>
      ${a.points?.some(p => p.lat != null) ? routeSvg(a.points, 110, 76) : ''}
    </div>
    ${pr.length ? `<div class="pr-line">Records: ${pr.map(d => BEST_EFFORTS.find(b => b[0] === d)?.[1]).filter(Boolean).join(', ')}</div>` : ''}
  </a>`;
}
