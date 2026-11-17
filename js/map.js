// Leaflet kaart helpers
import { settings } from './settings.js';

const TILES = {
  dark: ['https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', '&copy; OpenStreetMap &copy; CARTO'],
  light: ['https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', '&copy; OpenStreetMap &copy; CARTO'],
  osm: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png', '&copy; OpenStreetMap'],
  satellite: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', '&copy; Esri'],
};

export function hasLeaflet() { return typeof window.L !== 'undefined'; }

export function createMap(el, { interactive = true, style } = {}) {
  if (!hasLeaflet()) { el.innerHTML = '<div class="chart-empty">Kaart niet beschikbaar (offline)</div>'; return null; }
  const map = L.map(el, {
    zoomControl: interactive, attributionControl: true,
    dragging: interactive, scrollWheelZoom: interactive, touchZoom: interactive, doubleClickZoom: interactive,
  });
  const [url, attr] = TILES[style || settings().mapStyle] || TILES.dark;
  L.tileLayer(url, { attribution: attr, maxZoom: 19, subdomains: 'abcd' }).addTo(map);
  map.setView([52.37, 4.89], 13);
  return map;
}

export function latlngs(points) {
  return points.filter(p => p.lat != null).map(p => [p.lat, p.lon]);
}

// Kleur van langzaam (blauw) naar snel (rood) via groen/geel
export function rampColor(f) {
  f = Math.max(0, Math.min(1, f));
  const stops = [[63, 167, 255], [61, 220, 132], [255, 210, 63], [255, 61, 90]];
  const pos = f * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(pos)), t = pos - i;
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * t));
  return `rgb(${c.join(',')})`;
}

// Gekleurde polylijn per segment op basis van een waarde per punt
export function coloredTrack(map, points, values, { invert = false } = {}) {
  const group = L.layerGroup().addTo(map);
  const vals = values.filter(v => v != null && isFinite(v)).sort((a, b) => a - b);
  if (!vals.length) {
    L.polyline(latlngs(points), { color: '#c6ff3d', weight: 4 }).addTo(group);
    return group;
  }
  const lo = vals[Math.floor(vals.length * 0.05)], hi = vals[Math.floor(vals.length * 0.95)];
  const step = Math.max(1, Math.floor(points.length / 600));
  let prev = null;
  for (let i = 0; i < points.length; i += step) {
    const p = points[i];
    if (p.lat == null) continue;
    if (prev) {
      const v = values[i];
      let f = v == null ? 0.5 : (v - lo) / (hi - lo || 1);
      if (invert) f = 1 - f;
      L.polyline([[prev.lat, prev.lon], [p.lat, p.lon]], { color: rampColor(f), weight: 5, opacity: 0.95 }).addTo(group);
    }
    prev = p;
  }
  return group;
}

export function startEndMarkers(map, points) {
  const pts = points.filter(p => p.lat != null);
  if (!pts.length) return;
  const mk = (p, cls) => L.marker([p.lat, p.lon], { icon: L.divIcon({ className: `pin ${cls}`, iconSize: [14, 14] }) }).addTo(map);
  mk(pts[0], 'pin-start');
  mk(pts[pts.length - 1], 'pin-end');
}

export function dotMarker(map, cls = 'pin-me') {
  return L.marker([0, 0], { icon: L.divIcon({ className: `pin ${cls}`, iconSize: [18, 18] }), interactive: false });
}

// Routeplanning via OSM voetganger-router; valt terug op rechte lijn
export async function routeBetween(a, b) {
  try {
    const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) throw new Error();
    const j = await res.json();
    const coords = j.routes?.[0]?.geometry?.coordinates;
    if (!coords?.length) throw new Error();
    return coords.map(([lon, lat]) => ({ lat, lon }));
  } catch {
    return [a, b];
  }
}

// Hoogtedata via Open-Meteo (max 100 punten per verzoek)
export async function fetchElevations(points) {
  const out = new Array(points.length).fill(null);
  for (let i = 0; i < points.length; i += 100) {
    const chunk = points.slice(i, i + 100);
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${chunk.map(p => p.lat.toFixed(5)).join(',')}&longitude=${chunk.map(p => p.lon.toFixed(5)).join(',')}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Hoogtedienst niet bereikbaar');
    const j = await res.json();
    j.elevation.forEach((e, k) => { out[i + k] = e; });
  }
  return out;
}
