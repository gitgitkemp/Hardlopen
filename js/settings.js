// Gebruikersinstellingen (localStorage)
const KEY = 'tempo.settings';

const DEFAULTS = {
  name: 'Hardloper',
  weight: 70,
  birthYear: 2000,
  sex: 'm',
  maxHr: 195,
  restHr: 55,
  thresholdPace: 300, // sec/km, drempeltempo (~ 1 uur race tempo)
  autoPause: true,
  autoLapKm: 1,
  voice: true,
  voiceIntervalKm: 1,
  voiceHr: true,
  keepAwake: true,
  countdown: 3,
  gpsAccuracyMax: 35,
  mapStyle: 'dark',
  weeklyGoalKm: 25,
  yearGoalKm: 1000,
  shoes: [], // {id, name, startKm, limitKm, retired}
  defaultShoe: null,
  strava: { clientId: '', clientSecret: '', tokens: null, athlete: null, autoUpload: false },
  plan: null, // actief trainingsschema
};

let current = null;

export function settings() {
  if (!current) {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* leeg */ }
    current = { ...structuredClone(DEFAULTS), ...stored, strava: { ...DEFAULTS.strava, ...(stored.strava || {}) } };
  }
  return current;
}

export function saveSettings(patch = {}) {
  Object.assign(settings(), patch);
  localStorage.setItem(KEY, JSON.stringify(current));
  return current;
}

// Hartslagzones (Karvonen / %HRR), 5 zones zoals Strava
export function hrZones(s = settings()) {
  const { maxHr, restHr } = s;
  const hrr = maxHr - restHr;
  const pct = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  const names = ['Herstel', 'Duur', 'Tempo', 'Drempel', 'Anaeroob'];
  return names.map((name, i) => ({
    name, z: i + 1,
    min: Math.round(restHr + hrr * pct[i]),
    max: Math.round(restHr + hrr * pct[i + 1]),
  }));
}

export function hrZoneOf(hr, s = settings()) {
  if (!hr) return 0;
  const zones = hrZones(s);
  for (let i = zones.length - 1; i >= 0; i--) if (hr >= zones[i].min) return i + 1;
  return 1;
}

// Tempozones op basis van drempeltempo (sec/km). Hoger getal = langzamer.
export function paceZones(s = settings()) {
  const t = s.thresholdPace;
  const bounds = [Infinity, t * 1.29, t * 1.14, t * 1.06, t * 1.0, t * 0.97, 0];
  const names = ['Herstel', 'Duur', 'Tempo', 'Drempel', 'VO2max', 'Anaeroob'];
  return names.map((name, i) => ({ name, z: i + 1, slow: bounds[i], fast: bounds[i + 1] }));
}

export function paceZoneOf(pace, s = settings()) {
  if (!pace || !isFinite(pace)) return 0;
  const zones = paceZones(s);
  for (const z of zones) if (pace <= z.slow && pace > z.fast) return z.z;
  return 6;
}

export const ZONE_COLORS = ['#5b6b7c', '#3fa7ff', '#3ddc84', '#ffd23f', '#ff8a3d', '#ff3d5a', '#b93dff'];
