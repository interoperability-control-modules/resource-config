// Agents: identity, package, lifecycle, the configuration form where a schema exists, State on the right.
import { api } from '../api.js';
import { h, dot, tag, kind, note, btn, mb, card, section, kv, schemaForm, toast } from '../ui.js';
import { state, navigate, refreshModel, collapseHandle } from '../app.js';
import { rawEditor, menu, checksCard } from './common.js';

export const title = 'Agents';
export const railBadges = (s) => [h('span', { class: 'pill n' }, String((s.model.agents || []).length))];
const SCHEMA_OF = { driver: 'driver/config', 'resource bridge': 'resource_bridge/config', 'bus adapter': 'bus_adapter/config' };

export function render({ side, main, ctx, params }) {
  const agents = (state.model.agents || []).filter((a) => !a.hidden || params.hidden);
  const selected = agents.find((a) => a.identity === params.identity) || agents[0];
  if (side) {
    side.append(h('h3', { class: 'ph' }, 'Agents', h('span', { class: 'sp' }), collapseHandle('side')),
      h('div', { class: 'tree' }, ...agents.map((a) => h('div', { class: selected && a.identity === selected.identity ? 'sel' : '', onClick: () => navigate('agents', { identity: a.identity }) }, dot(a.running ? 'ok' : a.hidden ? 'ok' : 'off'), a.identity, ' ', tag(a.type)))),
      h('div', { class: 'note', style: { marginTop: '10px' } }, params.hidden ? h('a', { onClick: () => navigate('agents', { identity: selected && selected.identity }) }, 'hide platform services') : h('a', { onClick: () => navigate('agents', { identity: selected && selected.identity, hidden: 1 }) }, 'show platform services')));
  }
  if (!selected) { main.append(h('div', { class: 'empty' }, 'No agents.')); return; }
  renderAgent(main, ctx, selected, !!params.edit);
}

