// Opname-engine: GPS filtering, bewegende tijd, auto-pauze, rondes, workouts, ghost
import { haversine, uid, runTitle, vibrate } from './utils.js';
import { heartRate, cadence, speak, sayDuration, sayPace, beep } from './sensors.js';
import { interpAt } from './stats.js';
import { KIND_LABEL } from './workouts.js';
import { saveLive } from './db.js';

class Kalman {
  constructor(q = 3) { this.q = q; this.v = -1; }
  process(lat, lon, acc, ts) {
    acc = Math.max(acc, 1);
    if (this.v < 0) { this.ts = ts; this.lat = lat; this.lon = lon; this.v = acc * acc; }
    else {
      const dt = (ts - this.ts) / 1000;
      if (dt > 0) { this.v += dt * this.q * this.q; this.ts = ts; }
      const k = this.v / (this.v + acc * acc);
      this.lat += k * (lat - this.lat);
      this.lon += k * (lon - this.lon);
      this.v = (1 - k) * this.v;
    }
    return { lat: this.lat, lon: this.lon };
  }
}

export class Recorder {
  constructor({ settings, workout = null, ghost = null, route = null, restore = null }) {
    this.s = settings;
    this.workout = workout;
    this.ghost = ghost;
    this.route = route;
    this.listeners = new Set();
    this.state = 'ready';
    this.points = [];
    this.laps = [];
    this.distance = 0;
    this._mt = 0; // bewegende tijd tot laatste statuswijziging
    this._runSince = 0;
    this.startTs = 0;
    this.fix = null; // laatste ruwe GPS fix
    this.recent = []; // recente gefilterde posities voor snelheid
    this.kalman = new Kalman(3);
    this.lastMovingPos = null;
    this.ele = null; this.elevGain = 0; this._eleRef = null;
    this.lapStart = { idx: 0, d: 0, m: 0 };
    this.nextVoiceKm = settings.voiceIntervalKm || 1;
    this.slowSince = 0;
    this.stepIdx = 0; this.stepStart = { d: 0, m: 0 }; this.lastGuide = 0;
    this.id = uid();
    if (restore) Object.assign(this, restore, { kalman: new Kalman(3), listeners: this.listeners });
    this.watchGPS();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data) { this.listeners.forEach(fn => fn(type, data)); }

  get moving() {
    return this._mt + (this.state === 'running' ? (performance.now() - this._runSince) / 1000 : 0);
  }
  get elapsed() { return this.startTs ? (Date.now() - this.startTs) / 1000 : 0; }

