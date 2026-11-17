// Analyse: splits, beste prestaties, zones, belasting, fitheid, VDOT
import { haversine, startOfDay } from './utils.js';
import { settings, hrZoneOf, paceZoneOf } from './settings.js';

export const BEST_EFFORTS = [
  [400, '400 m'], [1000, '1 km'], [1609.34, '1 mijl'], [3000, '3 km'], [5000, '5 km'],
  [10000, '10 km'], [15000, '15 km'], [21097.5, 'Halve marathon'], [42195, 'Marathon'],
];

// Vul cumulatieve afstand (d) en bewegende tijd (m) aan voor geïmporteerde punten
export function deriveTrack(points) {
  let d = 0, m = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i === 0) { p.d = p._recalc ? 0 : (p.d ?? 0); p.m = 0; d = p.d; delete p._recalc; continue; }
    const prev = points[i - 1];
    const seg = (p.lat != null && prev.lat != null) ? haversine(prev, p) : 0;
    if (p.d == null || p._recalc) d += seg; else d = p.d;
    p.d = d;
    const dt = (p.t - prev.t) / 1000;
    const dd = p.d - prev.d;
    if (dt > 0 && dt < 30 && dd / dt > 0.5) m += dt;
    else if (dt > 0 && dt <= 3 && dd > 0) m += dt;
    p.m = m;
    delete p._recalc;
  }
  return points;
}

export function elevationGain(points, threshold = 3) {
  let gain = 0, loss = 0, ref = null, ema = null;
  for (const p of points) {
    if (p.ele == null || !isFinite(p.ele)) continue;
    ema = ema == null ? p.ele : ema * 0.75 + p.ele * 0.25;
    if (ref == null) { ref = ema; continue; }
    const diff = ema - ref;
    if (diff >= threshold) { gain += diff; ref = ema; }
    else if (diff <= -threshold) { loss -= diff; ref = ema; }
  }
  return { gain, loss };
}

export function computeStats(act, s = settings()) {
  const pts = act.points || [];
  const last = pts[pts.length - 1];
  const distance = act.manualDistance ?? (last?.d || 0);
  const movingTime = act.manualTime ?? (last?.m || 0);
  const elapsedTime = pts.length ? (last.t - pts[0].t) / 1000 : movingTime;
  const { gain, loss } = elevationGain(pts);
  const hrs = pts.filter(p => p.hr > 0).map(p => p.hr);
  const cads = pts.filter(p => p.cad > 0).map(p => p.cad);
  const eles = pts.filter(p => p.ele != null).map(p => p.ele);
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const speeds = paceSeries(pts).map(x => x.speed).filter(v => v > 0);
  const avgHr = Math.round(avg(hrs));
  const stats = {
    distance, movingTime, elapsedTime,
    elevGain: Math.round(gain), elevLoss: Math.round(loss),
    elevMin: eles.length ? Math.min(...eles) : null,
    elevMax: eles.length ? Math.max(...eles) : null,
    avgPace: distance > 0 ? movingTime / (distance / 1000) : 0,
    maxSpeed: speeds.length ? Math.max(...speeds) : 0,
    avgHr, maxHr: hrs.length ? Math.max(...hrs) : 0,
    avgCad: Math.round(avg(cads)),
    calories: Math.round(calories(distance, movingTime, avgHr, s)),
  };
  stats.load = Math.round(trainingLoad(pts, stats, s));
  stats.gap = gradeAdjustedPace(pts) || stats.avgPace;
  act.stats = stats;
  return stats;
}

function calories(distance, time, avgHr, s) {
  const age = new Date().getFullYear() - (s.birthYear || 1995);
  if (avgHr > 0 && time > 0) {
    // Keytel et al. formule
    const min = time / 60;
    const k = s.sex === 'v'
      ? (-20.4022 + 0.4472 * avgHr - 0.1263 * s.weight + 0.074 * age) / 4.184
      : (-55.0969 + 0.6309 * avgHr + 0.1988 * s.weight + 0.2017 * age) / 4.184;
    if (k > 0) return k * min;
  }
  return 1.036 * s.weight * (distance / 1000);
}

