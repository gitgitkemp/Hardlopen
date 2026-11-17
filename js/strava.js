// Strava API: OAuth, uploaden en activiteiten importeren
import { settings, saveSettings } from './settings.js';
import { toTCX } from './gpx.js';
import { makeActivity } from './gpx.js';
import { finalize } from './stats.js';

const API = 'https://www.strava.com/api/v3';
const SCOPE = 'read,activity:read_all,activity:write';

export function redirectUri() {
  return location.origin + location.pathname;
}

export function isConnected() {
  return !!settings().strava.tokens?.refresh_token;
}

export function startAuth() {
  const { clientId } = settings().strava;
  if (!clientId) throw new Error('Vul eerst je Strava Client ID en Secret in');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    approval_prompt: 'auto',
    scope: SCOPE,
    state: 'tempo-strava',
  });
  location.href = `https://www.strava.com/oauth/authorize?${params}`;
}

// Aangeroepen bij opstarten: verwerkt ?code= na terugkeer van Strava
export async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  if (q.get('state') !== 'tempo-strava') return null;
  history.replaceState(null, '', location.pathname + '#/profiel');
  if (q.get('error')) throw new Error('Strava koppeling geweigerd');
  const code = q.get('code');
  const scope = q.get('scope') || '';
  if (!scope.includes('activity:write')) throw new Error('Geef toestemming voor "activiteiten uploaden" om te kunnen delen');
  const data = await tokenRequest({ code, grant_type: 'authorization_code' });
  return data.athlete;
}

async function tokenRequest(extra) {
  const { clientId, clientSecret } = settings().strava;
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, ...extra }),
  });
  if (!res.ok) throw new Error(`Strava token fout (${res.status})`);
  const data = await res.json();
  const st = settings().strava;
  saveSettings({
    strava: {
      ...st,
      tokens: { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at },
      athlete: data.athlete ? { id: data.athlete.id, name: `${data.athlete.firstname} ${data.athlete.lastname}`, avatar: data.athlete.profile_medium } : st.athlete,
    },
  });
  return data;
}

async function token() {
  const t = settings().strava.tokens;
  if (!t) throw new Error('Niet gekoppeld met Strava');
  if (t.expires_at * 1000 - Date.now() < 120000) {
    const data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
    return data.access_token;
  }
  return t.access_token;
}

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { Authorization: `Bearer ${await token()}`, ...(opts.headers || {}) },
  });
  if (res.status === 401) throw new Error('Strava sessie verlopen, koppel opnieuw');
  if (res.status === 429) throw new Error('Strava limiet bereikt, probeer het straks opnieuw');
  if (!res.ok) {
    let msg = res.status;
    try { msg = (await res.json()).message || msg; } catch { /* geen json */ }
    throw new Error(`Strava fout: ${msg}`);
  }
  return res.json();
}

export function disconnect() {
  const st = settings().strava;
  const t = st.tokens;
  if (t) fetch('https://www.strava.com/oauth/deauthorize', { method: 'POST', headers: { Authorization: `Bearer ${t.access_token}` } }).catch(() => {});
  saveSettings({ strava: { ...st, tokens: null, athlete: null } });
}

// Upload een activiteit, geeft Strava activity id terug
export async function upload(act, onStatus = () => {}) {
  const fd = new FormData();
  const tcx = toTCX(act);
  fd.append('file', new Blob([tcx], { type: 'application/xml' }), `${act.id}.tcx`);
  fd.append('data_type', 'tcx');
  fd.append('name', act.name);
  fd.append('description', [act.description, act.rpe ? `Inspanning: ${act.rpe}/10` : ''].filter(Boolean).join('\n\n'));
  fd.append('external_id', `tempo-${act.id}`);
  onStatus('Uploaden...');
  let up = await api('/uploads', { method: 'POST', body: fd });
  for (let i = 0; i < 30 && !up.activity_id && !up.error; i++) {
    onStatus('Strava verwerkt de run...');
    await new Promise(r => setTimeout(r, 2000));
    up = await api(`/uploads/${up.id_str || up.id}`);
  }
  if (up.error) {
    const dup = String(up.error).match(/duplicate of .*?(\d+)/i);
    if (dup) return +dup[1];
    throw new Error(up.error);
  }
  if (!up.activity_id) throw new Error('Strava heeft de upload nog niet verwerkt, check straks je Strava feed');
  // Sport type expliciet op Run zetten
  try {
    await api(`/activities/${up.activity_id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sport_type: 'Run', name: act.name }),
    });
  } catch { /* niet kritiek */ }
  return up.activity_id;
}

export async function listActivities(page = 1, perPage = 30) {
  const list = await api(`/athlete/activities?page=${page}&per_page=${perPage}`);
  return list.filter(a => /Run/.test(a.sport_type || a.type));
}

export async function importActivity(summary) {
  const streams = await api(`/activities/${summary.id}/streams?keys=time,latlng,altitude,heartrate,cadence,distance,moving&key_by_type=true`);
  const time = streams.time?.data || [];
  const start = Date.parse(summary.start_date);
  const points = time.map((t, i) => ({
    t: start + t * 1000,
    lat: streams.latlng?.data[i]?.[0] ?? null,
    lon: streams.latlng?.data[i]?.[1] ?? null,
    ele: streams.altitude?.data[i] ?? null,
    hr: streams.heartrate?.data[i] || 0,
    cad: streams.cadence?.data[i] ? streams.cadence.data[i] * 2 : 0,
    d: streams.distance?.data[i] ?? null,
    _recalc: !streams.distance,
  }));
  let act;
  if (points.length) {
    act = makeActivity(points, summary.name, 'strava');
  } else {
    // Handmatige of loopband activiteit zonder streams
    act = makeActivity([{ t: start, d: 0, lat: null, lon: null }, { t: start + summary.elapsed_time * 1000, d: summary.distance, lat: null, lon: null }], summary.name, 'strava');
    act.manualDistance = summary.distance;
    act.manualTime = summary.moving_time;
    finalize(act);
  }
  act.stravaId = summary.id;
  act.description = summary.description || '';
  return act;
}

export const manualUploadUrl = 'https://www.strava.com/upload/select';
export const activityUrl = id => `https://www.strava.com/activities/${id}`;