function renderAgent(main, ctx, a, editing) {
  const entries = Object.keys((state.model.store_entries || {})[a.identity] || {});
  const schemaKey = SCHEMA_OF[a.type], schema = schemaKey && (state.catalog || { schemas: {} }).schemas[schemaKey];
  const configBox = h('div', {}, note('loading configuration…'));
  api.entry(a.identity, 'config').then((entry) => {
    const data = entry.data && typeof entry.data === 'object' ? entry.data : {};
    if (schema && entry.type === 'json') {
      if (editing) {
        const draft = JSON.parse(JSON.stringify(data));
        const form = schemaForm(schema, draft, { onChange: (name, value) => { if (value === null) delete draft[name]; else draft[name] = value; } });
        configBox.replaceChildren(form, h('div', { class: 'bar' }, btn('Save', async () => { try { await api.putEntry(a.identity, 'config', { type: 'json', data: draft }); toast('saved', 'ok'); await refreshModel(false); navigate('agents', { identity: a.identity }); } catch (e) { toast(e.message, 'err'); } }, { primary: true }), btn('Cancel', () => navigate('agents', { identity: a.identity }))));
      } else {
        const hints = schema['x-hints'] || {}; const props = schema.properties || {};
        const rows = Object.entries(props).filter(([n]) => !(hints[n] || {}).advanced).map(([n, p]) => [prettify(n), h('span', {}, data[n] === undefined ? h('span', { class: 'note' }, p.default !== undefined && typeof p.default !== 'object' ? String(p.default) : '—') : typeof data[n] === 'object' ? JSON.stringify(data[n]).slice(0, 80) : String(data[n]), (hints[n] || {}).unit ? [' ', note((hints[n] || {}).unit)] : null), (hints[n] || {}).tooltip]);
        const advanced = Object.entries(props).filter(([n]) => (hints[n] || {}).advanced);
        const changed = advanced.filter(([n, p]) => data[n] !== undefined && JSON.stringify(data[n]) !== JSON.stringify(p.default)).length;
        configBox.replaceChildren(kv(rows), section('Advanced', () => kv(advanced.map(([n, p]) => [prettify(n), String(data[n] ?? p.default ?? '—')])), { collapsed: true, note: `${advanced.length} fields, ${changed ? changed + ' not at their defaults' : 'all at their defaults'}` }));
      }
    } else configBox.replaceChildren(h('pre', { class: 'mono' }, entry.text), note(schema ? `stored as ${entry.type}` : 'no configuration model for this agent type; the raw entry is editable'));
  }).catch(() => configBox.replaceChildren(note('this agent has no "config" entry'), h('div', { class: 'bar' }, btn('Create', () => rawEditorCreate(a.identity)))));
  const summary = a.type === 'driver' ? section('Devices', note(`${state.model.devices.length} devices · ${state.model.devices.filter((d) => d.driver_role && d.driver_role !== 'client').length} served`), { actions: [btn('Open Devices ▸', () => navigate('devices'))] })
    : a.type === 'service' ? section('Resources', note(`${state.model.resources.canonical.length} canonical · ${state.model.resources.aliases.length} aliases · ${state.model.formats.filter((f) => f.declared).length} formats declared · ${state.model.transforms.length} local transforms`), { actions: [btn('Open Resources ▸', () => navigate('resources'))] })
    : a.type === 'resource bridge' ? section('Bridges', note(`${state.model.bridges.length} bridges`), { actions: [btn('Open Bridges ▸', () => navigate('bridges'))] })
    : a.type === 'bus adapter' ? section('Remote topics', note(`${state.model.remote_topics.length} on ${state.model.buses.length} bus${state.model.buses.length === 1 ? '' : 'es'}`), { actions: [btn('Open Bridges ▸', () => navigate('bridges'))] }) : null;
  const lifecycle = a.hidden ? [] : [btn('Stop', () => act(a, 'stop')), btn('Restart', () => act(a, 'restart')), btn(a.enabled ? 'Disable' : 'Enable', () => act(a, a.enabled ? 'disable' : 'enable'))];
  if (!a.hidden && !a.running) lifecycle[0] = btn('Start', () => act(a, 'start'), { primary: true });
  main.append(card({ title: h('span', { style: { fontSize: '18px', fontWeight: 600 } }, a.identity), badge: kind(a.type), boxes: [mb('package', a.name || '—'), a.tag ? mb('tag', a.tag) : null],
    buttons: [...lifecycle, editing ? null : btn('Edit', () => navigate('agents', { identity: a.identity, edit: 1 })), btn('Raw JSON', () => rawEditor(a.identity, 'config')), btn('⋯', (e) => menu(e.target, [{ header: 'Layout' }, { layout: true }]))],
    sections: [summary, section('Configuration', configBox, { note: schema ? 'config · generated from the agent\'s model' : 'config' })] }));
  if (ctx) ctx.append(h('h3', { class: 'ph' }, collapseHandle('ctx'), h('span', { class: 'sp' })),
    h('div', { class: 'card' }, h('h4', {}, 'State'), ...[['status', a.hidden ? '● platform service' : a.running ? '● running' : '○ stopped', a.running || a.hidden ? 'ok' : 'warn'], ['enabled', a.enabled == null ? '—' : a.enabled ? 'yes' : 'no'], ['priority', a.priority ?? '—'], ['pid', a.pid ?? '—'], ['exit code', a.exit_code ?? '—'], ['uuid', a.uuid || '—'],
      ['health', a.health && a.health.status ? a.health.status : '—', a.health && a.health.status === 'GOOD' ? 'ok' : '']].map(([k, v, cls]) => h('div', { class: 'hrow' }, h('span', {}, k), h('span', { class: cls || '' }, String(v))))),
    h('div', { class: 'card' }, h('h4', {}, 'Owns'), h('div', { class: 'uby' }, ...ownedBy(a))),
    checksCard(a.running === false && !a.hidden ? [['warn', 'not running']] : [['ok', a.hidden ? 'platform service' : 'running']]));
}
function ownedBy(a) {
  const m = state.model;
  if (a.type === 'driver') return [h('div', {}, `${m.devices.length} device entries · `, h('a', { onClick: () => navigate('devices') }, 'Devices ▸')), h('div', {}, `${m.registries.length} registries · ${m.registries.filter((r) => !r.devices.length).length} unreferenced`)];
  if (a.type === 'service') return [h('div', {}, `${m.resources.canonical.length} canonical resources, ${m.resources.aliases.length} aliases`), h('div', {}, `${m.formats.filter((f) => f.declared).length} declared formats, ${m.transforms.length} local transforms`)];
  if (a.type === 'resource bridge') return [h('div', {}, `${m.bridges.length} bridges`)];
  if (a.type === 'bus adapter') return [h('div', {}, `${m.remote_topics.length} remote topics on ${m.buses.map((b) => b.name).join(', ') || 'no bus'}`)];
  return [note('nothing in the store, or an entry this UI does not model')];
}
async function act(a, action) { try { await api.lifecycle(a.identity, action); toast(`${action}: ${a.identity}`, 'ok'); setTimeout(() => refreshModel(false), 1500); } catch (e) { toast(e.message, 'err'); } }
function rawEditorCreate(identity) { api.putEntry(identity, 'config', { type: 'json', data: {} }).then(() => refreshModel(false)).catch((e) => toast(e.message, 'err')); }
const prettify = (n) => n.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
