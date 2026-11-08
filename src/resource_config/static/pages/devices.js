// Devices: a tree over the topic segments; one device card with Device, Polling and publishing, Remote config and Registry.
import { api } from '../api.js';
import { displayColumn, h, uai, dot, tag, kind, note, btn, mb, card, section, kv, schemaForm, input, select, radios, checkbox, toast, info, dialog, segmentsInput } from '../ui.js';
import { state, navigate, refreshModel, collapseHandle } from '../app.js';
import { rawEditor, menu, healthCard, checksCard, consumersCard, deleteDialog, dependentsOf, removeMapping } from './common.js';

export const title = 'Devices';
export const railBadges = (s) => [h('span', { class: 'pill n' }, String(s.model.devices.length))];
const DEVICE_FIELDS = ['registry_config', 'interval', 'polling_group', 'group', 'active', 'publish_depth_first_all', 'publish_breadth_first_all', 'publish_depth_first_multi', 'publish_breadth_first_multi',
  'publish_depth_first_single', 'publish_breadth_first_single', 'all_publish_interval', 'equipment_specific_fields', 'driver_config', 'driver_type', 'driver_role', 'heart_beat_point'];

export function render({ side, main, ctx, params }) {
  if (params.discover && !document.querySelector('.dialog')) setTimeout(discoverDialog, 0);   // #/devices?discover=1 opens the dialog
  const devices = state.model.devices;
  const selected = devices.find((d) => d.topic === params.topic) || devices[0];
  if (side) side.append(tree(devices, selected && selected.topic));
  if (!selected) { main.append(h('div', { class: 'empty' }, 'No devices are configured. ', btn('+ Device', addDevice), ' ', btn('Discover ▸', discoverDialog, { primary: true }))); return; }
  renderDevice(main, ctx, selected, !!params.edit);
}

function tree(devices, selected) {
  const el = h('div', {}, h('h3', { class: 'ph' }, 'Devices', h('span', { class: 'sp' }), collapseHandle('side')));
  const filter = input('', { placeholder: 'filter', width: '100%' });
  filter.addEventListener('input', () => { for (const leaf of el.querySelectorAll('.leaf')) leaf.classList.toggle('hidden', filter.value && !leaf.textContent.toLowerCase().includes(filter.value.toLowerCase())); });
  el.append(h('div', { style: { marginBottom: '8px' } }, filter));
  const root = {};
  for (const d of devices) { let node = root; const parts = d.topic.split('/'); parts.forEach((p, i) => { node.children = node.children || {}; node.children[p] = node.children[p] || {}; node = node.children[p]; if (i === parts.length - 1) node.device = d; }); }
  const build = (node, depth) => Object.entries(node.children || {}).map(([name, child]) => child.device
    ? h('div', { class: `leaf${child.device.topic === selected ? ' on' : ''}`, style: { paddingLeft: `${depth * 14 + 6}px`, display: 'flex', gap: '6px', alignItems: 'center', padding: '3px 6px', borderRadius: '3px', cursor: 'pointer', background: child.device.topic === selected ? 'var(--sel)' : '' }, onClick: () => navigate('devices', { topic: child.device.topic }) },
        dot(child.device.active === false ? 'off' : 'ok'), h('span', { style: { fontWeight: child.device.topic === selected ? 600 : 400 } }, name), tag(`${child.device.driver_type || '?'} · ${child.device.driver_role || 'client'}`))
    : h('div', { style: { marginLeft: `${depth ? 9 : 0}px` } }, h('div', { style: { paddingLeft: `${depth * 14}px`, fontWeight: 600, padding: '3px 0' } }, '▾ ', name), ...build(child, depth + 1)));
  el.append(h('div', { class: 't2' }, h('div', { class: 'clade sel' }, ...build(root, 0))), h('div', { class: 'legend' }, note('tree by topic segment · leaves are devices')),
    h('div', { class: 'bar' }, btn('+ Device', addDevice), btn('Discover ▸', discoverDialog, { primary: true })));
  const registries = state.model.registries || [];
  el.append(section('Registries', () => h('div', {}, ...registries.map((r) => h('div', { class: 'tree' }, h('div', {}, r.name.replace('registry_configs/', ''), ' ', tag(`${r.devices.length} device${r.devices.length === 1 ? '' : 's'} · ${r.rows} rows`), r.devices.length ? null : [' ', btn('delete', () => deleteRegistry(r.name))])))),
    { collapsed: true, note: `${registries.length} · ${registries.filter((r) => !r.devices.length).length} unreferenced` }));
  return el;
}

