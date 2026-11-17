// IndexedDB opslag voor activiteiten, routes en segmenten
const DB_NAME = 'tempo-run';
const VERSION = 1;
const STORES = ['activities', 'routes', 'segments'];
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) {
          const os = db.createObjectStore(s, { keyPath: 'id' });
          if (s === 'activities') os.createIndex('start', 'start');
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const os = t.objectStore(store);
    const r = fn(os);
    t.oncomplete = () => resolve(r?.result ?? r);
    t.onerror = () => reject(t.error);
  });
}

export const db = {
  put: (store, obj) => tx(store, 'readwrite', os => os.put(obj)),
  get: (store, id) => tx(store, 'readonly', os => os.get(id)),
  del: (store, id) => tx(store, 'readwrite', os => os.delete(id)),
  all: (store) => tx(store, 'readonly', os => os.getAll()),
  clear: (store) => tx(store, 'readwrite', os => os.clear()),
};

// Cache van activiteiten (gesorteerd nieuw -> oud) zodat views snel renderen
let cache = null;
export async function activities() {
  if (!cache) {
    cache = await db.all('activities');
    cache.sort((a, b) => b.start - a.start);
  }
  return cache;
}
export async function saveActivity(a) {
  await db.put('activities', a);
  cache = null;
}
export async function deleteActivity(id) {
  await db.del('activities', id);
  cache = null;
}
export function invalidate() { cache = null; }

// Lopende run veiligstellen (crash / tab gesloten)
const LIVE_KEY = 'tempo.liveRecording';
export function saveLive(data) {
  try { localStorage.setItem(LIVE_KEY, JSON.stringify(data)); } catch { /* quota */ }
}
export function loadLive() {
  try { return JSON.parse(localStorage.getItem(LIVE_KEY)); } catch { return null; }
}
export function clearLive() { localStorage.removeItem(LIVE_KEY); }
