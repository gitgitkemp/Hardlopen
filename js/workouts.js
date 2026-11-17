// Gestructureerde trainingen en trainingsschema's
import { uid } from './utils.js';

// stap: { kind: 'warmup'|'run'|'rest'|'cooldown', dur: {type:'time'|'dist', value}, pace?: [snel, langzaam] sec/km, label }
const T = (v) => ({ type: 'time', value: v });
const D = (v) => ({ type: 'dist', value: v });

function repeat(n, steps) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(...steps.map(s => ({ ...s, rep: `${i + 1}/${n}` })));
  return out;
}

// Presets met tempo als factor van drempeltempo (worden omgezet bij starten)
export function presets(tp) {
  const p = f => [Math.round(tp * f) - 8, Math.round(tp * f) + 8];
  return [
    {
      id: 'int-400', name: '8 × 400 m', desc: 'Snelheid: 400 m snel, 90 s wandel/dribbel',
      steps: [{ kind: 'warmup', dur: T(600) }, ...repeat(8, [{ kind: 'run', dur: D(400), pace: p(0.88) }, { kind: 'rest', dur: T(90) }]), { kind: 'cooldown', dur: T(600) }],
    },
    {
      id: 'int-1k', name: '5 × 1 km', desc: 'VO2max blokken met 2 min herstel',
      steps: [{ kind: 'warmup', dur: T(720) }, ...repeat(5, [{ kind: 'run', dur: D(1000), pace: p(0.94) }, { kind: 'rest', dur: T(120) }]), { kind: 'cooldown', dur: T(600) }],
    },
    {
      id: 'tempo-20', name: 'Tempo 20 min', desc: '20 minuten op drempeltempo',
      steps: [{ kind: 'warmup', dur: T(600) }, { kind: 'run', dur: T(1200), pace: p(1.0) }, { kind: 'cooldown', dur: T(600) }],
    },
    {
      id: 'pyramid', name: 'Piramide', desc: '1-2-3-2-1 min hard, gelijke rust',
      steps: [{ kind: 'warmup', dur: T(600) }, ...[60, 120, 180, 120, 60].flatMap((v, i) => [{ kind: 'run', dur: T(v), pace: p(0.92), rep: `${i + 1}/5` }, { kind: 'rest', dur: T(v) }]), { kind: 'cooldown', dur: T(600) }],
    },
    {
      id: 'fartlek', name: 'Fartlek 10 × 1/1', desc: '1 min vlot, 1 min rustig',
      steps: [{ kind: 'warmup', dur: T(600) }, ...repeat(10, [{ kind: 'run', dur: T(60), pace: p(0.95) }, { kind: 'rest', dur: T(60), pace: p(1.3) }]), { kind: 'cooldown', dur: T(300) }],
    },
    {
      id: 'progression', name: 'Progressieve duurloop', desc: '3 blokken van 10 min, steeds sneller',
      steps: [{ kind: 'run', dur: T(600), pace: p(1.25), label: 'Rustig' }, { kind: 'run', dur: T(600), pace: p(1.12), label: 'Gemiddeld' }, { kind: 'run', dur: T(600), pace: p(1.03), label: 'Vlot' }, { kind: 'cooldown', dur: T(300) }],
    },
  ];
}

export const KIND_LABEL = { warmup: 'Warming-up', run: 'Hard', rest: 'Herstel', cooldown: 'Cooling-down' };

export function workoutSummary(steps) {
  let time = 0, dist = 0;
  for (const s of steps) {
    if (s.dur.type === 'time') time += s.dur.value; else dist += s.dur.value;
  }
  return { time, dist };
}

// --- Trainingsschema generator ---
const GOALS = {
  5000: { name: '5 km', weeks: 8, longMax: 10000 },
  10000: { name: '10 km', weeks: 10, longMax: 16000 },
  21097.5: { name: 'Halve marathon', weeks: 12, longMax: 21000 },
  42195: { name: 'Marathon', weeks: 16, longMax: 32000 },
};
export const PLAN_GOALS = GOALS;