// Values this tool fills in where the driver's own default names the platform. They are written into the config
// when the field is absent (so the device carries them, not the driver default) and shown as the field's placeholder.
// A field is seeded only when the schema's show_when hint, if any, admits the device's role.
const UI_DEFAULTS = { ieee2030_5: { description: 'ICM' }, bacnet: { object_name: 'ICM' } };
export function uiDefaults(driverType, role, iface) {
  const hints = (iface && iface.remote && iface.remote['x-hints']) || {};
  const admits = (name) => { const w = (hints[name] || {}).show_when; return !w || Object.entries(w).every(([k, v]) => k !== 'driver_role' || (Array.isArray(v) ? v : [v]).includes(role || 'client')); };
  return Object.fromEntries(Object.entries(UI_DEFAULTS[driverType] || {}).filter(([name]) => admits(name)));
}
export function seedDefaults(remote, iface) {
  if (!remote) return remote;
  for (const [name, value] of Object.entries(uiDefaults(remote.driver_type, remote.driver_role, iface))) if (remote[name] === undefined || remote[name] === null || remote[name] === '') remote[name] = value;
  return remote;
}
function renderDevice(main, ctx, d, editing) {
  const catalog = state.catalog || { schemas: {}, interfaces: {} };
  const iface = catalog.interfaces[d.driver_type] || null;
  const deviceSchema = catalog.schemas['driver/device'] || { properties: {} };
  const draft = { config: JSON.parse(JSON.stringify(d.config || {})) };
  draft.config.driver_config = draft.config.driver_config || {};
  const remote = draft.config.driver_config;
  const remoteId = remoteIdOf(d);
  const groupDefaults = ((state.model.agents || []).find((a) => a.identity === 'platform.driver') || {});
  const deviceBody = kv([
    ['Topic', editing ? segmentsInput(d.topic, { separator: '/', onChange: (v) => (draft.topic = v.join('/')) }) : h('span', { class: 'mono' }, d.topic), 'Free-form; the entry name, the rpc topic of the device\'s resource, and with devices/ in front the UAI of the resource the device publishes.'],
    ['Driver type', editing ? select(d.driver_type, Object.keys(catalog.interfaces).map((i) => [i, i]), { onChange: (v) => (remote.driver_type = v), width: '200px' }) : d.driver_type || '—'],
    ['Role', editing ? radios('role', d.driver_role === 'client' ? 'client' : 'server', [['client', 'client (master)'], ['server', `server (${serverWord(d.driver_type)})`]], (v) => (remote.driver_role = v === 'client' ? 'client' : serverWord(d.driver_type))) : roleLabel(d.driver_role, d.driver_type)],
    ['Active', editing ? checkbox(d.active !== false, (v) => (draft.config.active = v)) : d.active === false ? 'no' : 'yes', 'Inactive devices are neither polled nor published; their configuration is kept.']]);
  const pollingBody = kv([
    ['Polling group', editing ? input(d.polling_group || '', { placeholder: 'default', width: '160px', onChange: (v) => (draft.config.polling_group = v || null) }) : d.polling_group || h('span', { class: 'note' }, 'default'), 'One of the driver\'s polling groups. Blank uses the driver\'s default group.'],
    ['Interval', editing ? h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, input(d.interval ?? '', { num: true, width: '90px', placeholder: '60', onChange: (v) => (draft.config.interval = v === '' ? null : v) }), note('s')) : d.interval != null ? `${d.interval} s` : h('span', { class: 'note' }, 'driver default'), 'Seconds between polls of this device. Blank inherits the driver\'s default; a point may set its own in the registry.'],
    ['Publishes', h('div', {}, h('div', { class: 'mono', style: { padding: '2px 0' } }, d.publication_topic), editing ? radios('pub', d.publishes, [['all', 'all'], ['multi', 'multi']], (v) => { draft.config.publish_depth_first_all = v === 'all'; draft.config.publish_depth_first_multi = v === 'multi'; }) : note(d.publishes === 'all' ? 'all: one message per poll with every point' : 'multi: one message per poll with the points that changed')), 'The device publishes on exactly one of the two topics.'],
    ['Heartbeat point', editing ? input(d.heart_beat_point || '', { width: '200px', onChange: (v) => (remote.heart_beat_point = v || null) }) : d.heart_beat_point || '—']]);
  const remoteSection = iface ? (editing
      ? schemaForm(iface.remote, remote, { defaults: uiDefaults(d.driver_type, d.driver_role, iface), hide: ['driver_type', 'driver_role', 'heart_beat_point', 'module', 'plugins', 'register_map'], onChange: (name, value) => { if (value === null) delete remote[name]; else remote[name] = value; } })
      : remoteView(iface.remote, remote))
    : h('div', {}, note(`no schema for driver type "${d.driver_type}" is installed beside the UI; the raw entry is editable`), h('pre', { class: 'mono' }, JSON.stringify(remote, null, 2)));
  const registrySection = section('Registry', registryGrid(d), { note: d.registry ? d.registry.replace('registry_configs/', '') : 'none',
    actions: [btn('Switch registry ▾', () => switchRegistry(d)), btn('Copy as new', () => copyRegistry(d)), btn('Import', () => importRegistry(d)), btn('Export', () => exportRegistry(d))] });
  const buttons = editing
    ? [btn('Save', () => saveDevice(d, draft), { primary: true }), btn('Cancel', () => navigate('devices', { topic: d.topic })), btn('Raw JSON', () => rawEditor('platform.driver', d.entry))]
    : [btn('Edit', () => navigate('devices', { topic: d.topic, edit: 1 })), btn('Raw JSON', () => rawEditor('platform.driver', d.entry)), btn('⋯', (e) => menu(e.target, [{ header: 'Layout' }, { layout: true }, { header: 'This device' },
        { label: 'Export entry (JSON)', onClick: () => download(`${d.topic.replace(/\//g, '_')}.json`, JSON.stringify(d.config, null, 2)) },
        ...(d.resource ? [{ label: 'Open resource ▸', onClick: () => navigate('resources', { uai: d.resource }) }] : []),
        { label: 'Delete…', danger: true, onClick: () => deleteDevice(d) }]))];
  main.append(card({ title: h('span', { class: 'mono', style: { fontSize: '16px', fontWeight: 600 } }, `devices/${d.topic}`), badge: kind('device'),
    boxes: [h('span', { class: 'note', title: 'The interface\'s unique remote id, derived from the remote config.' }, 'device UAI ⓘ'), uai(remoteId, { size: 'small' })], buttons,
    sections: [section('Device', deviceBody, { note: editing ? 'in edit mode' : undefined, actions: d.resource ? [btn('Resource ▸', () => navigate('resources', { uai: d.resource }))] : [note('no canonical resource publishes this device')] }),
      section('Polling and publishing', pollingBody), section(`Remote config`, remoteSection, { note: d.driver_type || '' }), registrySection,
      d.driver_role && d.driver_role !== 'client' ? section('Served state', () => h('div', {}, note('the agent-written state entry; read-only'), h('pre', { class: 'mono' }, JSON.stringify((state.model && stateEntry(d)) || {}, null, 2))), { collapsed: true, note: 'only for server roles · written by the agent' }) : null] }));
  if (ctx) {
    const driver = (state.model.agents || []).find((a) => a.identity === 'platform.driver');
    const health = driver && driver.health && driver.health.context;
    ctx.append(h('h3', { class: 'ph' }, collapseHandle('ctx'), h('span', { class: 'sp' })),
      healthCard([['driver', driver ? (driver.running ? '● running' : '○ stopped') : '—', driver && driver.running ? 'ok' : 'warn'], ['driver health', (driver && driver.health && driver.health.status) || '—', driver && driver.health && driver.health.status === 'GOOD' ? 'ok' : ''],
        ['context', typeof health === 'string' ? health : health ? JSON.stringify(health).slice(0, 60) : '—'], ['points', d.registry_rows ? String(d.registry_rows.length) : '—']]),
      deviceConsumers(d), checksCard(deviceChecks(d)));
  }
}
function remoteView(schema, remote) {
  const hints = schema['x-hints'] || {}; const props = schema.properties || {};
  // show_when: a row whose condition names another field is shown only when that field (or its default) matches
  const current = (k) => String(remote[k] ?? (props[k] || {}).default ?? '');
  const applies = (n) => { const w = (hints[n] || {}).show_when; return !w || Object.entries(w).every(([k, v]) => (Array.isArray(v) ? v.map(String).includes(current(k)) : String(v) === current(k))); };
  const rows = Object.entries(props).filter(([n]) => !['driver_type', 'driver_role', 'heart_beat_point', 'module', 'plugins', 'debug', 'register_map'].includes(n) && applies(n));
  const visible = rows.filter(([n]) => !(hints[n] || {}).advanced), advanced = rows.filter(([n]) => (hints[n] || {}).advanced);
  const show = (n, prop) => { const v = remote[n]; return v === undefined || v === null ? h('span', { class: 'note' }, prop.default !== undefined && prop.default !== null && typeof prop.default !== 'object' ? String(prop.default) : '—') : typeof v === 'object' ? JSON.stringify(v) : String(v); };
  const groups = new Map();
  for (const [n, prop] of visible) { const g = (hints[n] || {}).group || ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push([n, prop]); }
  const grid = (entries) => kv(entries.map(([n, prop]) => [prettify(n), h('span', {}, show(n, prop), (hints[n] || {}).unit ? [' ', note((hints[n] || {}).unit)] : null), (hints[n] || {}).tooltip]));
  const el = h('div', {}, groups.size > 1 ? h('div', { class: 'two', style: { gap: '24px' } }, ...[...groups.entries()].map(([g, entries]) => h('div', {}, g ? h('h6', { style: { margin: '0 0 6px', fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' } }, g) : null, grid(entries)))) : grid(visible));
  const changed = advanced.filter(([n, prop]) => remote[n] !== undefined && JSON.stringify(remote[n]) !== JSON.stringify(prop.default)).length;
  el.append(section('Advanced', () => grid(advanced), { collapsed: true, note: `${advanced.length} fields, ${changed ? changed + ' not at their defaults' : 'all at their defaults'}` }));
  return el;
}
function registryGrid(d) {
  const rows = d.registry_rows;
  if (!rows) return note(d.registry ? 'the registry entry is not a CSV table' : 'no registry');
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const table = h('table', { class: 'grid-table' }, h('tr', {}, ...columns.map((c) => h('th', { title: c === displayColumn(c, columns) ? undefined : `${c} in the file` }, displayColumn(c, columns)))), ...rows.map((r) => h('tr', {}, ...columns.map((c) => h('td', { class: /name|point/i.test(c) ? 'mono' : '' }, r[c] ?? '')))));
  const warnings = rows.filter((r) => 'Units' in r && !r.Units && !/sf$|_SF$/.test(r['Point Name'] || '')).length;
  return h('div', {}, h('div', { class: 'note', style: { margin: '-4px 0 8px' } }, `${d.registry_shared_with.length ? 'shared with ' + d.registry_shared_with.length + ' other device' + (d.registry_shared_with.length === 1 ? '' : 's') + ' · ' : ''}${rows.length} points${warnings ? ' · ' : ''}`, warnings ? h('a', { class: 'warn' }, `⚠ ${warnings} rows without units`) : null),
    h('div', { class: 'scrollbox' }, h('div', { class: 'scrollin', style: { overflow: 'auto', maxHeight: '320px' } }, table)));
}
function deviceConsumers(d) {
  const res = state.model.resources.canonical.find((c) => c.topic === d.resource);
  const el = h('div', { class: 'card' }, h('h4', {}, 'Consumers'));
  if (!res) { el.append(note('no resource publishes this device')); return el; }
  const aliases = res.aliases.map((t) => state.model.resources.aliases.find((a) => a.topic === t)).filter(Boolean);
  el.append(h('div', { class: 'uby' }, h('div', {}, dot(), ' resource ', uai(res.uai, { onClick: () => navigate('resources', { uai: res.topic }) }), ' ', h('a', { onClick: () => navigate('resources', { uai: res.topic }) }, 'Open ▸')),
    ...aliases.map((a) => h('div', { style: { paddingLeft: '16px' } }, h('span', { class: 'hol', style: { margin: '0 4px 0 0' } }), 'alias ', uai(a.uai, { onClick: () => navigate('resources', { alias: a.topic }) }))),
    ...res.consumers.map((c) => c.kind === 'bridge' ? h('div', {}, '⇄ bridge ', h('a', { onClick: () => navigate('bridges', { bridge: c.name }) }, c.name)) : h('div', {}, '◎ agent ', h('a', { onClick: () => navigate('agents', { identity: c.identity }) }, c.identity)))));
  return el;
}
function deviceChecks(d) {
  const checks = [[d.registry ? 'ok' : 'warn', d.registry ? 'registry exists' : 'no registry']];
  if (d.registry && !d.registry_rows) checks.push(['warn', 'the registry entry is not a CSV table']);
  if (d.registry_rows) { const sf = d.registry_rows.filter((r) => /_SF$/.test(r['Point Name'] || '')).map((r) => r['Point Name']); const refs = d.registry_rows.map((r) => r.Transform || '').join(' '); const missing = sf.filter((s) => false); checks.push(['ok', `${sf.length} scale factors`]); }
  if (!d.resource) checks.push(['warn', 'no canonical resource publishes this device']);
  if (d.driver_role && d.driver_role !== 'client' && d.registry_rows && !d.registry_rows.some((r) => (r['Data Source'] || '').toLowerCase() === 'server')) checks.push(['warn', 'a server role without Data Source = server rows']);
  return checks;
}
function remoteIdOf(d) {
  const r = d.remote_config || {};
  if (d.driver_type === 'modbus') return [r.transport_protocol || 'tcp', r.device_address || r.bind_host || '?', String(r.port || (r.transport_protocol === 'tls' ? 802 : 502)), String(r.unit_id ?? 1)];
  if (d.driver_type === 'dnp3') return ['dnp3', r.host || r.device_address || r.outstation_address || '?', String(r.port || '20000')];
  if (d.driver_type === 'ieee2030_5') return ['2030.5', r.server_url || r.host || r.bind_host || '?'];
  return [d.driver_type || '?', ...Object.values(r).filter((v) => typeof v === 'string' || typeof v === 'number').slice(0, 3).map(String)];
}
const serverWord = (type) => ({ modbus: 'slave', dnp3: 'outstation', ieee2030_5: 'server', bacnet: 'device' }[type] || 'server');
const roleLabel = (role, type) => !role || role === 'client' || role === 'master' ? 'client (master)' : `server (${role})`;
const prettify = (n) => n.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const stateEntry = (d) => null;
function download(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click(); }

// ---------------------------------------------------------------- actions
async function saveDevice(d, draft) {
  try {
    const config = draft.config;
    for (const k of Object.keys(config)) if (config[k] === null || config[k] === undefined) delete config[k];
    if (config.driver_config) seedDefaults(config.driver_config, ((state.catalog || {}).interfaces || {})[config.driver_config.driver_type || d.driver_type]);
    if (draft.topic && draft.topic !== d.topic) {
      await api.putEntry('platform.driver', `devices/${draft.topic}`, { type: 'json', data: config });
      await api.deleteEntry('platform.driver', d.entry);
      toast(`renamed to devices/${draft.topic}`, 'ok'); await refreshModel(false); navigate('devices', { topic: draft.topic }); return;
    }
    await api.putEntry('platform.driver', d.entry, { type: 'json', data: config });
    toast('saved', 'ok'); await refreshModel(false); navigate('devices', { topic: d.topic });
  } catch (e) { toast(e.message, 'err'); }
}
function deleteDevice(d) {
  const resource = d.resource ? state.model.resources.canonical.find((c) => c.topic === d.resource) : null;
  const dependents = resource ? [{ kind: 'resource', label: resource.topic, open: () => navigate('resources', { uai: resource.topic }), remove: () => removeMapping(resource.topic),
    keepNote: 'its publication topic has no device behind it any more' }, ...dependentsOf(resource)] : [];
  deleteDialog({ label: `devices/${d.topic}`, dependents, extra: note(`The registry ${d.registry || ''} is kept${d.registry_shared_with.length ? ' (shared with ' + d.registry_shared_with.join(', ') + ')' : '; delete it from the Registries list if nothing else uses it'}.`),
    onDelete: async () => { await api.deleteEntry('platform.driver', d.entry); toast('deleted', 'ok'); await refreshModel(false); navigate('devices'); } });
}
function addDevice() {
  const form = { topic: '', driver_type: Object.keys((state.catalog || {}).interfaces || {})[0] || 'modbus', registry: '' };
  dialog({ title: 'Add a device', body: h('div', {}, h('div', { class: 'grid kv1' },
    h('span', { class: 'k' }, 'Topic'), segmentsInput([], { separator: '/', onChange: (v) => (form.topic = v.join('/')) }),
    h('span', { class: 'k' }, 'Driver type'), select(form.driver_type, Object.keys((state.catalog || {}).interfaces || {}).map((i) => [i, i]), { onChange: (v) => (form.driver_type = v), width: '200px' }),
    h('span', { class: 'k' }, 'Registry'), select('', (state.model.registries || []).map((r) => [r.name, r.name.replace('registry_configs/', '')]), { blank: 'new, named after the topic', onChange: (v) => (form.registry = v), width: '320px' })),
    note('Creates the device entry (and an empty registry when none is chosen). Discover, which scans a unit and generates the registry, format and resource, is not wired to a generator yet.')),
    actions: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Create', primary: true, onClick: async (close) => {
      if (!form.topic) return toast('a topic is required', 'err');
      try {
        const registry = form.registry || `registry_configs/${form.topic.split('/').pop()}.csv`;
        if (!form.registry) await api.putEntry('platform.driver', registry, { type: 'csv', text: 'Point Name,Address,Data Type,Writable,Data Source,Units\n' });
        await api.putEntry('platform.driver', `devices/${form.topic}`, { type: 'json', data: { registry_config: `config://${registry}`, driver_config: seedDefaults({ driver_type: form.driver_type, driver_role: 'client' }, ((state.catalog || {}).interfaces || {})[form.driver_type]), driver_type: form.driver_type } });
        close(); toast('device created', 'ok'); await refreshModel(false); navigate('devices', { topic: form.topic, edit: 1 });
      } catch (e) { toast(e.message, 'err'); } } }] });
}
function switchRegistry(d) {
  let chosen = d.registry || '';
  dialog({ title: 'Switch registry', width: 520, body: h('div', {}, select(chosen, (state.model.registries || []).map((r) => [r.name, r.name.replace('registry_configs/', '')]), { onChange: (v) => (chosen = v), width: '100%' }), note('The current registry stays for the devices that still use it.')),
    actions: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Switch', primary: true, onClick: async (close) => { try { const cfg = { ...d.config, registry_config: `config://${chosen}` }; await api.putEntry('platform.driver', d.entry, { type: 'json', data: cfg }); close(); toast('switched', 'ok'); await refreshModel(false); } catch (e) { toast(e.message, 'err'); } } }] });
}
function copyRegistry(d) {
  if (!d.registry_rows) return toast('no CSV registry to copy', 'err');
  let name = d.registry.replace(/\.csv$/, '') + '_copy.csv';
  dialog({ title: 'Copy registry as new', width: 520, body: h('div', {}, input(name, { mono: true, width: '100%', onChange: (v) => (name = v) }), note('The device switches to the copy; the original stays.')),
    actions: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Copy', primary: true, onClick: async (close) => { try { const entry = await api.entry('platform.driver', d.registry); await api.putEntry('platform.driver', name, { type: 'csv', text: entry.text }); await api.putEntry('platform.driver', d.entry, { type: 'json', data: { ...d.config, registry_config: `config://${name}` } }); close(); toast('copied', 'ok'); await refreshModel(false); } catch (e) { toast(e.message, 'err'); } } }] });
}
function importRegistry(d) {
  const file = h('input', { type: 'file', accept: '.csv,.json,text/csv,application/json' });
  dialog({ title: 'Import registry', width: 520, body: h('div', {}, file, note(' CSV or JSON. Replaces the rows of the device\'s registry.')),
    actions: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Import', primary: true, onClick: async (close) => {
      const f = file.files && file.files[0]; if (!f) return toast('choose a file', 'err');
      try { const text = await f.text(); const isJson = f.name.endsWith('.json') || text.trim().startsWith('[');
        const name = d.registry || `registry_configs/${d.topic.split('/').pop()}.csv`;
        await api.putEntry('platform.driver', name, isJson ? { type: 'csv', data: JSON.parse(text) } : { type: 'csv', text });
        if (!d.registry) await api.putEntry('platform.driver', d.entry, { type: 'json', data: { ...d.config, registry_config: `config://${name}` } });
        close(); toast('imported', 'ok'); await refreshModel(false); } catch (e) { toast(e.message, 'err'); } } }] });
}
async function exportRegistry(d) {
  if (!d.registry) return toast('no registry', 'err');
  const entry = await api.entry('platform.driver', d.registry);
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([entry.text], { type: 'text/csv' })); a.download = d.registry.split('/').pop(); a.click();
}
async function deleteRegistry(name) { try { await api.deleteEntry('platform.driver', name); toast('deleted', 'ok'); await refreshModel(false); } catch (e) { toast(e.message, 'err'); } }


// Discover (design DS1/DS2): Source asks for what the generator needs; Review is read-only; the result is one pending set.
function discoverDialog() {
  const form = { protocol: 'sunspec', source: 'unit', host: '', port: '', unit: 1, role: 'client', scaling: 'transform', topic: '', publish: 'multi', interval: '', registry_name: '', file: null, device_format: '' };
  const where = h('div', { class: 'grid kv1' });
  const fileInput = () => h('input', { type: 'file', accept: '.json', onChange: (e) => (form.file = e.target.files[0]) });
  const renderWhere = () => {
    where.replaceChildren(h('span', { class: 'k' }, 'Protocol'), select(form.protocol, [['sunspec', 'SunSpec (Modbus)'], ['dnp3', 'DNP3 (IEEE 1815.2 profile)'], ['ieee2030_5', 'IEEE 2030.5 (mirror of a device)']], { onChange: (v) => { form.protocol = v; renderWhere(); }, width: '260px' }));
    if (form.protocol === 'sunspec') {
      where.append(h('span', { class: 'k' }, 'Source'), radios('disc-src', form.source, [['unit', 'a reachable unit'], ['file', 'a pysunspec2 scan file']], (v) => { form.source = v; renderWhere(); }));
      if (form.source === 'unit') where.append(
        h('span', { class: 'k' }, 'Address'), input(form.host, { mono: true, width: '220px', placeholder: '192.168.1.20', onChange: (v) => (form.host = v) }),
        h('span', { class: 'k' }, 'Port · unit'), h('span', { style: { display: 'flex', gap: '8px' } }, input(form.port, { num: true, width: '90px', placeholder: '502', onChange: (v) => (form.port = v) }), input(form.unit, { num: true, width: '70px', onChange: (v) => (form.unit = v) })));
      else where.append(h('span', { class: 'k' }, 'Scan file'), fileInput());
      where.append(h('span', { class: 'k' }, 'Role'), radios('disc-role', form.role, [['client', 'client (master)'], ['server', 'server (slave)']], (v) => (form.role = v)),
        h('span', { class: 'k' }, 'Scale factors ', info("transform: the device format's transform applies the scale factors; driver: each point scales itself with scale_sf() in its Transform column.")),
        select(form.scaling, [['transform', 'transform'], ['driver', 'driver']], { onChange: (v) => (form.scaling = v), width: '200px' }));
    }
    if (form.protocol === 'dnp3') where.append(
      h('span', { class: 'k' }, 'Profile ', info('An IEEE 1815.2 device profile (JSON) from the test tool or the vendor.')), fileInput(),
      h('span', { class: 'k' }, 'Outstation'), h('span', { style: { display: 'flex', gap: '8px' } }, input(form.host, { mono: true, width: '180px', placeholder: '127.0.0.1', onChange: (v) => (form.host = v) }), input(form.port, { num: true, width: '90px', placeholder: '20000', onChange: (v) => (form.port = v) })),
      h('span', { class: 'k' }, 'Role'), radios('disc-role', form.role, [['client', 'client (master)'], ['server', 'server (outstation)']], (v) => (form.role = v)));
    if (form.protocol === 'ieee2030_5') where.append(
      h('span', { class: 'k' }, 'Device to mirror ', info('The 2030.5 point map is derived from the format of the resource another device publishes.')),
      select('', state.model.devices.filter((d) => d.resource).map((d) => [d.topic, d.topic]), { blank: 'choose…', width: '320px', onChange: (v) => { const d = state.model.devices.find((x) => x.topic === v); const res = d && state.model.resources.canonical.find((c) => c.topic === d.resource); form.device_format = res ? res.format : ''; } }),
      h('span', { class: 'k' }, 'Server URL'), input(form.host, { mono: true, width: '280px', placeholder: 'https://127.0.0.1:8443', onChange: (v) => (form.host = v) }),
      h('span', { class: 'k' }, 'Role'), radios('disc-role', form.role, [['client', 'client'], ['server', 'server']], (v) => (form.role = v)));
  };
  renderWhere();
  const becomes = h('div', { class: 'grid kv1' },
    h('span', { class: 'k' }, 'Topic ', info("Free-form. It names the device entry and the resource's RPC topic; with devices/ in front it is the UAI of the resource the device publishes.")), input('', { mono: true, width: '100%', placeholder: 'site1/feeder1/pv_inverter', onChange: (v) => (form.topic = v) }),
    h('span', { class: 'k' }, 'Publishes'), radios('disc-pub', form.publish, [['all', 'all'], ['multi', 'multi']], (v) => (form.publish = v)),
    h('span', { class: 'k' }, 'Interval'), h('span', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, input('', { num: true, width: '90px', placeholder: '60', onChange: (v) => (form.interval = v) }), note('s')),
    h('span', { class: 'k' }, 'Registry name'), input('', { mono: true, width: '100%', placeholder: 'registry_configs/<last topic segment>.csv', onChange: (v) => (form.registry_name = v) }));
  const body = h('div', {}, h('div', { class: 'steps' }, h('span', { class: 'on' }, '1 Source'), h('span', {}, '2 Review')),
    h('div', { class: 'two', style: { gap: '24px' } }, h('div', {}, h('h3', { style: { marginTop: 0 } }, 'Where it comes from'), where), h('div', {}, h('h3', { style: { marginTop: 0 } }, 'What it becomes'), becomes)));
  const close = dialog({ title: 'Discover a device', width: 900, body, actions: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Scan and review ▸', primary: true, onClick: async () => {
    if (!form.topic) return toast('a topic is required', 'err');
    const options = { topic: form.topic, publish: form.publish, role: form.role, scaling: form.scaling };
    if (form.interval) options.interval = Number(form.interval);
    if (form.registry_name) options.registry_name = form.registry_name;
    if (form.protocol === 'sunspec') {
      if (form.source === 'file') { if (!form.file) return toast('choose a scan file', 'err'); options.device_json = await form.file.text(); }
      else { if (!form.host) return toast('an address is required', 'err'); options.host = form.host; options.port = Number(form.port) || 502; options.unit = Number(form.unit) || 1; }
    }
    if (form.protocol === 'dnp3') { if (!form.file) return toast('choose a profile', 'err'); options.profile_json = await form.file.text(); if (form.host) options.outstation_ip = form.host; if (form.port) options.port = Number(form.port); }
    if (form.protocol === 'ieee2030_5') { if (!form.device_format) return toast('choose the device to mirror', 'err'); options.device_format = form.device_format; if (form.host) options.server_url = form.host; }
    toast('scanning…');
    try { const result = await api.discover(form.protocol, options); close(); reviewDialog(result, form); } catch (e) { toast(`discovery failed: ${e.message}`, 'err'); }
  } }] });
}

function reviewDialog(result, form) {
  const entries = result.entries || [];
  const registry = entries.find((e) => e.type === 'csv');
  const rows = (registry && registry.data) || [];
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const grid = h('table', {}, h('tr', {}, ...columns.map((c) => h('th', { title: c === displayColumn(c, columns) ? undefined : `${c} in the file` }, displayColumn(c, columns)))), ...rows.slice(0, 300).map((r) => h('tr', {}, ...columns.map((c) => h('td', { class: /name|address|index/i.test(c) ? 'mono' : '' }, String(r[c] ?? ''))))));
  const identity = Object.entries(result.identity || {}).map(([k, v]) => `${k} ${v}`).join(' · ');
  const summary = h('div', { class: 'note', style: { marginBottom: '8px' } }, identity ? `${identity} · ` : '', result.models ? `models ${result.models.join(', ')} · ` : '', `${result.points ?? rows.length} points`);
  if (result.remote_id) summary.append(' · device UAI ', uai(result.remote_id, { size: 'small' }));
  dialog({ title: 'Discover a device', width: 900, body: h('div', {},
    h('div', { class: 'steps' }, h('span', {}, `1 Source · ${form.protocol} · ${result.source || ''} · ${form.role} · ${form.publish}`), h('span', { class: 'on' }, '2 Review')),
    summary,
    h('h3', {}, 'Will create as one pending set'),
    h('table', {}, h('tr', {}, h('th', {}, 'identity'), h('th', {}, 'entry'), h('th', {}, 'content')), ...entries.map((e) => h('tr', {}, h('td', {}, e.identity), h('td', { class: 'mono' }, e.name), h('td', {}, e.summary || e.type)))),
    h('h3', {}, 'Registry ', note('· read-only here; edit it on the device after applying')),
    h('div', { style: { overflow: 'auto', maxHeight: '240px', border: '1px solid var(--line)', borderRadius: '6px' } }, grid),
    (result.notes || []).length ? h('div', { class: 'note', style: { marginTop: '8px' } }, 'Notes: ', (result.notes || []).join(' · ')) : null),
    actions: [{ label: '◂ Back', onClick: (c) => { c(); discoverDialog(); } }, { label: 'Add to pending changes ▸', primary: true, onClick: async (c) => {
      try {
        for (const e of entries) if (e.identity === 'platform.driver' && e.data && e.data.driver_config) seedDefaults(e.data.driver_config, ((state.catalog || {}).interfaces || {})[e.data.driver_config.driver_type || e.data.driver_type]);
        await api.addPending(entries); toast('added to the pending set', 'ok'); c(); await refreshModel(false); navigate('pending'); } catch (e) { toast(e.message, 'err'); }
    } }] });
}
