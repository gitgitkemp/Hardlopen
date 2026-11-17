// Sensoren: hartslagband (Bluetooth), cadans (bewegingssensor), stem, wake lock

// --- Hartslag via Web Bluetooth (Chrome op Android/desktop) ---
export const heartRate = {
  device: null,
  bpm: 0,
  lastAt: 0,
  listeners: new Set(),
  get supported() { return !!navigator.bluetooth; },
  get connected() { return !!this.device?.gatt?.connected; },
  async connect() {
    if (!navigator.bluetooth) throw new Error('Bluetooth wordt niet ondersteund in deze browser (gebruik Chrome op Android)');
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }], optionalServices: ['battery_service'] });
    this.device = device;
    device.addEventListener('gattserverdisconnected', () => this._reconnect());
    await this._subscribe();
    return device.name;
  },
  async _subscribe() {
    const server = await this.device.gatt.connect();
    const svc = await server.getPrimaryService('heart_rate');
    const ch = await svc.getCharacteristic('heart_rate_measurement');
    ch.addEventListener('characteristicvaluechanged', e => {
      const v = e.target.value;
      const flags = v.getUint8(0);
      this.bpm = flags & 1 ? v.getUint16(1, true) : v.getUint8(1);
      this.lastAt = Date.now();
      this.listeners.forEach(fn => fn(this.bpm));
    });
    await ch.startNotifications();
  },
  async _reconnect() {
    for (let i = 0; i < 5 && this.device; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try { await this._subscribe(); return; } catch { /* opnieuw */ }
    }
  },
  current() { return Date.now() - this.lastAt < 5000 ? this.bpm : 0; },
  disconnect() { const d = this.device; this.device = null; d?.gatt?.disconnect(); this.bpm = 0; },
};

// --- Cadans (stappen per minuut) via versnellingsmeter ---
export const cadence = {
  active: false,
  steps: [],
  _last: 0, _above: false, _avg: 9.81,
  async start() {
    if (typeof DeviceMotionEvent === 'undefined') return false;
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      try { if (await DeviceMotionEvent.requestPermission() !== 'granted') return false; } catch { return false; }
    }
    this.active = true;
    this.steps = [];
    this._handler = e => this._onMotion(e);
    window.addEventListener('devicemotion', this._handler);
    return true;
  },
  stop() {
    this.active = false;
    if (this._handler) window.removeEventListener('devicemotion', this._handler);
  },
  _onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    const mag = Math.hypot(a.x, a.y, a.z);
    this._avg = this._avg * 0.98 + mag * 0.02;
    const now = performance.now();
    const thr = this._avg + 2.2;
    if (!this._above && mag > thr && now - this._last > 250) {
      this._above = true;
      this._last = now;
      this.steps.push(now);
      if (this.steps.length > 60) this.steps.shift();
    } else if (this._above && mag < this._avg) {
      this._above = false;
    }
  },
  spm() {
    const now = performance.now();
    const recent = this.steps.filter(t => now - t < 10000);
    if (recent.length < 6) return 0;
    const span = (recent[recent.length - 1] - recent[0]) / 1000;
    const v = span > 0 ? Math.round((recent.length - 1) / span * 60) : 0;
    return v >= 100 && v <= 240 ? v : 0;
  },
};

// --- Stemcoach (Nederlands) ---
let voiceNL = null;
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  voiceNL = voices.find(v => v.lang?.toLowerCase().startsWith('nl')) || null;
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}
export function speak(text, enabled = true) {
  if (!enabled || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'nl-NL';
  if (voiceNL) u.voice = voiceNL;
  u.rate = 1.02;
  speechSynthesis.speak(u);
}
export function primeSpeech() {
  // iOS vereist een spraakactie vanuit een tik
  if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); }
}

export function sayDuration(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  const parts = [];
  if (h) parts.push(`${h} uur`);
  if (m) parts.push(`${m} ${m === 1 ? 'minuut' : 'minuten'}`);
  if (s || !parts.length) parts.push(`${s} seconden`);
  return parts.join(' ');
}
export function sayPace(secPerKm) {
  if (!isFinite(secPerKm) || secPerKm <= 0) return 'onbekend';
  const m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60);
  return `${m} ${m === 1 ? 'minuut' : 'minuten'}${s ? ` ${s}` : ''} per kilometer`;
}

// --- Piepjes ---
let actx;
export function beep(freq = 880, ms = 160, times = 1) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = freq;
      o.connect(g); g.connect(actx.destination);
      const t0 = actx.currentTime + i * (ms / 1000 + 0.08);
      g.gain.setValueAtTime(0.25, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + ms / 1000);
      o.start(t0); o.stop(t0 + ms / 1000 + 0.02);
    }
  } catch { /* geen audio */ }
}

// --- Scherm aan houden ---
let lock = null;
export async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) {
      lock = await navigator.wakeLock.request('screen');
      document.addEventListener('visibilitychange', reacquire);
    } else if (!on) {
      document.removeEventListener('visibilitychange', reacquire);
      await lock?.release();
      lock = null;
    }
  } catch { /* niet toegestaan */ }
}
async function reacquire() {
  if (document.visibilityState === 'visible' && lock !== null) {
    try { lock = await navigator.wakeLock.request('screen'); } catch { /* */ }
  }
}
