// The application: session, model, routing between the tabs, store events.
import { api } from './api.js';
import { h, clear, toast } from './ui.js';
import * as resources from './pages/resources.js';
import * as devices from './pages/devices.js';
import * as formats from './pages/formats.js';
import * as transforms from './pages/transforms.js';
import * as bridges from './pages/bridges.js';
import * as agents from './pages/agents.js';
import * as pending from './pages/pending.js';

export const state = { session: null, model: null, catalog: null, pending: [], page: 'resources', params: {}, layout: localStorage.getItem('rc:layout') || 'stacked',
  side: localStorage.getItem('rc:side') !== 'collapsed', ctx: localStorage.getItem('rc:ctx') !== 'collapsed' };
const PAGES = { resources, devices, formats, transforms, bridges, agents, pending };
const TABS = [['resources', 'Resources'], ['devices', 'Devices'], ['formats', 'Formats'], ['transforms', 'Transforms'], ['bridges', 'Bridges'], ['agents', 'Agents']];

export function navigate(page, params = {}) {
  const query = Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  location.hash = `#/${page}${query ? '?' + query : ''}`;
}
function parseHash() {
  const m = location.hash.match(/^#\/([a-z]+)(?:\?(.*))?$/);
  const page = m && PAGES[m[1]] ? m[1] : 'resources';
  const params = {};
  if (m && m[2]) for (const pair of m[2].split('&')) { const [k, v] = pair.split('='); params[k] = decodeURIComponent(v || ''); }
  return { page, params };
}
export async function refreshModel(refresh = false) {
  try { state.model = await api.model(refresh); state.pending = (await api.pending()).entries; render(); }
  catch (e) { if (e.status !== 401) toast(`Could not load the platform model: ${e.message}`, 'err'); }
}
export function setLayout(layout) { state.layout = layout; localStorage.setItem('rc:layout', layout); render(); }
export function togglePane(which) { state[which] = !state[which]; localStorage.setItem(`rc:${which}`, state[which] ? 'open' : 'collapsed'); render(); }

function renderTabs() {
  const tabs = clear(document.getElementById('tabs'));
  for (const [id, label] of TABS) tabs.append(h('a', { class: state.page === id ? 'on' : '', onClick: () => navigate(id) }, label));
  tabs.append(h('span', { class: 'badge', onClick: () => navigate('pending'), style: { cursor: 'pointer' } }, 'Pending changes ', h('span', { class: 'pill' }, String(state.pending.length))));
  const right = clear(document.getElementById('topright'));
  if (state.session) right.append(`${state.session.dialect} · ${state.session.platform || ''} · ${state.session.user} `, h('a', { onClick: logout }, 'sign out'));
}
function renderStatus() {
  const bar = clear(document.getElementById('statusbar'));
  if (!state.model) return;
  const age = state.model.refreshed ? Math.round(Date.now() / 1000 - state.model.refreshed) : null;
  bar.append(h('span', {}, `store version ${state.model.version ?? '—'}`), h('span', {}, age === null ? 'not refreshed' : `refreshed ${age} s ago`));
  if (state.model.error) bar.append(h('span', { class: 'err' }, `platform: ${state.model.error}`));
  bar.append(h('span', { class: 'sp' }), h('a', { onClick: () => refreshModel(true) }, 'refresh now'));
}
export function render() {
  renderTabs(); renderStatus();
  const panes = document.getElementById('panes');
  panes.classList.toggle('no-side', !state.side); panes.classList.toggle('no-ctx', !state.ctx);
  const side = clear(document.getElementById('side')), main = clear(document.getElementById('main')), ctx = clear(document.getElementById('ctx'));
  if (!state.model) { main.append(h('div', { class: 'empty' }, 'Loading the platform model…')); return; }
  const page = PAGES[state.page];
  if (!state.side) side.append(rail('side', page.title || state.page, page.railBadges ? page.railBadges(state) : []));
  if (!state.ctx) ctx.append(rail('ctx', 'Health · Checks', []));
  page.render({ side: state.side ? side : null, main, ctx: state.ctx ? ctx : null, params: state.params, state });
}
function rail(which, label, badges) {
  return h('div', { class: `rail${which === 'ctx' ? ' right' : ''}`, style: { height: '100%' } }, h('span', { style: { cursor: 'pointer' }, onClick: () => togglePane(which) }, which === 'side' ? '▸' : '◂'),
    h('span', { class: 'vt' }, label), ...badges);
}
export function collapseHandle(which) {
  return h('span', { class: 'hd', onClick: () => togglePane(which) }, which === 'side' ? '◂ collapse' : 'collapse ▸');
}
async function logout() { await api.logout(); state.session = null; showLogin(); }
function showLogin(message = '') {
  document.getElementById('login').classList.remove('hidden');
  document.getElementById('loginerror').textContent = message;
}
async function start() {
  window.addEventListener('hashchange', () => { Object.assign(state, parseHash()); render(); });
  Object.assign(state, parseHash());
  window.addEventListener('rc:unauthorized', () => showLogin('Your session ended. Sign in again.'));
  document.getElementById('loginform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      state.session = await api.login(form.get('username'), form.get('password'));
      document.getElementById('login').classList.add('hidden');
      await boot();
    } catch (err) { document.getElementById('loginerror').textContent = err.message; }
  });
  try { state.session = await api.session(); await boot(); } catch { showLogin(); }
}
async function boot() {
  state.catalog = await api.catalog();
  await refreshModel(true);
  api.events((message) => { if (message.type === 'store' && state.model && message.version !== state.model.version) refreshModel(false); });
}
start();
