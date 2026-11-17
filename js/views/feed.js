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
  const R = 42, C = 2 * Math.PI * R;
  const todaySession = s.plan?.sessions.find(x => new Date(x.date).toDateString() === new Date().toDateString());

  view.innerHTML = `
  <header class="top"><h1>Hoi ${esc(s.name.split(' ')[0])} 👋</h1><button class="icon-btn" id="imp" title="Importeren">⤓</button></header>
  <section class="card week-card">
    <div class="ring">
      <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="${R}" class="ring-bg"/><circle cx="50" cy="50" r="${R}" class="ring-fg" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg>
      <div class="ring-txt"><b>${fmtKm(wDist, 1)}</b><span>/ ${s.weeklyGoalKm} km</span></div>
    </div>
    <div class="week-info">
      <h3>Deze week</h3>
      <div class="kv"><span>Runs</span><b>${week.length}</b></div>
      <div class="kv"><span>Tijd</span><b>${fmtTime(wTime)}</b></div>
      <div class="kv"><span>Stijging</span><b>${wElev} m</b></div>
      <div class="week-days">${days.map(d => `<div class="${d.today ? 'today' : ''}"><i style="height:${d.dist / maxDay * 100}%"></i><span>${d.l}</span></div>`).join('')}</div>
    </div>
  </section>
  <section class="row gap stat-pills">
    <div class="pill-card"><b>🔥 ${streak}</b><span>weken streak</span></div>
    <div class="pill-card"><b>${fmtKm(yDist, 0)}</b><span>km in ${new Date().getFullYear()} ${yDist >= yExpected ? '<em class="up">▲ op schema</em>' : '<em class="down">▼ achter</em>'}</span>
      <div class="mini-bar"><i style="width:${Math.min(100, yDist / (s.yearGoalKm * 10))}%"></i><u style="left:${Math.min(100, yExpected / (s.yearGoalKm * 10))}%"></u></div></div>
  </section>
  ${todaySession ? `<a class="card today-card" href="#/rennen"><span class="tag">Vandaag op je schema</span><b>${esc(todaySession.title)}</b>${todaySession.done ? '<span class="done">✓ gedaan</span>' : '<span class="go">Start →</span>'}</a>` : ''}
  <h2 class="section-title">Activiteiten</h2>
  <div id="feed-list">${acts.length ? acts.slice(0, 50).map(a => card(a, prs)).join('') : `
    <div class="empty">
      <div class="empty-ico">🏃</div>
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
      <div class="badges">${a.stravaId ? '<span class="badge strava" title="Op Strava">S</span>' : ''}${pr.length ? `<span class="badge pr">🏆 ${pr.length}</span>` : ''}${a.workout ? '<span class="badge">Workout</span>' : ''}</div>
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
