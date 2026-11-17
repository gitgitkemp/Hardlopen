// App opstart en routes
import { $, toast } from './utils.js';
import { route, render } from './router.js';
import { renderFeed } from './views/feed.js';
import { renderActivity } from './views/activity.js';
import { renderTraining } from './views/training.js';
import { renderRoutes } from './views/routes.js';
import { renderProfile } from './views/profile.js';
import { renderPrepare, checkRecovery, leavePrepare, isRecording } from './views/record.js';
import { onLeave } from './router.js';
import * as strava from './strava.js';

const view = () => $('#view');

function setNav(name) {
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('on', a.dataset.nav === name));
  document.body.dataset.page = name;
  window.scrollTo(0, 0);
}

route('/', async () => { setNav('home'); await renderFeed(view()); });
route('/activiteit/:id', async ({ id, q }) => { setNav('home'); await renderActivity(view(), id, q); });
route('/training', async ({ q }) => { setNav('training'); await renderTraining(view(), 'voortgang', q); });
route('/training/:tab', async ({ tab, q }) => { setNav('training'); await renderTraining(view(), tab, q); });
route('/rennen', async () => {
  setNav('rennen');
  if (isRecording()) return;
  await renderPrepare(view());
  onLeave(leavePrepare);
});
route('/routes', async ({ q }) => { setNav('routes'); await renderRoutes(view(), 'lijst', q); });
route('/routes/:tab', async ({ tab, q }) => { setNav('routes'); await renderRoutes(view(), tab, q); });
route('/profiel', () => { setNav('profiel'); renderProfile(view()); });

async function boot() {
  // Terugkeer van Strava OAuth
  try {
    const athlete = await strava.handleRedirect();
    if (athlete) toast(`Gekoppeld met Strava als ${athlete.firstname}`);
  } catch (e) { toast(e.message, 5000); }
  await render();
  checkRecovery();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // Vraag om persistente opslag zodat runs niet gewist worden
  navigator.storage?.persist?.();
}

boot();