  watchGPS() {
    if (!navigator.geolocation) { this.emit('gps-error', 'Geen GPS beschikbaar'); return; }
    this.watchId = navigator.geolocation.watchPosition(
      pos => this.onPosition(pos),
      err => this.emit('gps-error', err.message),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
  }

  start() {
    this.startTs = Date.now();
    this.state = 'running';
    this._runSince = performance.now();
    this.timer = setInterval(() => this.tick(), 1000);
    if (this.workout) this.announceStep();
    this.emit('state', this.state);
  }

  pause(auto = false) {
    if (this.state !== 'running') return;
    this._mt = this.moving;
    this.state = auto ? 'autopaused' : 'paused';
    if (auto) { beep(500, 120, 2); speak('Automatisch gepauzeerd', this.s.voice); } else speak('Gepauzeerd', this.s.voice);
    this.emit('state', this.state);
  }

  resume(auto = false) {
    if (this.state !== 'paused' && this.state !== 'autopaused') return;
    this.state = 'running';
    this._runSince = performance.now();
    this.slowSince = 0;
    if (!this.timer) this.timer = setInterval(() => this.tick(), 1000);
    if (!auto) this.lastMovingPos = null; // handmatige pauze: gat niet meetellen
    if (auto) beep(900, 120, 1);
    speak('Hervat', this.s.voice);
    this.emit('state', this.state);
  }

  onPosition(pos) {
    const { latitude: lat, longitude: lon, accuracy, altitude, speed } = pos.coords;
    const t = Date.now(); // eigen klok: consistent met tick() en bewegende tijd
    this.fix = { lat, lon, accuracy, altitude, speed, t };
    this.emit('fix', this.fix);
    if (this.state === 'ready' || this.state === 'done') return;
    if (accuracy > this.s.gpsAccuracyMax) return;

    const f = this.kalman.process(lat, lon, accuracy, t);
    const p = { lat: f.lat, lon: f.lon, t };
    // Spike filter: onrealistische snelheid
    const prev = this.recent[this.recent.length - 1];
    if (prev) {
      const dt = (t - prev.t) / 1000;
      if (dt <= 0) return;
      if (haversine(prev, p) / dt > 12) return;
    }
    this.recent.push(p);
    while (this.recent.length && t - this.recent[0].t > 20000) this.recent.shift();

    // Hoogte (gladgestreken) en stijging met hysterese
    if (altitude != null && isFinite(altitude)) {
      this.ele = this.ele == null ? altitude : this.ele * 0.8 + altitude * 0.2;
      if (this._eleRef == null) this._eleRef = this.ele;
      const diff = this.ele - this._eleRef;
      if (diff >= 3) { if (this.state === 'running') this.elevGain += diff; this._eleRef = this.ele; }
      else if (diff <= -3) this._eleRef = this.ele;
    }

    this.checkAutoPause(t);

    if (this.state === 'running') {
      if (this.lastMovingPos) {
        const d = haversine(this.lastMovingPos, p);
        // kleine jitter negeren
        if (d >= Math.min(3, accuracy * 0.25) || t - this.lastMovingPos.t > 5000) {
          this.addDistance(d);
          this.lastMovingPos = p;
        }
      } else this.lastMovingPos = p;
      this.addPoint(p);
      this.afterProgress();
    }
    this.emit('update');
  }

  checkAutoPause(t) {
    if (!this.s.autoPause) return;
    const sp = this.windowSpeed(8000);
    if (sp == null) return;
    if (this.state === 'running') {
      if (sp < 0.55) {
        this.slowSince = this.slowSince || t;
        if (t - this.slowSince > 6000) this.pause(true);
      } else this.slowSince = 0;
    } else if (this.state === 'autopaused') {
      const fast = this.windowSpeed(4000);
      if (fast != null && fast > 1.2) this.resume(true);
    }
  }

  windowSpeed(ms) {
    const r = this.recent;
    if (r.length < 2) return null;
    const last = r[r.length - 1];
    let i = r.length - 1;
    while (i > 0 && last.t - r[i - 1].t <= ms) i--;
    const first = r[i];
    const dt = (last.t - first.t) / 1000;
    if (dt < ms / 2000) return null;
    let d = 0;
    for (let k = i + 1; k < r.length; k++) d += haversine(r[k - 1], r[k]);
    return d / dt;
  }

  // Huidig tempo uit punten van de laatste ~20 s bewegende tijd
  currentPace() {
    if (this.state !== 'running') return null;
    const pts = this.points;
    if (pts.length < 2) return null;
    const last = pts[pts.length - 1];
    let i = pts.length - 1;
    while (i > 0 && last.m - pts[i - 1].m <= 20) i--;
    const dm = last.m - pts[i].m, dd = last.d - pts[i].d;
    if (dm < 5 || dd < 5) return null;
    return dm / (dd / 1000);
  }

  avgPace() { return this.distance > 20 ? this.moving / (this.distance / 1000) : null; }

  lapStats() {
    const d = this.distance - this.lapStart.d;
    const m = this.moving - this.lapStart.m;
    return { d, m, pace: d > 20 ? m / (d / 1000) : null };
  }

  addPoint(p) {
    this.points.push({
      t: p.t, lat: p.lat ?? null, lon: p.lon ?? null,
      ele: this.ele != null ? Math.round(this.ele * 10) / 10 : null,
      hr: heartRate.current() || 0,
      cad: cadence.active ? cadence.spm() : 0,
      d: Math.round(this.distance * 10) / 10,
      m: Math.round(this.moving * 10) / 10,
    });
  }

  addDistance(d) {
    const before = this.distance;
    this.distance += d;
    // Auto-ronde
    const lapLen = (this.s.autoLapKm || 0) * 1000;
    if (lapLen && Math.floor(this.distance / lapLen) > Math.floor(before / lapLen) && !this.workout) this.lap(true);
    // Stemcoach
    const vk = (this.s.voiceIntervalKm || 1) * 1000;
    if (this.distance >= this.nextVoiceKm * 1000) {
      this.nextVoiceKm += vk / 1000;
      this.announceKm();
    }
  }

  tick() {
    if (this.state === 'running') {
      // HR/cadans blijven vastleggen ook zonder nieuwe GPS fix (bijv. tunnel)
      const last = this.points[this.points.length - 1];
      if (!last || Date.now() - last.t > 4000) {
        const ref = this.lastMovingPos;
        this.addPoint({ t: Date.now(), lat: ref?.lat, lon: ref?.lon });
      }
      this.afterProgress();
    }
    if (this.startTs && Math.floor(this.elapsed) % 10 === 0) this.persist();
    this.emit('tick');
  }

  afterProgress() {
    if (this.workout) this.workoutStep();
  }

  lap(auto = false) {
    const { d, m } = this.lapStats();
    if (d < 10 && !auto) return;
    const idx = this.points.length - 1;
    const slice = this.points.slice(this.lapStart.idx, idx + 1);
    const hrs = slice.filter(p => p.hr).map(p => p.hr);
    const lap = {
      n: this.laps.length + 1, startIdx: this.lapStart.idx, endIdx: Math.max(idx, this.lapStart.idx),
      dist: d, time: m, pace: d > 0 ? m / (d / 1000) : 0,
      hr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : 0,
      auto,
    };
    this.laps.push(lap);
    this.lapStart = { idx: Math.max(idx, 0), d: this.distance, m: this.moving };
    vibrate([80, 60, 80]);
    if (!auto) { beep(1000, 100, 2); speak(`Ronde ${lap.n}. ${sayDuration(lap.time)}. Tempo ${sayPace(lap.pace)}`, this.s.voice); }
    this.emit('lap', lap);
  }

  announceKm() {
    const km = Math.round(this.distance / 100) / 10;
    const parts = [`${String(km).replace('.', ' komma ')} kilometer`, `tijd ${sayDuration(this.moving)}`, `gemiddeld tempo ${sayPace(this.avgPace())}`];
    const lp = this.lapStats();
    if (this.laps.length) { const last = this.laps[this.laps.length - 1]; parts.push(`laatste ronde ${sayPace(last.pace)}`); }
    else if (lp.pace) parts.push(`huidig ${sayPace(this.currentPace() || lp.pace)}`);
    const hr = heartRate.current();
    if (hr && this.s.voiceHr) parts.push(`hartslag ${hr}`);
    if (this.ghost) {
      const g = this.ghostDelta();
      if (g != null) parts.push(g < 0 ? `${Math.round(-g)} seconden voor op je ghost` : `${Math.round(g)} seconden achter op je ghost`);
    }
    beep(880, 120, 1);
    speak(parts.join('. '), this.s.voice);
  }

  // --- Workout ---
  get step() { return this.workout?.steps[this.stepIdx] || null; }

  stepProgress() {
    const st = this.step;
    if (!st) return null;
    const done = st.dur.type === 'time' ? this.moving - this.stepStart.m : this.distance - this.stepStart.d;
    return { done, total: st.dur.value, remaining: Math.max(0, st.dur.value - done), frac: Math.min(1, done / st.dur.value) };
  }

  workoutStep() {
    const st = this.step;
    if (!st) return;
    const pr = this.stepProgress();
    if (st.dur.type === 'time' && pr.remaining <= 3 && pr.remaining > 0 && !this._cd) { this._cd = true; beep(660, 100, 3); }
    if (pr.done >= st.dur.value) {
      // ronde afsluiten per stap
      this.lap(true);
      this._cd = false;
      this.stepIdx++;
      this.stepStart = { d: this.distance, m: this.moving };
      if (this.step) this.announceStep();
      else { beep(1200, 300, 2); speak('Workout voltooid. Goed gedaan! Je kunt rustig uitlopen of stoppen.', this.s.voice); this.emit('workout-done'); }
      this.emit('step', this.step);
      return;
    }
    // Tempo begeleiding elke 30 s
    if (st.pace && this.state === 'running' && this.moving - this.lastGuide > 30 && pr.done > (st.dur.type === 'time' ? 20 : 100)) {
      const cp = this.currentPace();
      if (cp) {
        this.lastGuide = this.moving;
        if (cp < st.pace[0] - 5) { speak('Iets rustiger', this.s.voice); beep(400, 200, 1); }
        else if (cp > st.pace[1] + 5) { speak('Versnellen', this.s.voice); beep(1100, 120, 2); }
      }
    }
  }

  announceStep() {
    const st = this.step;
    if (!st) return;
    const amount = st.dur.type === 'time' ? sayDuration(st.dur.value) : `${st.dur.value >= 1000 ? `${String(st.dur.value / 1000).replace('.', ' komma ')} kilometer` : `${st.dur.value} meter`}`;
    const what = st.label || KIND_LABEL[st.kind];
    const pace = st.pace ? `, tempo tussen ${sayPace(st.pace[0])} en ${sayPace(st.pace[1])}` : '';
    vibrate([200, 100, 200]);
    beep(st.kind === 'run' ? 1200 : 700, 200, 2);
    speak(`${what}${st.rep ? ` ${st.rep.replace('/', ' van ')}` : ''}. ${amount}${pace}`, this.s.voice);
    this.lastGuide = this.moving;
  }

  // --- Ghost: negatief = voor ---
  ghostDelta() {
    if (!this.ghost?.points?.length || this.distance < 50) return null;
    const gm = interpAt(this.ghost.points, this.distance, 'm');
    return gm == null ? null : this.moving - gm;
  }

  // --- Route volgen ---
  routeProgress() {
    const r = this.route;
    if (!r || !this.lastMovingPos) return null;
    let best = Infinity, bi = 0;
    for (let i = 0; i < r.path.length; i++) {
      const d = haversine(this.lastMovingPos, r.path[i]);
      if (d < best) { best = d; bi = i; }
    }
    return { off: best, remaining: r.distance - (r.cum?.[bi] || 0) };
  }

  persist() {
    if (this.state === 'done' || this.state === 'ready') return;
    saveLive({
      id: this.id, startTs: this.startTs, points: this.points, laps: this.laps, distance: this.distance,
      _mt: this.moving, elevGain: this.elevGain, workout: this.workout, stepIdx: this.stepIdx, stepStart: this.stepStart,
      lapStart: this.lapStart, nextVoiceKm: this.nextVoiceKm,
    });
  }

  finish() {
    if (this.state === 'running' || this.state === 'paused' || this.state === 'autopaused') {
      // slotpunt zodat afstand en tijd exact kloppen
      const ref = this.lastMovingPos || this.points[this.points.length - 1];
      this.addPoint({ t: Date.now(), lat: ref?.lat, lon: ref?.lon });
    }
    this._mt = this.moving;
    this.state = 'done';
    clearInterval(this.timer);
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    // laatste ronde afsluiten
    if (this.lapStats().d > 50 && this.laps.length) this.lap(true);
    const pts = this.points;
    return {
      id: this.id, type: 'Run', source: 'tempo',
      name: runTitle(this.startTs), description: '',
      start: this.startTs, end: Date.now(),
      points: pts, laps: this.laps,
      workout: this.workout ? { name: this.workout.name } : null,
      ghostOf: this.ghost?.id || null,
      rpe: null,
    };
  }

  destroy() {
    clearInterval(this.timer);
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.listeners.clear();
  }
}
