// Service worker: app shell offline + kaarttegels cachen
const VERSION = 'tempo-v2';
const SHELL = [
  './', 'index.html', 'css/tempo.css', 'manifest.webmanifest', 'icons/icon.svg',
  'js/app.js', 'js/utils.js', 'js/db.js', 'js/settings.js', 'js/stats.js', 'js/gpx.js', 'js/strava.js',
  'js/sensors.js', 'js/workouts.js', 'js/recorder.js', 'js/charts.js', 'js/map.js', 'js/router.js',
  'js/views/record.js', 'js/views/feed.js', 'js/views/io.js', 'js/views/activity.js',
  'js/views/training.js', 'js/views/routes.js', 'js/views/profile.js',
  'vendor/leaflet/leaflet.css',
  'vendor/leaflet/leaflet.js',
  'vendor/fonts/plex-mono-400.woff2', 'vendor/fonts/plex-mono-500.woff2', 'vendor/fonts/plex-mono-600.woff2',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'tiles').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // API's nooit cachen
  if (/strava\.com|open-meteo|routing\.openstreetmap/.test(url.host)) return;
  // Kaarttegels: cache first, max ~2000
  if (/basemaps\.cartocdn|tile\.openstreetmap|arcgisonline/.test(url.host)) {
    e.respondWith(caches.open('tiles').then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      try {
        const res = await fetch(e.request);
        if (res.ok || res.type === 'opaque') {
          c.put(e.request, res.clone());
          c.keys().then(k => { if (k.length > 2000) k.slice(0, 200).forEach(r => c.delete(r)); });
        }
        return res;
      } catch { return new Response('', { status: 504 }); }
    }));
    return;
  }
  // App shell: network first (altijd nieuwste versie), fallback cache
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok && (url.origin === location.origin || url.host === 'cdnjs.cloudflare.com')) {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
    }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
