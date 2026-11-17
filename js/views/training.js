// Training: voortgang, fitheid & vorm, records, kalender, schema
import { $, $$, esc, fmtTime, fmtPace, fmtKm, fmtNum, fmtShortDate, fmtDate, MONTHS_LONG, startOfDay, toast, confirmDialog } from '../utils.js';
import { settings, saveSettings } from '../settings.js';
import { activities } from '../db.js';
import { barChart, lineChart } from '../charts.js';
import { weeklyTotals, fitnessSeries, BEST_EFFORTS, currentVdot, predictTime, trainingPaces } from '../stats.js';
import { generatePlan, PLAN_GOALS, KIND_LABEL } from '../workouts.js';
import { navigate } from '../router.js';

const TABS = [['voortgang', 'Voortgang'], ['fitheid', 'Fitheid'], ['records', 'Records'], ['kalender', 'Kalender'], ['schema', 'Schema']];

export async function renderTraining(view, tab = 'voortgang', q) {
  view.innerHTML = `<header class="top"><h1>Training</h1></header>
    <nav class="tabs">${TABS.map(([k, l]) => `<a href="#/training/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</nav>
    <div id="t-body"></div>`;
  const body = $('#t-body');
  const acts = await activities();
  ({ voortgang, fitheid, records, kalender, schema })[tab]?.(body, acts, q);
}

function voortgang(el, acts) {
  const s = settings();
  const weeks = weeklyTotals(acts, 12);
  const metric = localStorage.getItem('tempo.progMetric') || 'dist';
  const fm = { dist: v => fmtNum(v / 1000, 0), time: v => `${Math.round(v / 3600 * 10) / 10}u`, elev: v => Math.round(v), count: v => v };
  const cur = weeks[weeks.length - 1];
  const prev = weeks[weeks.length - 2];
  const avg4 = weeks.slice(-5, -1).reduce((t, w) => t + w.dist, 0) / 4;
  // Maandtotalen laatste 12 maanden
  const months = [...Array(12)].map((_, i) => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); d.setMonth(d.getMonth() - 11 + i);
    const e = new Date(d); e.setMonth(e.getMonth() + 1);
    const list = acts.filter(a => a.start >= d.getTime() && a.start < e.getTime());
    return { label: MONTHS_LONG[d.getMonth()].slice(0, 3), dist: list.reduce((t, a) => t + a.stats.distance, 0) };
  });
  const all = acts.reduce((t, a) => t + a.stats.distance, 0);
  const longest = acts.reduce((b, a) => (a.stats.distance > (b?.stats.distance || 0) ? a : b), null);
  // Schoenen
  const shoes = s.shoes.map(sh => ({ ...sh, km: (sh.startKm || 0) + acts.filter(a => a.shoeId === sh.id).reduce((t, a) => t + a.stats.distance, 0) / 1000 }));

  el.innerHTML = `
  <section class="card">
    <div class="row between"><h3>Laatste 12 weken</h3>
      <div class="seg small" id="pm">${[['dist', 'km'], ['time', 'tijd'], ['elev', 'hoogte'], ['count', 'runs']].map(([k, l]) => `<button data-m="${k}" class="${k === metric ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div id="wk-chart"></div>
    <div class="stat-grid">
      <div><span>Deze week</span><b>${fmtKm(cur.dist, 1)} km</b></div>
      <div><span>Vorige week</span><b>${fmtKm(prev.dist, 1)} km</b></div>
      <div><span>Gem. 4 weken</span><b>${fmtKm(avg4, 1)} km</b></div>
    </div>
    ${avg4 > 0 && cur.dist > avg4 * 1.3 ? '<p class="warn small">Let op: je loopt deze week flink meer dan je 4-weeks gemiddelde. Pas op voor blessures (10% regel).</p>' : ''}
  </section>
  <section class="card"><h3>Per maand</h3><div id="mo-chart"></div></section>
  <section class="card"><h3>Doelen</h3>
    <div class="goal"><div class="row between"><span>Week</span><b>${fmtKm(cur.dist, 1)} / ${s.weeklyGoalKm} km</b></div><div class="mini-bar"><i style="width:${Math.min(100, cur.dist / s.weeklyGoalKm / 10)}%"></i></div></div>
    ${(() => { const y0 = new Date(new Date().getFullYear(), 0, 1).getTime(); const yd = acts.filter(a => a.start >= y0).reduce((t, a) => t + a.stats.distance, 0); return `<div class="goal"><div class="row between"><span>Jaar</span><b>${fmtKm(yd, 0)} / ${s.yearGoalKm} km</b></div><div class="mini-bar"><i style="width:${Math.min(100, yd / s.yearGoalKm / 10)}%"></i></div></div>`; })()}
    <a href="#/profiel" class="small">Doelen aanpassen</a>
  </section>
  <section class="card"><h3>Totalen</h3>
    <div class="stat-grid">
      <div><span>Runs</span><b>${acts.length}</b></div>
      <div><span>Totaal</span><b>${fmtKm(all, 0)} km</b></div>
      <div><span>Tijd</span><b>${fmtTime(acts.reduce((t, a) => t + a.stats.movingTime, 0))}</b></div>
      <div><span>Langste run</span><b>${longest ? fmtKm(longest.stats.distance, 1) + ' km' : '-'}</b></div>
      <div><span>Hoogtemeters</span><b>${acts.reduce((t, a) => t + a.stats.elevGain, 0)} m</b></div>
      <div><span>Gem. per run</span><b>${acts.length ? fmtKm(all / acts.length, 1) : 0} km</b></div>
    </div>
  </section>
  ${shoes.length ? `<section class="card"><h3>Schoenen</h3>${shoes.map(sh => `<div class="goal"><div class="row between"><span>${esc(sh.name)}${sh.retired ? ' (met pensioen)' : ''}</span><b>${fmtNum(sh.km, 0)} / ${sh.limitKm} km</b></div><div class="mini-bar ${sh.km > sh.limitKm * 0.9 ? 'warn' : ''}"><i style="width:${Math.min(100, sh.km / sh.limitKm * 100)}%"></i></div></div>`).join('')}</section>` : ''}`;
  const drawWk = m => barChart($('#wk-chart'), weeks.map(w => ({ label: fmtShortDate(w.from).split(' ')[0], value: m === 'count' ? w.count : w[m], title: fmtShortDate(w.from) })), { fmt: fm[m], height: 150 });
  drawWk(metric);
  $$('#pm button').forEach(b => b.onclick = () => { localStorage.setItem('tempo.progMetric', b.dataset.m); $$('#pm button').forEach(x => x.classList.toggle('on', x === b)); drawWk(b.dataset.m); });
  barChart($('#mo-chart'), months.map(m => ({ label: m.label, value: m.dist })), { fmt: v => fmtNum(v / 1000, 0), height: 130 });
}

function fitheid(el, acts) {
  const days = +(localStorage.getItem('tempo.fitDays') || 90);
  const ser = fitnessSeries(acts, days);
  const last = ser[ser.length - 1] || { ctl: 0, atl: 0, tsb: 0 };
  const weekAgo = ser[ser.length - 8] || last;
  const form = last.tsb;
  const formLabel = form > 15 ? 'Uitgerust (mogelijk detraining)' : form > 5 ? 'Fris, klaar voor een wedstrijd' : form > -10 ? 'Neutraal' : form > -30 ? 'Optimale trainingsprikkel' : 'Overbelast, neem rust';
  el.innerHTML = `
  <section class="card">
    <div class="row between"><h3>Fitheid & vorm</h3><div class="seg small" id="fd">${[42, 90, 180, 365].map(d => `<button data-d="${d}" class="${d === days ? 'on' : ''}">${d}d</button>`).join('')}</div></div>
    <div class="stat-grid">
      <div><span>Fitheid</span><b class="c-fit">${Math.round(last.ctl)}</b><small>${last.ctl >= weekAgo.ctl ? '▲' : '▼'} ${Math.abs(Math.round(last.ctl - weekAgo.ctl))} t.o.v. vorige week</small></div>
      <div><span>Vermoeidheid</span><b class="c-fat">${Math.round(last.atl)}</b></div>
      <div><span>Vorm</span><b class="c-form">${Math.round(form)}</b><small>${formLabel}</small></div>
    </div>
    <div class="chart-label">Fitheid <em>42-daags gemiddelde belasting</em></div><div id="f-ctl" class="chart-box"></div>
    <div class="chart-label">Vermoeidheid <em>7-daags gemiddelde</em></div><div id="f-atl" class="chart-box"></div>
    <div class="chart-label">Vorm <em>fitheid min vermoeidheid</em></div><div id="f-tsb" class="chart-box"></div>
    <div class="chart-label">Dagelijkse belasting</div><div id="f-load" class="chart-box"></div>
  </section>
  <section class="card"><h3>Hoe werkt dit?</h3><p class="muted small">Elke run krijgt een belastingsscore (relatieve inspanning) op basis van je hartslag, of anders je tempo ten opzichte van je drempeltempo. Fitheid is het langetermijngemiddelde, vermoeidheid het kortetermijngemiddelde. Vorm is het verschil: negatief betekent je bouwt op, positief betekent je bent fris.</p></section>`;
  const xf = t => fmtShortDate(t);
  lineChart($('#f-ctl'), { data: ser.map(d => ({ x: d.t, y: d.ctl })), color: '#7d9fbd', xFmt: xf, height: 120 });
  lineChart($('#f-atl'), { data: ser.map(d => ({ x: d.t, y: d.atl })), color: '#d0804a', xFmt: xf, height: 100 });
  lineChart($('#f-tsb'), { data: ser.map(d => ({ x: d.t, y: d.tsb })), color: '#e8a33a', xFmt: xf, height: 100, fill: false, refLines: [{ y: 0, color: '#ffffff44' }] });
  lineChart($('#f-load'), { data: ser.map(d => ({ x: d.t, y: d.load })), color: '#9b7bb0', xFmt: xf, height: 90 });
  $$('#fd button').forEach(b => b.onclick = () => { localStorage.setItem('tempo.fitDays', b.dataset.d); fitheid(el, acts); });
}

function records(el, acts) {
  const s = settings();
  const rows = BEST_EFFORTS.map(([d, label]) => {
    const list = acts.filter(a => a.efforts?.[d]).map(a => ({ a, t: a.efforts[d].time })).sort((x, y) => x.t - y.t).slice(0, 3);
    return { d, label, list };
  }).filter(r => r.list.length);
  const { vdot: vd, src } = currentVdot(acts);
  const paces = vd ? trainingPaces(vd) : null;
  el.innerHTML = `
  <section class="card"><h3>Persoonlijke records</h3>
    ${rows.length ? rows.map(r => `<div class="pr-block"><div class="row between"><b>${r.label}</b><span class="pr-time">${fmtTime(r.list[0].t)}</span></div>
      ${r.list.map((x, i) => `<a class="pr-row" href="#/activiteit/${x.a.id}"><span><i class="rank">${i + 1}</i>${fmtTime(x.t)}</span><span>${fmtPace(x.t / (r.d / 1000))} /km</span><span>${fmtShortDate(x.a.start)} ${new Date(x.a.start).getFullYear()}</span></a>`).join('')}</div>`).join('') : '<p class="muted">Nog geen records. Ga lopen!</p>'}
  </section>
  <section class="card"><h3>Voorspelde racetijden</h3>
    ${vd ? `<p class="muted small">Op basis van je beste prestatie van de laatste 90 dagen (${esc(BEST_EFFORTS.find(b => b[0] === src.dist)?.[1])} op ${fmtShortDate(src.act.start)}). Geschatte VO2max (VDOT): <b>${fmtNum(vd, 1)}</b></p>
      <div class="stat-grid">${[[5000, '5 km'], [10000, '10 km'], [21097.5, 'Halve'], [42195, 'Marathon']].map(([d, l]) => `<div><span>${l}</span><b>${fmtTime(predictTime(vd, d))}</b><small>${fmtPace(predictTime(vd, d) / (d / 1000))} /km</small></div>`).join('')}</div>
      <h3 class="mt">Trainingstempo's</h3>
      <div class="pace-table">
        <div><span>Rustig / duur</span><b>${fmtPace(paces.easy[1])} – ${fmtPace(paces.easy[0])}</b></div>
        <div><span>Marathontempo</span><b>${fmtPace(paces.marathon)}</b></div>
        <div><span>Drempel</span><b>${fmtPace(paces.threshold)}</b></div>
        <div><span>Interval (VO2max)</span><b>${fmtPace(paces.interval)}</b></div>
        <div><span>Herhalingen</span><b>${fmtPace(paces.rep)}</b></div>
      </div>
      ${Math.abs(paces.threshold - s.thresholdPace) > 5 ? `<button class="btn ghost small" id="set-tp">Drempeltempo instellen op ${fmtPace(paces.threshold)} /km</button>` : ''}`
      : '<p class="muted">Loop minstens 1,5 km om een voorspelling te krijgen.</p>'}
  </section>`;
  $('#set-tp')?.addEventListener('click', () => { saveSettings({ thresholdPace: Math.round(paces.threshold) }); toast('Drempeltempo bijgewerkt'); records(el, acts); });
}

function kalender(el, acts, q) {
  const now = new Date();
  const ym = q?.get('m') ? q.get('m').split('-').map(Number) : [now.getFullYear(), now.getMonth()];
  const [y, m] = ym;
  const first = new Date(y, m, 1);
  const startDow = (first.getDay() + 6) % 7;
  const daysIn = new Date(y, m + 1, 0).getDate();
  const plan = settings().plan;
  const monthActs = acts.filter(a => { const d = new Date(a.start); return d.getFullYear() === y && d.getMonth() === m; });
  const maxD = Math.max(...monthActs.map(a => a.stats.distance), 1);
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push('<div class="cal-cell empty"></div>');
  for (let d = 1; d <= daysIn; d++) {
    const day = new Date(y, m, d).getTime();
    const list = monthActs.filter(a => startOfDay(a.start) === day);
    const ps = plan?.sessions.find(x => startOfDay(x.date) === day);
    const dist = list.reduce((t, a) => t + a.stats.distance, 0);
    const isToday = startOfDay(Date.now()) === day;
    cells.push(`<${list.length ? `a href="#/activiteit/${list[0].id}"` : 'div'} class="cal-cell ${isToday ? 'today' : ''} ${ps ? 'planned' : ''}">
      <span class="cal-d">${d}</span>
      ${dist ? `<i class="cal-dot" style="--s:${0.35 + 0.65 * dist / maxD}"></i><span class="cal-km">${fmtNum(dist / 1000, 1)}</span>` : ps && !ps.done ? `<span class="cal-plan" title="${esc(ps.title)}">${ps.type === 'race' ? 'R' : '·'}</span>` : ''}
    </${list.length ? 'a' : 'div'}>`);
  }
  const prevM = m === 0 ? `${y - 1}-11` : `${y}-${m - 1}`;
  const nextM = m === 11 ? `${y + 1}-0` : `${y}-${m + 1}`;
  const tot = monthActs.reduce((t, a) => t + a.stats.distance, 0);
  el.innerHTML = `<section class="card">
    <div class="row between"><a class="icon-btn" href="#/training/kalender?m=${prevM}">‹</a><h3>${MONTHS_LONG[m]} ${y}</h3><a class="icon-btn" href="#/training/kalender?m=${nextM}">›</a></div>
    <div class="cal-head">${['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].map(d => `<span>${d}</span>`).join('')}</div>
    <div class="cal-grid">${cells.join('')}</div>
    <p class="muted small center">${monthActs.length} runs · ${fmtKm(tot, 1)} km · ${fmtTime(monthActs.reduce((t, a) => t + a.stats.movingTime, 0))}</p>
  </section>
  <section class="card"><h3>Runs in ${MONTHS_LONG[m]}</h3>${monthActs.map(a => `<a class="list-row" href="#/activiteit/${a.id}"><span>${fmtShortDate(a.start)} · ${esc(a.name)}</span><b>${fmtKm(a.stats.distance)} km</b></a>`).join('') || '<p class="muted small">Geen runs</p>'}</section>`;
}

function schema(el, acts) {
  const s = settings();
  const plan = s.plan;
  if (!plan) {
    const weeks = weeklyTotals(acts, 4);
    const avgKm = Math.round(weeks.reduce((t, w) => t + w.dist, 0) / 4000) || 15;
    const def = new Date(); def.setDate(def.getDate() + 7 * 12);
    el.innerHTML = `<section class="card"><h3>Trainingsschema maken</h3>
      <p class="muted small">Een persoonlijk schema met opbouw, herstelweken en taper, afgestemd op je huidige niveau. Interval- en tempotrainingen kun je direct starten met stem-begeleiding.</p>
      <label class="field"><span>Doel</span><select id="p-goal">${Object.entries(PLAN_GOALS).map(([d, g]) => `<option value="${d}" ${d === '10000' ? 'selected' : ''}>${g.name} (${g.weeks} weken)</option>`).join('')}</select></label>
      <label class="field"><span>Wedstrijddatum</span><input type="date" id="p-date" value="${def.toISOString().slice(0, 10)}"></label>
      <label class="field"><span>Dagen per week</span><select id="p-days">${[3, 4, 5, 6].map(n => `<option ${n === 4 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="field"><span>Huidige km per week</span><input type="number" id="p-km" value="${avgKm}"></label>
      <label class="field"><span>Doeltijd (optioneel, u:mm:ss)</span><input id="p-target" placeholder="bijv. 0:50:00"></label>
      <button class="btn primary full" id="p-make">Schema maken</button></section>`;
    $('#p-make').onclick = () => {
      const goal = +$('#p-goal').value;
      const date = $('#p-date').value;
      if (!date || new Date(date) < new Date()) return toast('Kies een datum in de toekomst');
      let vd = currentVdot(acts).vdot;
      const tgt = $('#p-target').value.trim();
      if (tgt) {
        const parts = tgt.split(':').map(Number);
        const sec = parts.reduce((a, p) => a * 60 + p, 0);
        if (sec > 0) {
          // Doel-VDOT gebruiken voor trainingstempo's
          let lo = 20, hi = 85;
          for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (predictTime(mid, goal) > sec) lo = mid; else hi = mid; }
          vd = (lo + hi) / 2;
        }
      }
      if (!vd) {
        // schatting uit drempeltempo
        let lo = 20, hi = 85;
        for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (trainingPaces(mid).threshold > s.thresholdPace) lo = mid; else hi = mid; }
        vd = (lo + hi) / 2;
      }
      const p = generatePlan({ goal, raceDate: date, daysPerWeek: +$('#p-days').value, currentWeeklyKm: +$('#p-km').value, paces: trainingPaces(vd) });
      p.vdot = vd;
      p.target = tgt || null;
      saveSettings({ plan: p });
      toast('Schema aangemaakt');
      schema(el, acts);
    };
    return;
  }
  const today = startOfDay(Date.now());
  const done = plan.sessions.filter(x => x.done).length;
  const past = plan.sessions.filter(x => x.date < today).length;
  const byWeek = {};
  plan.sessions.forEach(x => (byWeek[x.week] ||= []).push(x));
  const daysLeft = Math.ceil((plan.raceDate - Date.now()) / 86400000);
  el.innerHTML = `<section class="card plan-head">
    <div class="row between"><div><h3>${esc(plan.name)}${plan.target ? ` in ${esc(plan.target)}` : ''}</h3><p class="muted small">${fmtDate(plan.raceDate, false)} · nog ${daysLeft} dagen</p></div><button class="btn ghost small" id="p-del">Stoppen</button></div>
    <div class="mini-bar"><i style="width:${done / plan.sessions.length * 100}%"></i></div>
    <p class="muted small">${done} van ${plan.sessions.length} trainingen gedaan${past - done > 0 ? ` · ${past - done} gemist` : ''}</p>
  </section>
  ${Object.entries(byWeek).map(([w, list]) => {
    const isCur = list.some(x => startOfDay(x.date) >= today) && list.some(x => startOfDay(x.date) <= today + 6 * 86400000);
    return `<section class="card plan-week ${isCur ? 'cur' : ''}"><h3>Week ${w}${(+w) % 4 === 0 ? ' · herstelweek' : ''}</h3>
    ${list.map(x => {
      const isToday = startOfDay(x.date) === today;
      const status = x.done ? 'done' : startOfDay(x.date) < today ? 'missed' : isToday ? 'today' : '';
      return `<div class="plan-row ${status}"><span class="pd">${new Date(x.date).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
        <div class="pt"><b>${esc(x.title)}</b>${x.steps ? `<small>${x.steps.filter(st => st.kind === 'run').length}× hard · ${x.steps.find(st => st.pace) ? `${fmtPace(x.steps.find(st => st.pace).pace[0])}-${fmtPace(x.steps.find(st => st.pace).pace[1])} /km` : ''}</small>` : x.pace ? `<small>${fmtPace(x.pace[0])}-${fmtPace(x.pace[1])} /km</small>` : ''}</div>
        <span class="ps">${x.done ? `<a href="#/activiteit/${x.done}">✓</a>` : status === 'missed' ? '✗' : isToday ? '<a href="#/rennen" class="go">Start</a>' : ''}</span></div>`;
    }).join('')}</section>`;
  }).join('')}`;
  $('#p-del').onclick = async () => { if (await confirmDialog('Schema stoppen en verwijderen?', 'Verwijderen', true)) { saveSettings({ plan: null }); schema(el, acts); } };
  setTimeout(() => $('.plan-week.cur')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
  void KIND_LABEL; void navigate;
}
