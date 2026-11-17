// Importeren van bestanden en Strava, backups
import { pickFile, toast, modal, esc, fmtKm, fmtTime, fmtDate, $, $$, download } from '../utils.js';
import { parseFile } from '../gpx.js';
import { activities, saveActivity, db, invalidate } from '../db.js';
import { render } from '../router.js';
import { settings, saveSettings } from '../settings.js';
import * as strava from '../strava.js';
import { haversine, uid } from '../utils.js';
import { elevationGain } from '../stats.js';

export async function importFiles() {
  const files = await pickFile('.gpx,.tcx,application/gpx+xml,application/xml,text/xml', true);
  if (!files.length) return;
  const existing = await activities();
  let nA = 0, nR = 0, dup = 0;
  for (const f of files) {
    try {
      const res = parseFile(await f.text(), f.name);
      if (res.kind === 'route') {
        await saveRoute(res.name, res.path);
        nR++;
      } else {
        if (existing.some(a => Math.abs(a.start - res.start) < 60000)) { dup++; continue; }
        delete res.kind;
        await saveActivity(res);
        nA++;
      }
    } catch (e) { toast(`${f.name}: ${e.message}`); }
  }
  toast(`${nA} run(s)${nR ? ` en ${nR} route(s)` : ''} geïmporteerd${dup ? `, ${dup} dubbel overgeslagen` : ''}`);
  render();
}

export async function saveRoute(name, path) {
  let distance = 0;
  for (let i = 1; i < path.length; i++) distance += haversine(path[i - 1], path[i]);
  const route = { id: uid(), name, path, distance, created: Date.now(), elevGain: Math.round(elevationGain(path, 2).gain) || 0 };
  await db.put('routes', route);
  return route;
}

export async function stravaImportDialog() {
  let page = 1;
  const existing = await activities();
  const have = new Set(existing.map(a => a.stravaId).filter(Boolean));
  const close = modal(`<h2>Importeren uit Strava</h2>
    <p class="muted small">Kies runs om met volledige data (GPS, hartslag, cadans) binnen te halen.</p>
    <div id="sv-list" class="pick-list tall"><p class="muted">Laden...</p></div>
    <div class="row gap"><button class="btn ghost" id="sv-more">Meer laden</button><button class="btn ghost" id="sv-all">Alles selecteren</button><button class="btn primary grow" id="sv-go">Importeren</button></div>`, {
    wide: true,
    onMount: async (m) => {
      const list = $('#sv-list', m);
      const load = async () => {
        try {
          const items = await strava.listActivities(page++);
          if (page === 2) list.innerHTML = '';
          if (!items.length && page === 2) list.innerHTML = '<p class="muted">Geen runs gevonden.</p>';
          list.insertAdjacentHTML('beforeend', items.map(a => `<label class="pick check-pick ${have.has(a.id) ? 'dim' : ''}">
            <input type="checkbox" value="${a.id}" ${have.has(a.id) ? 'disabled' : ''}>
            <div><b>${esc(a.name)}</b><span>${fmtDate(Date.parse(a.start_date))} · ${fmtKm(a.distance)} km · ${fmtTime(a.moving_time)}${have.has(a.id) ? ' · al geïmporteerd' : ''}</span></div></label>`).join(''));
          list._items = [...(list._items || []), ...items];
        } catch (e) { list.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
      };
      await load();
      $('#sv-more', m).onclick = load;
      $('#sv-all', m).onclick = () => $$('input:not(:disabled)', list).forEach(i => { i.checked = true; });
      $('#sv-go', m).onclick = async () => {
        const ids = $$('input:checked', list).map(i => +i.value);
        if (!ids.length) return toast('Niets geselecteerd');
        const btn = $('#sv-go', m);
        btn.disabled = true;
        let n = 0;
        for (const id of ids) {
          btn.textContent = `Importeren ${++n}/${ids.length}...`;
          try {
            const sum = list._items.find(x => x.id === id);
            const act = await strava.importActivity(sum);
            delete act.kind;
            await saveActivity(act);
          } catch (e) { toast(e.message); break; }
        }
        close();
        toast(`${n} run(s) geïmporteerd uit Strava`);
        render();
      };
    },
  });
}

export async function exportBackup() {
  const data = {
    app: 'tempo-run', version: 1, exported: Date.now(),
    settings: { ...settings(), strava: { ...settings().strava, tokens: null, clientSecret: '' } },
    activities: await db.all('activities'),
    routes: await db.all('routes'),
    segments: await db.all('segments'),
  };
  download(`tempo-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), 'application/json');
}

export async function importBackup() {
  const [f] = await pickFile('.json,application/json');
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'tempo-run') throw new Error('Geen geldige backup');
    for (const a of data.activities || []) await db.put('activities', a);
    for (const r of data.routes || []) await db.put('routes', r);
    for (const sg of data.segments || []) await db.put('segments', sg);
    if (data.settings) {
      const { strava: st, ...rest } = data.settings;
      saveSettings({ ...rest, strava: { ...settings().strava, clientId: st?.clientId || settings().strava.clientId } });
    }
    invalidate();
    toast(`Backup hersteld: ${data.activities?.length || 0} activiteiten`);
    render();
  } catch (e) { toast(e.message); }
}
