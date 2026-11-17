// Profiel & instellingen, Strava koppeling, schoenen, backup
import { $, $$, esc, fmtPace, parsePace, toast, uid, confirmDialog } from '../utils.js';
import { settings, saveSettings, hrZones, paceZones, ZONE_COLORS } from '../settings.js';
import * as strava from '../strava.js';
import { stravaImportDialog, exportBackup, importBackup, importFiles } from './io.js';
import { db, invalidate } from '../db.js';

export function renderProfile(view) {
  const s = settings();
  const st = s.strava;
  view.innerHTML = `<header class="top"><h1>Profiel</h1></header>

  <section class="card strava-setup">
    <div class="row between"><h3><span class="badge strava">S</span> Strava</h3>${strava.isConnected() ? '<span class="ok">Gekoppeld ✓</span>' : ''}</div>
    ${strava.isConnected() ? `
      <p>Ingelogd als <b>${esc(st.athlete?.name || 'Strava atleet')}</b></p>
      <label class="check"><input type="checkbox" id="st-auto" ${st.autoUpload ? 'checked' : ''}> Runs standaard delen op Strava na opslaan</label>
      <div class="row gap wrap"><button class="btn strava-btn" id="st-import">Runs importeren uit Strava</button><button class="btn ghost danger" id="st-off">Ontkoppelen</button></div>
    ` : `
      <p class="muted small">Koppel je Strava account om runs met één tik te delen met je vrienden en je Strava historie te importeren.</p>
      <details ${st.clientId ? '' : 'open'}><summary>Eenmalig instellen (2 minuten)</summary>
        <ol class="small steps">
          <li>Ga naar <a href="https://www.strava.com/settings/api" target="_blank" rel="noopener">strava.com/settings/api</a> en maak een API applicatie aan (naam bijv. "Mijn Run App", website mag alles zijn).</li>
          <li>Vul bij <b>Authorization Callback Domain</b> in: <code>${esc(location.hostname)}</code></li>
          <li>Kopieer de <b>Client ID</b> en <b>Client Secret</b> hieronder.</li>
        </ol>
      </details>
      <label class="field"><span>Client ID</span><input id="st-id" inputmode="numeric" value="${esc(st.clientId)}"></label>
      <label class="field"><span>Client Secret</span><input id="st-secret" type="password" value="${esc(st.clientSecret)}"></label>
      <button class="btn strava-btn full" id="st-connect">Verbinden met Strava</button>
      <p class="muted small">Je gegevens blijven alleen op dit apparaat. Geen koppeling? Je kunt altijd een TCX/GPX exporteren en handmatig uploaden op strava.com.</p>
    `}
  </section>

  <section class="card"><h3>Persoonlijk</h3>
    <div class="form-grid">
      <label class="field"><span>Naam</span><input data-k="name" value="${esc(s.name)}"></label>
      <label class="field"><span>Gewicht (kg)</span><input data-k="weight" type="number" value="${s.weight}"></label>
      <label class="field"><span>Geboortejaar</span><input data-k="birthYear" type="number" value="${s.birthYear}"></label>
      <label class="field"><span>Geslacht</span><select data-k="sex"><option value="m" ${s.sex === 'm' ? 'selected' : ''}>Man</option><option value="v" ${s.sex === 'v' ? 'selected' : ''}>Vrouw</option></select></label>
    </div>
  </section>

  <section class="card"><h3>Zones</h3>
    <div class="form-grid">
      <label class="field"><span>Max. hartslag</span><input data-k="maxHr" type="number" value="${s.maxHr}"></label>
      <label class="field"><span>Rusthartslag</span><input data-k="restHr" type="number" value="${s.restHr}"></label>
      <label class="field"><span>Drempeltempo (/km)</span><input id="tp" value="${fmtPace(s.thresholdPace)}" placeholder="5:00"></label>
    </div>
    <button class="btn ghost small" id="est-hr">Max. hartslag schatten uit leeftijd</button>
    <div class="zone-list">${hrZones().map((z, i) => `<div><i style="background:${ZONE_COLORS[i + 1]}"></i>Z${z.z} ${z.name}<b>${z.min}-${z.max} bpm</b></div>`).join('')}</div>
    <div class="zone-list">${paceZones().map((z, i) => `<div><i style="background:${ZONE_COLORS[i + 1]}"></i>Z${z.z} ${z.name}<b>${z.fast === 0 ? `< ${fmtPace(z.slow)}` : z.slow === Infinity ? `> ${fmtPace(z.fast)}` : `${fmtPace(z.fast)}-${fmtPace(z.slow)}`}</b></div>`).join('')}</div>
  </section>

  <section class="card"><h3>Opname</h3>
    <div class="form-grid">
      <label class="field"><span>Auto-ronde (km, 0 = uit)</span><input data-k="autoLapKm" type="number" step="0.5" value="${s.autoLapKm}"></label>
      <label class="field"><span>Stem update elke (km)</span><input data-k="voiceIntervalKm" type="number" step="0.5" min="0.5" value="${s.voiceIntervalKm}"></label>
      <label class="field"><span>Aftellen (sec)</span><input data-k="countdown" type="number" value="${s.countdown}"></label>
      <label class="field"><span>Max. GPS onnauwkeurigheid (m)</span><input data-k="gpsAccuracyMax" type="number" value="${s.gpsAccuracyMax}"></label>
      <label class="field"><span>Kaartstijl</span><select data-k="mapStyle">${[['dark', 'Donker'], ['light', 'Licht'], ['osm', 'OpenStreetMap'], ['satellite', 'Satelliet']].map(([k, l]) => `<option value="${k}" ${s.mapStyle === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <label class="check"><input type="checkbox" data-k="autoPause" ${s.autoPause ? 'checked' : ''}> Auto-pauze</label>
    <label class="check"><input type="checkbox" data-k="voice" ${s.voice ? 'checked' : ''}> Stemcoach</label>
    <label class="check"><input type="checkbox" data-k="voiceHr" ${s.voiceHr ? 'checked' : ''}> Hartslag in stem updates</label>
    <label class="check"><input type="checkbox" data-k="keepAwake" ${s.keepAwake ? 'checked' : ''}> Scherm aan houden tijdens run (aanbevolen)</label>
  </section>

  <section class="card"><h3>Doelen</h3>
    <div class="form-grid">
      <label class="field"><span>Weekdoel (km)</span><input data-k="weeklyGoalKm" type="number" value="${s.weeklyGoalKm}"></label>
      <label class="field"><span>Jaardoel (km)</span><input data-k="yearGoalKm" type="number" value="${s.yearGoalKm}"></label>
    </div>
  </section>

  <section class="card"><h3>Schoenen</h3>
    <div id="shoes">${s.shoes.map(sh => `<div class="list-row"><span>${esc(sh.name)}${sh.id === s.defaultShoe ? ' <em class="tag">standaard</em>' : ''}${sh.retired ? ' <em class="muted">(met pensioen)</em>' : ''}</span>
      <span class="row gap"><button class="btn ghost small" data-def="${sh.id}">★</button><button class="btn ghost small" data-ret="${sh.id}">${sh.retired ? 'Activeren' : 'Pensioen'}</button></span></div>`).join('') || '<p class="muted small">Houd kilometers per paar bij zodat je weet wanneer ze vervangen moeten worden.</p>'}</div>
    <div class="row gap"><input id="sh-name" placeholder="bijv. Nike Pegasus 41" class="grow"><input id="sh-limit" type="number" value="700" style="width:80px" title="Max km"><button class="btn ghost" id="sh-add">+</button></div>
  </section>

  <section class="card"><h3>Data</h3>
    <div class="row gap wrap">
      <button class="btn ghost" id="d-imp">GPX/TCX importeren</button>
      <button class="btn ghost" id="d-exp">Backup maken</button>
      <button class="btn ghost" id="d-res">Backup herstellen</button>
      <button class="btn ghost danger" id="d-wipe">Alles wissen</button>
    </div>
    <p class="muted small">Alle data staat lokaal op je telefoon. Maak af en toe een backup.</p>
  </section>
  <p class="muted small center">Tempo · hardloop app</p>`;

  // Instellingen opslaan bij wijziging
  $$('[data-k]').forEach(inp => inp.addEventListener('change', () => {
    const k = inp.dataset.k;
    const v = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? +inp.value : inp.value;
    saveSettings({ [k]: v });
    toast('Opgeslagen');
    if (['maxHr', 'restHr'].includes(k)) renderProfile(view);
  }));
  $('#tp').onchange = e => {
    const v = parsePace(e.target.value);
    if (!v) return toast('Gebruik formaat m:ss');
    saveSettings({ thresholdPace: v }); toast('Opgeslagen'); renderProfile(view);
  };
  $('#est-hr').onclick = () => { saveSettings({ maxHr: Math.round(208 - 0.7 * (new Date().getFullYear() - s.birthYear)) }); renderProfile(view); };

  // Strava
  $('#st-connect')?.addEventListener('click', () => {
    const id = $('#st-id').value.trim(), secret = $('#st-secret').value.trim();
    if (!id || !secret) return toast('Vul Client ID en Secret in');
    saveSettings({ strava: { ...s.strava, clientId: id, clientSecret: secret } });
    try { strava.startAuth(); } catch (e) { toast(e.message); }
  });
  $('#st-auto')?.addEventListener('change', e => saveSettings({ strava: { ...s.strava, autoUpload: e.target.checked } }));
  $('#st-import')?.addEventListener('click', stravaImportDialog);
  $('#st-off')?.addEventListener('click', async () => { if (await confirmDialog('Strava ontkoppelen?', 'Ontkoppelen', true)) { strava.disconnect(); renderProfile(view); } });

  // Schoenen
  $('#sh-add').onclick = () => {
    const name = $('#sh-name').value.trim();
    if (!name) return;
    const shoe = { id: uid(), name, limitKm: +$('#sh-limit').value || 700, startKm: 0, retired: false };
    saveSettings({ shoes: [...s.shoes, shoe], defaultShoe: s.defaultShoe || shoe.id });
    renderProfile(view);
  };
  $$('[data-def]').forEach(b => b.onclick = () => { saveSettings({ defaultShoe: b.dataset.def }); renderProfile(view); });
  $$('[data-ret]').forEach(b => b.onclick = () => { const sh = s.shoes.find(x => x.id === b.dataset.ret); sh.retired = !sh.retired; saveSettings({ shoes: s.shoes }); renderProfile(view); });

  // Data
  $('#d-imp').onclick = () => importFiles();
  $('#d-exp').onclick = exportBackup;
  $('#d-res').onclick = importBackup;
  $('#d-wipe').onclick = async () => {
    if (!await confirmDialog('ALLE runs, routes en segmenten wissen? Dit kan niet ongedaan worden.', 'Alles wissen', true)) return;
    for (const st2 of ['activities', 'routes', 'segments']) await db.clear(st2);
    invalidate();
    toast('Alles gewist');
  };
}