// Banister TRIMP met HR, anders tempo-gebaseerde rTSS
export function trainingLoad(pts, stats, s = settings()) {
  const withHr = pts.filter(p => p.hr > 0);
  if (withHr.length > pts.length * 0.5 && withHr.length > 10) {
    let trimp = 0;
    const k = s.sex === 'v' ? [0.86, 1.67] : [0.64, 1.92];
    for (let i = 1; i < pts.length; i++) {
      const dt = (pts[i].m - pts[i - 1].m) / 60;
      if (dt <= 0 || !pts[i].hr) continue;
      const hrr = Math.max(0, Math.min(1, (pts[i].hr - s.restHr) / (s.maxHr - s.restHr)));
      trimp += dt * hrr * k[0] * Math.exp(k[1] * hrr);
    }
    return trimp;
  }
  if (!stats.distance || !stats.movingTime) return 0;
  const pace = stats.movingTime / (stats.distance / 1000);
  const IF = s.thresholdPace / pace;
  return (stats.movingTime / 3600) * IF * IF * 100;
}

// Tempo per punt, gladgestreken over ~ window seconden
export function paceSeries(pts, window = 20) {
  const out = [];
  let j = 0;
  for (let i = 0; i < pts.length; i++) {
    while (j < i && pts[i].m - pts[j].m > window) j++;
    const dm = pts[i].m - pts[j].m;
    const dd = pts[i].d - pts[j].d;
    const speed = dm > 2 ? dd / dm : 0;
    out.push({ d: pts[i].d, m: pts[i].m, speed, pace: speed > 0.3 ? 1000 / speed : null });
  }
  return out;
}

// Grade Adjusted Pace (Minetti-benadering)
export function gradeAdjustedPace(pts) {
  let effD = 0, time = 0;
  for (let i = 5; i < pts.length; i += 5) {
    const a = pts[i - 5], b = pts[i];
    const dd = b.d - a.d, dt = b.m - a.m;
    if (dd < 5 || dt <= 0) continue;
    let g = (a.ele != null && b.ele != null) ? (b.ele - a.ele) / dd : 0;
    g = Math.max(-0.3, Math.min(0.3, g));
    const cost = 155.4 * g ** 5 - 30.4 * g ** 4 - 43.3 * g ** 3 + 46.3 * g ** 2 + 19.5 * g + 3.6;
    effD += dd * cost / 3.6;
    time += dt;
  }
  return effD > 0 ? time / (effD / 1000) : 0;
}

// Interpoleer tijd/waarde op een cumulatieve afstand
export function interpAt(pts, dist, key = 'm') {
  if (!pts.length) return null;
  if (dist <= pts[0].d) return pts[0][key];
  let lo = 0, hi = pts.length - 1;
  if (dist > pts[hi].d) return null;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].d < dist) lo = mid; else hi = mid;
  }
  const a = pts[lo], b = pts[hi];
  const f = b.d === a.d ? 0 : (dist - a.d) / (b.d - a.d);
  return a[key] + (b[key] - a[key]) * f;
}

export function splits(pts, every = 1000) {
  const out = [];
  if (pts.length < 2) return out;
  const total = pts[pts.length - 1].d;
  let prevM = 0, prevD = 0, idx = 0;
  for (let mark = every; prevD < total - 1; mark += every) {
    const end = Math.min(mark, total);
    const m = end === total ? pts[pts.length - 1].m : interpAt(pts, end, 'm');
    const seg = [];
    while (idx < pts.length && pts[idx].d <= end) seg.push(pts[idx++]);
    const hrs = seg.filter(p => p.hr).map(p => p.hr);
    const cads = seg.filter(p => p.cad).map(p => p.cad);
    const eles = seg.filter(p => p.ele != null);
    const dist = end - prevD;
    const time = m - prevM;
    out.push({
      n: out.length + 1, dist, time,
      pace: dist > 0 ? time / (dist / 1000) : 0,
      hr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : 0,
      cad: cads.length ? Math.round(cads.reduce((a, b) => a + b, 0) / cads.length) : 0,
      elev: eles.length > 1 ? Math.round(eles[eles.length - 1].ele - eles[0].ele) : 0,
      partial: dist < every - 1,
    });
    prevM = m; prevD = end;
  }
  return out;
}

