// Formats: grouped by role in the graph (hubs, bus formats, devices, agents) or by standard; the format card.
import { api } from '../api.js';
import { h, dot, tag, kind, note, btn, mb, card, section, kv, toast } from '../ui.js';
import { state, navigate, collapseHandle } from '../app.js';
import { rawEditor, menu, checksCard } from './common.js';

export const title = 'Formats';
export const railBadges = (s) => [h('span', { class: 'pill n' }, String(s.model.formats.length))];
let groupBy = localStorage.getItem('rc:fmtgroup') || 'role';

export function render({ side, main, ctx, params }) {
  const formats = state.model.formats;
  const selected = formats.find((f) => f.name === params.name) || formats[0];
  if (side) {
    side.append(h('h3', { class: 'ph' }, 'Formats', h('span', { class: 'sp' }), collapseHandle('side')),
      h('div', { class: 'seg' }, h('span', { class: groupBy === 'role' ? 'on' : '', onClick: () => { groupBy = 'role'; localStorage.setItem('rc:fmtgroup', groupBy); navigate('formats', { name: selected && selected.name }); } }, 'by role'),
        h('span', { class: groupBy === 'standard' ? 'on' : '', onClick: () => { groupBy = 'standard'; localStorage.setItem('rc:fmtgroup', groupBy); navigate('formats', { name: selected && selected.name }); } }, 'by standard')),
      h('div', { class: 'bar', style: { margin: '0 0 6px' } }, btn('+ Format', addFormat, { primary: true })));
    const groups = new Map();
    const label = (f) => groupBy === 'role' ? ({ hub: 'Hubs', bus: 'Bus formats', device: 'Devices', other: 'Agents' }[f.kind] || 'Other') : f.standard;
    for (const f of formats) { const g = label(f); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(f); }
    const tree = h('div', { class: 'ftree' });
    for (const [g, items] of groups) { tree.append(h('div', { class: 'grp' }, g, ' ', h('span', { class: 'n' }, String(items.length))));
      for (const f of items) tree.append(h('div', { class: `row1${selected && f.name === selected.name ? ' sel' : ''}`, onClick: () => navigate('formats', { name: f.name }) }, dot(), f.name, f.kind === 'device' && f.devices.length ? tag(f.devices[0]) : null)); }
    side.append(tree);
  }
  if (!selected) { main.append(h('div', { class: 'empty' }, 'No formats.')); return; }
  const f = selected;
  const edges = state.model.transforms.filter((t) => t.input === f.name || t.output === f.name);
  main.append(card({ title: h('span', { style: { fontSize: '18px', fontWeight: 600 } }, f.name), badge: kind(f.kind === 'bus' ? 'bus format' : f.kind),
    boxes: [mb('standard', f.standard), mb('declared', f.declared ? 'in the service config' : 'bundled or implied'), f.proto ? mb('proto', f.proto) : null, f.fields ? mb('fields', String(f.fields)) : null],
    buttons: [btn('Raw JSON', () => rawEditor('platform.presentation', 'config')), btn('⋯', (e) => menu(e.target, [{ header: 'Layout' }, { layout: true }]))],
    sections: [
      section('Edges', edges.length ? h('table', {}, h('tr', {}, h('th', {}, 'from'), h('th', {}, 'to'), h('th', {}, 'kind'), h('th', {})), ...edges.map((t) => h('tr', {}, h('td', {}, t.input), h('td', {}, t.output), h('td', {}, t.kind), h('td', {}, h('a', { onClick: () => navigate('transforms', { input: t.input, output: t.output }) }, 'transform ▸')))))
        : note('no local transforms touch this format; bundled edges are listed once the service exports list_formats and describe_transform'), { note: 'local transforms declared in the service config', actions: [btn('+ Edge', () => navigate('transforms', { input: f.name, new: 1 }))] }),
      section('Used by', h('div', { class: 'uby' }, ...f.resources.map((r) => h('div', {}, 'resource ', h('a', { onClick: () => navigate('resources', state.model.resources.aliases.some((a) => a.topic === r) ? { alias: r } : { uai: r }) }, r))), ...f.devices.map((d) => h('div', {}, 'device ', h('a', { onClick: () => navigate('devices', { topic: d }) }, d))), f.resources.length || f.devices.length ? null : note('nothing yet')), { note: `${f.resources.length} resources · ${f.devices.length} devices` })] }));
  if (ctx) ctx.append(h('h3', { class: 'ph' }, collapseHandle('ctx'), h('span', { class: 'sp' })), checksCard([f.kind === 'device' && !f.declared ? ['warn', 'a device format that is not declared in the service config'] : ['ok', `${f.kind} format`]]),
    h('div', { class: 'card' }, h('h4', {}, 'Graph'), note('Edge reports and the field universe need the service RPCs list_formats, describe_transform and edge_report, which are not exported yet.')));
}
function addFormat() {
  let name = '', fields = '';
  const dlg = h('div', { class: 'grid kv1' }, h('span', { class: 'k' }, 'Name'), h('input', { class: 'in', onChange: (e) => (name = e.target.value) }), h('span', { class: 'k' }, 'Fields'), h('textarea', { class: 'in mono', style: { minHeight: '120px' }, placeholder: 'one field per line', onChange: (e) => (fields = e.target.value) }));
  import('../ui.js').then(({ dialog }) => dialog({ title: 'Declare a format by hand', body: h('div', {}, dlg, note('A device format: a leaf whose fields are its point names. OpenFMB profiles and registry-derived formats come with Discover.')),
    actions: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Save', primary: true, onClick: async (close) => { if (!name) return toast('a name is required', 'err');
      try { const entry = await api.entry('platform.presentation', 'config').catch(() => ({ data: {} })); const data = { ...(entry.data || {}) }; data.formats = { ...(data.formats || {}), [name]: { hub: false, fields: fields.split('\n').map((s) => s.trim()).filter(Boolean) } };
        await api.putEntry('platform.presentation', 'config', { type: 'json', data }); close(); toast('declared', 'ok'); navigate('formats', { name }); } catch (e) { toast(e.message, 'err'); } } }] }));
}