// paces: trainingPaces() resultaat
export function generatePlan({ goal, raceDate, daysPerWeek, currentWeeklyKm, paces }) {
  const g = GOALS[goal];
  const weeks = g.weeks;
  const race = new Date(raceDate); race.setHours(9, 0, 0, 0);
  const start = new Date(race); start.setDate(start.getDate() - weeks * 7 + 1);
  // terug naar maandag
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const baseKm = Math.max(currentWeeklyKm || 15, 10);
  const peakKm = Math.max(baseKm * 1.5, { 5000: 25, 10000: 35, 21097.5: 45, 42195: 65 }[goal]);
  const days = { 3: [1, 3, 6], 4: [1, 3, 5, 6], 5: [0, 1, 3, 4, 6], 6: [0, 1, 2, 3, 4, 6] }[daysPerWeek] || [1, 3, 6];
  const ez = Math.round((paces.easy[0] + paces.easy[1]) / 2);
  const range = v => [Math.round(v) - 8, Math.round(v) + 8];
  const sessions = [];
  for (let w = 0; w < weeks; w++) {
    const taper = w >= weeks - 2;
    const recovery = (w + 1) % 4 === 0;
    let km = baseKm + (peakKm - baseKm) * Math.min(1, w / (weeks - 3));
    if (recovery) km *= 0.75;
    if (taper) km *= w === weeks - 1 ? 0.45 : 0.7;
    const longRun = Math.min(g.longMax, km * 0.35 * 1000);
    const qualityType = ['interval', 'tempo', 'interval', 'tempo'][w % 4];
    const plan = [];
    plan.push({ type: 'long', title: `Lange duurloop ${(longRun / 1000).toFixed(0)} km`, dist: longRun, pace: range(ez + 10) });
    if (qualityType === 'interval') {
      const reps = Math.min(8, 4 + Math.floor(w / 3));
      plan.push({
        type: 'interval', title: `${reps} × 800 m interval`,
        steps: [{ kind: 'warmup', dur: T(600) }, ...repeat(reps, [{ kind: 'run', dur: D(800), pace: range(paces.interval) }, { kind: 'rest', dur: T(120) }]), { kind: 'cooldown', dur: T(600) }],
      });
    } else {
      const min = Math.min(30, 12 + w * 2);
      plan.push({
        type: 'tempo', title: `Tempoloop ${min} min`,
        steps: [{ kind: 'warmup', dur: T(600) }, { kind: 'run', dur: T(min * 60), pace: range(paces.threshold) }, { kind: 'cooldown', dur: T(600) }],
      });
    }
    const rest = Math.max(0, km * 1000 - longRun - 8000);
    const easyCount = days.length - 2;
    for (let i = 0; i < easyCount; i++) {
      const d = Math.max(4000, Math.round(rest / Math.max(1, easyCount) / 500) * 500);
      plan.push({ type: 'easy', title: `Rustige duurloop ${(d / 1000).toFixed(1).replace('.0', '')} km`, dist: d, pace: range(ez) });
    }
    // volgorde: easy, quality, easy, long op laatste dag
    const ordered = [plan[2], plan[1], ...plan.slice(3), plan[0]].filter(Boolean);
    days.forEach((dow, i) => {
      const s = ordered[i];
      if (!s) return;
      const date = new Date(start); date.setDate(date.getDate() + w * 7 + dow);
      sessions.push({ id: uid(), week: w + 1, date: date.getTime(), done: null, ...s });
    });
  }
  // Racedag
  sessions.push({ id: uid(), week: weeks, date: race.getTime(), type: 'race', title: `Wedstrijd: ${g.name}`, dist: +goal, done: null });
  // Sessies na de race weghalen
  return { id: uid(), goal: +goal, name: g.name, raceDate: race.getTime(), created: Date.now(), sessions: sessions.filter(s => s.date <= race.getTime()).sort((a, b) => a.date - b.date) };
}

// Zet een plan-sessie om naar een uitvoerbare workout
export function sessionToWorkout(s) {
  if (s.steps) return { name: s.title, steps: s.steps };
  if (s.dist) return { name: s.title, steps: [{ kind: 'run', dur: D(s.dist), pace: s.pace, label: s.title }] };
  return null;
}