// Snelste tijd over vaste afstanden binnen een activiteit (two pointer)
export function bestEfforts(pts) {
  const res = {};
  if (pts.length < 2) return res;
  const total = pts[pts.length - 1].d;
  for (const [dist] of BEST_EFFORTS) {
    if (dist > total) continue;
    let best = Infinity, bestStart = 0, j = 0;
    for (let i = 0; i < pts.length; i++) {
      const target = pts[i].d + dist;
      if (target > total) break;
      if (j < i) j = i;
      while (j < pts.length - 1 && pts[j].d < target) j++;
      const a = pts[j - 1] || pts[j], b = pts[j];
      const f = b.d === a.d ? 0 : (target - a.d) / (b.d - a.d);
      const mEnd = a.m + (b.m - a.m) * f;
      const t = mEnd - pts[i].m;
      if (t > 0 && t < best) { best = t; bestStart = pts[i].d; }
    }
    if (isFinite(best)) res[dist] = { time: best, startD: bestStart };
  }
  return res;
}

export function zoneTimes(pts, type = 'hr', s = settings()) {
  const n = type === 'hr' ? 5 : 6;
  const out = new Array(n).fill(0);
  const ps = type === 'pace' ? paceSeries(pts) : null;
  for (let i = 1; i < pts.length; i++) {
    const dt = pts[i].m - pts[i - 1].m;
    if (dt <= 0 || dt > 30) continue;
    const z = type === 'hr' ? hrZoneOf(pts[i].hr, s) : paceZoneOf(ps[i].pace, s);
    if (z > 0) out[z - 1] += dt;
  }
  return out;
}

// --- Fitheid & vorm (CTL/ATL/TSB) ---
export function fitnessSeries(acts, days = 180) {
  const DAY = 86400000;
  const today = startOfDay(Date.now());
  const first = acts.length ? Math.min(...acts.map(a => startOfDay(a.start))) : today;
  const begin = Math.min(first, today - days * DAY);
  const loadByDay = new Map();
  for (const a of acts) {
    const k = startOfDay(a.start);
    loadByDay.set(k, (loadByDay.get(k) || 0) + (a.stats?.load || 0));
  }
  let ctl = 0, atl = 0;
  const out = [];
  for (let t = begin; t <= today; t += DAY) {
    const day = startOfDay(t + 3600000); // DST-veilig
    const load = loadByDay.get(day) || 0;
    ctl += (load - ctl) / 42;
    atl += (load - atl) / 7;
    if (t >= today - days * DAY) out.push({ t: day, load, ctl, atl, tsb: ctl - atl });
  }
  return out;
}

// --- VDOT (Jack Daniels) ---
export function vdot(distM, timeS) {
  const tMin = timeS / 60;
  const v = distM / tMin;
  const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
  const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);
  return vo2 / pct;
}

