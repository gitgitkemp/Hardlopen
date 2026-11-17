// Export/import: GPX en TCX (beide door Strava geaccepteerd)
import { esc, uid } from './utils.js';
import { deriveTrack, finalize } from './stats.js';

const iso = t => new Date(t).toISOString();

export function toGPX(act) {
  const pts = act.points.filter(p => p.lat != null);
  const trkpts = pts.map(p => {
    const ext = (p.hr || p.cad)
      ? `<extensions><gpxtpx:TrackPointExtension>${p.hr ? `<gpxtpx:hr>${Math.round(p.hr)}</gpxtpx:hr>` : ''}${p.cad ? `<gpxtpx:cad>${Math.round(p.cad / 2)}</gpxtpx:cad>` : ''}</gpxtpx:TrackPointExtension></extensions>`
      : '';
    return `<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">${p.ele != null ? `<ele>${p.ele.toFixed(1)}</ele>` : ''}<time>${iso(p.t)}</time>${ext}</trkpt>`;
  }).join('\n      ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Tempo Run" xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata><name>${esc(act.name)}</name><time>${iso(act.start)}</time></metadata>
  <trk>
    <name>${esc(act.name)}</name>
    <type>running</type>
    <trkseg>
      ${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

export function toTCX(act) {
  const laps = (act.laps?.length ? act.laps : [{ startIdx: 0, endIdx: act.points.length - 1 }]);
  const lapXml = laps.map(l => {
    const pts = act.points.slice(l.startIdx, l.endIdx + 1);
    if (!pts.length) return '';
    const a = pts[0], b = pts[pts.length - 1];
    const hrs = pts.filter(p => p.hr);
    const avgHr = hrs.length ? Math.round(hrs.reduce((s, p) => s + p.hr, 0) / hrs.length) : 0;
    const maxHr = hrs.length ? Math.max(...hrs.map(p => p.hr)) : 0;
    const tps = pts.map(p => `
          <Trackpoint>
            <Time>${iso(p.t)}</Time>${p.lat != null ? `
            <Position><LatitudeDegrees>${p.lat.toFixed(7)}</LatitudeDegrees><LongitudeDegrees>${p.lon.toFixed(7)}</LongitudeDegrees></Position>` : ''}${p.ele != null ? `
            <AltitudeMeters>${p.ele.toFixed(1)}</AltitudeMeters>` : ''}
            <DistanceMeters>${p.d.toFixed(1)}</DistanceMeters>${p.hr ? `
            <HeartRateBpm><Value>${Math.round(p.hr)}</Value></HeartRateBpm>` : ''}${p.cad ? `
            <Extensions><ns3:TPX><ns3:RunCadence>${Math.round(p.cad / 2)}</ns3:RunCadence></ns3:TPX></Extensions>` : ''}
          </Trackpoint>`).join('');
    return `
      <Lap StartTime="${iso(a.t)}">
        <TotalTimeSeconds>${(b.m - a.m).toFixed(1)}</TotalTimeSeconds>
        <DistanceMeters>${(b.d - a.d).toFixed(1)}</DistanceMeters>
        <Calories>0</Calories>${avgHr ? `
        <AverageHeartRateBpm><Value>${avgHr}</Value></AverageHeartRateBpm>
        <MaximumHeartRateBpm><Value>${maxHr}</Value></MaximumHeartRateBpm>` : ''}
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>${tps}
        </Track>
      </Lap>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
  <Activities>
    <Activity Sport="Running">
      <Id>${iso(act.start)}</Id>${lapXml}
      <Notes>${esc(act.description || '')}</Notes>
      <Creator xsi:type="Device_t" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Name>Tempo Run</Name></Creator>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;
}

// Route (zonder tijd) naar GPX
export function routeToGPX(route) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Tempo Run" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(route.name)}</name></metadata>
  <rte><name>${esc(route.name)}</name>
    ${route.path.map(p => `<rtept lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">${p.ele != null ? `<ele>${p.ele.toFixed(1)}</ele>` : ''}</rtept>`).join('\n    ')}
  </rte>
</gpx>`;
}

const txt = (el, sel) => {
  const n = el.getElementsByTagName(sel)[0];
  return n ? n.textContent.trim() : null;
};
// Zoek op lokale naam ongeacht namespace prefix
const byLocal = (el, name) => [...el.getElementsByTagName('*')].filter(n => n.localName === name);
const localTxt = (el, name) => { const n = byLocal(el, name)[0]; return n ? n.textContent.trim() : null; };

export function parseFile(text, filename = '') {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Bestand kan niet gelezen worden');
  const root = doc.documentElement.localName;
  if (root === 'gpx') return parseGPX(doc, filename);
  if (root === 'TrainingCenterDatabase') return parseTCX(doc, filename);
  throw new Error('Onbekend formaat (alleen GPX en TCX)');
}

function parseGPX(doc, filename) {
  const trkpts = byLocal(doc, 'trkpt');
  const rtepts = trkpts.length ? [] : byLocal(doc, 'rtept');
  const name = txt(doc, 'name') || filename.replace(/\.\w+$/, '');
  if (!trkpts.length && rtepts.length) {
    // Route zonder tijden
    return {
      kind: 'route', name,
      path: rtepts.map(p => ({ lat: +p.getAttribute('lat'), lon: +p.getAttribute('lon'), ele: txt(p, 'ele') != null ? +txt(p, 'ele') : null })),
    };
  }
  const points = trkpts.map(p => {
    const time = txt(p, 'time');
    const hr = localTxt(p, 'hr');
    const cad = localTxt(p, 'cad');
    return {
      t: time ? Date.parse(time) : null,
      lat: +p.getAttribute('lat'), lon: +p.getAttribute('lon'),
      ele: txt(p, 'ele') != null ? +txt(p, 'ele') : null,
      hr: hr ? +hr : 0,
      cad: cad ? +cad * 2 : 0,
      _recalc: true,
    };
  });
  if (!points.length) throw new Error('Geen trackpunten gevonden');
  if (points.some(p => !p.t)) {
    // GPX zonder tijden: behandel als route
    return { kind: 'route', name, path: points.map(({ lat, lon, ele }) => ({ lat, lon, ele })) };
  }
  return makeActivity(points, name, 'gpx');
}

function parseTCX(doc, filename) {
  const tps = byLocal(doc, 'Trackpoint');
  const points = tps.map(tp => {
    const lat = localTxt(tp, 'LatitudeDegrees'), lon = localTxt(tp, 'LongitudeDegrees');
    const hrEl = byLocal(tp, 'HeartRateBpm')[0];
    const cad = localTxt(tp, 'RunCadence') || localTxt(tp, 'Cadence');
    const dist = localTxt(tp, 'DistanceMeters');
    return {
      t: Date.parse(localTxt(tp, 'Time')),
      lat: lat != null ? +lat : null, lon: lon != null ? +lon : null,
      ele: localTxt(tp, 'AltitudeMeters') != null ? +localTxt(tp, 'AltitudeMeters') : null,
      hr: hrEl ? +localTxt(hrEl, 'Value') : 0,
      cad: cad ? +cad * 2 : 0,
      d: dist != null ? +dist : null,
      _recalc: dist == null,
    };
  }).filter(p => p.t);
  if (!points.length) throw new Error('Geen trackpunten gevonden');
  const notes = localTxt(doc, 'Notes');
  const act = makeActivity(points, filename.replace(/\.\w+$/, '') || 'Geïmporteerde run', 'tcx');
  if (notes) act.description = notes;
  return act;
}

export function makeActivity(points, name, source) {
  points.sort((a, b) => a.t - b.t);
  // Vul ontbrekende posities voor d-berekening; afstand uit bestand heeft voorrang
  deriveTrack(points);
  const act = {
    kind: 'activity',
    id: uid(), type: 'Run', source,
    name: name || 'Run', description: '',
    start: points[0].t, end: points[points.length - 1].t,
    points, laps: [], rpe: null,
  };
  return finalize(act);
}