export function predictTime(vd, distM) {
  let lo = distM / 7, hi = distM / 1.2; // tussen 7 m/s en 1.2 m/s
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (vdot(distM, mid) > vd) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Trainingstempo's volgens Daniels (sec/km)
export function trainingPaces(vd) {
  const paceFor = pct => {
    // zoek snelheid v (m/min) waarbij VO2 = pct * vdot
    const target = vd * pct;
    const a = 0.000104, b = 0.182258, c = -4.6 - target;
    const v = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
    return 60000 / v;
  };
  return {
    easy: [paceFor(0.65), paceFor(0.74)],
    marathon: paceFor(0.8),
    threshold: paceFor(0.88),
    interval: paceFor(0.98),
    rep: paceFor(1.05),
  };
}

// Beste VDOT uit recente prestaties (laatste 90 dagen)
export function currentVdot(acts) {
  const since = Date.now() - 90 * 86400000;
  let best = 0, src = null;
  for (const a of acts) {
    if (a.start < since || !a.efforts) continue;
    for (const [d, e] of Object.entries(a.efforts)) {
      if (+d < 1500) continue;
      const v = vdot(+d, e.time);
      if (v > best && v < 90) { best = v; src = { act: a, dist: +d }; }
    }
  }
  return { vdot: best, src };
}

// --- Vergelijkbare runs (zelfde start/eind en afstand) ---
export function matchedRuns(act, acts) {
  const p = act.points;
  if (!p?.length) return [];
  const s = p[0], e = p[p.length - 1], dist = act.stats.distance;
  return acts.filter(o => {
    if (!o.points?.length || !o.stats) return false;
    const os = o.points[0], oe = o.points[o.points.length - 1];
    return Math.abs(o.stats.distance - dist) / dist < 0.06
      && haversine(s, os) < 150 && haversine(e, oe) < 150
      && routeOverlap(p, o.points) > 0.8;
  }).sort((a, b) => a.start - b.start);
}

function routeOverlap(a, b) {
  const sample = a.filter((_, i) => i % Math.max(1, Math.floor(a.length / 30)) === 0);
  const bs = b.filter((_, i) => i % 3 === 0);
  let hit = 0;
  for (const p of sample) if (bs.some(q => haversine(p, q) < 60)) hit++;
  return hit / sample.length;
}

// --- Persoonlijke segmenten ---
export function segmentEffort(seg, act) {
  const pts = act.points;
  if (!pts?.length) return null;
  const R = 30;
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    if (haversine(pts[i], seg.start) > R) continue;
    // zoek eerstvolgend eindpunt binnen redelijke afstand
    for (let j = i + 1; j < pts.length; j++) {
      const dd = pts[j].d - pts[i].d;
      if (dd > seg.distance * 1.25) break;
      if (dd > seg.distance * 0.8 && haversine(pts[j], seg.end) < R) {
        const time = pts[j].m - pts[i].m;
        if (time > 0 && (!best || time < best.time)) best = { time, actId: act.id, start: act.start, i, j };
        break;
      }
    }
    // spring vooruit om dubbele matches te beperken
  }
  return best;
}

// Weektotalen
export function weeklyTotals(acts, weeks = 12) {
  const DAY = 86400000;
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  const thisWeek = startOfDay(now.getTime() - day * DAY);
  const out = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const from = thisWeek - w * 7 * DAY, to = from + 7 * DAY;
    const list = acts.filter(a => a.start >= from && a.start < to);
    out.push({
      from, count: list.length,
      dist: list.reduce((s, a) => s + (a.stats?.distance || 0), 0),
      time: list.reduce((s, a) => s + (a.stats?.movingTime || 0), 0),
      elev: list.reduce((s, a) => s + (a.stats?.elevGain || 0), 0),
      load: list.reduce((s, a) => s + (a.stats?.load || 0), 0),
    });
  }
  return out;
}

export function streakWeeks(acts) {
  const DAY = 86400000;
  const weeks = new Set(acts.map(a => {
    const d = new Date(a.start); const day = (d.getDay() + 6) % 7;
    return startOfDay(a.start - day * DAY);
  }));
  const now = new Date(); const day = (now.getDay() + 6) % 7;
  let w = startOfDay(now.getTime() - day * DAY);
  let n = 0;
  if (!weeks.has(w)) w -= 7 * DAY; // huidige week telt nog niet mee als leeg
  while (weeks.has(w)) { n++; w = startOfDay(w - 7 * DAY + 3600000 * 2); }
  return n;
}

// Alles in één keer bijwerken na opnemen/importeren
export function finalize(act, s = settings()) {
  computeStats(act, s);
  act.efforts = bestEfforts(act.points || []);
  return act;
}
