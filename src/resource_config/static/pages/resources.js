// Resources, the home page: the clade tree, the canonical card (R1 stacked / R3 tabs), the alias card (R2), Add alias.
import { api } from '../api.js';
import { h, uai, dot, hollow, tag, kind, note, btn, mb, card, section, kv, steps, meter, dialog, toast, input, select, radios, checkbox, info, labelled, segmentsInput } from '../ui.js';
import { state, navigate, refreshModel, collapseHandle } from '../app.js';
import { rawEditor, menu, healthCard, checksCard, consumersCard, updateServiceConfig, formatOptions, deleteDialog, dependentsOf, chainReport } from './common.js';

export const title = 'Resources';
export const railBadges = (s) => [h('span', { class: 'pill n' }, String(s.model.resources.canonical.length))];
const HUBS = ['61850', 'sunspec', '2030.5', '1815.2.inputs', '1815.2.outputs', '1547', 'openfmb.ess', 'openfmb.solar'];
let focus = localStorage.getItem('rc:resfocus') || 'canonical';

export function render({ side, main, ctx, params }) {
  const model = state.model;
  const canonical = model.resources.canonical, aliases = model.resources.aliases;
  const selectedTopic = params.alias || params.uai || (canonical[0] && canonical[0].topic);
  const alias = params.alias ? aliases.find((a) => a.topic === params.alias) : null;
  const resource = alias ? canonical.find((c) => c.topic === alias.canonical) : canonical.find((c) => c.topic === selectedTopic);
  if (side) side.append(tree(canonical, aliases, alias ? alias.topic : (resource && resource.topic)));
  if (alias) renderAlias(main, ctx, alias, resource);
  else if (resource) renderCanonical(main, ctx, resource, aliases);
  else main.append(h('div', { class: 'empty' }, 'No resources are configured. ', btn('+ Resource', () => addResource())));
}

// ---------------------------------------------------------------- left pane
function tree(canonical, aliases, selected) {
  const el = h('div', {});
  el.append(h('h3', { class: 'ph' }, 'Resources', h('span', { class: 'sp' }), collapseHandle('side')));
  const filter = input('', { placeholder: 'filter', width: '100%', onChange: () => {} });
  filter.addEventListener('input', () => { for (const c of el.querySelectorAll('.clade')) c.classList.toggle('hidden', filter.value && !c.textContent.toLowerCase().includes(filter.value.toLowerCase())); });
  el.append(h('div', { style: { marginBottom: '8px' } }, filter));
  el.append(h('div', { class: 'seg' }, h('span', { class: focus === 'canonical' ? 'on' : '', onClick: () => { focus = 'canonical'; localStorage.setItem('rc:resfocus', focus); refreshModel(false); } }, '● canonical · by source'),
    h('span', { class: focus === 'aliases' ? 'on' : '', onClick: () => { focus = 'aliases'; localStorage.setItem('rc:resfocus', focus); refreshModel(false); } }, '○ aliases · by target')));
  const t2 = h('div', { class: `t2${focus === 'aliases' ? ' rt' : ''}` });
  if (focus === 'canonical') {
    const groups = { device: 'Devices', agent: 'Agents', remote_bus: 'Remote buses', unknown: 'Without a source' };
    for (const [key, label] of Object.entries(groups)) {
      const items = canonical.filter((c) => (c.source || {}).kind === key);
      if (!items.length) continue;
      t2.append(h('div', { class: 'grp' }, label, ' ', h('span', { class: 'n' }, String(items.length))));
      for (const c of items) {
        const clade = h('div', { class: `clade${selected === c.topic || c.aliases.includes(selected) ? ' sel' : ''}` });
        clade.append(h('div', { class: `canon${selected === c.topic ? ' on' : ''}` }, dot(c.consumers.length || c.aliases.length ? 'ok' : 'warn'), uai(c.uai, { onClick: () => navigate('resources', { uai: c.topic }) }), tag(key.replace('_', ' '))));
        c.aliases.forEach((topic, i) => { const a = aliases.find((x) => x.topic === topic); if (!a) return;
          clade.append(h('div', { class: `alias${i === c.aliases.length - 1 ? ' last' : ''}${selected === topic ? ' on' : ''}` }, hollow(a.deliveries.length ? 'ok' : 'warn'), uai(a.uai, { onClick: () => navigate('resources', { alias: a.topic }) }))); });
        if (!c.consumers.length && !c.aliases.length) clade.append(h('div', { class: 'note', style: { paddingLeft: '14px' } }, '⚠ nothing consumes it'));
        t2.append(clade);
      }
    }
  } else {
    const byTarget = new Map();
    for (const a of aliases) {
      const keys = a.deliveries.length ? a.deliveries.map((d) => d.kind === 'remote_topic' ? `remote topics · ${d.bus}` : d.kind === 'local_topic' ? 'local bus topics' : 'devices') : ['no delivery'];
      for (const k of new Set(keys)) { if (!byTarget.has(k)) byTarget.set(k, []); byTarget.get(k).push(a); }
    }
    for (const [label, items] of byTarget) {
      t2.append(h('div', { class: 'grp', style: { justifyContent: 'flex-end' } }, label, ' ', h('span', { class: 'n' }, String(items.length))));
      const byCanonical = new Map();
      for (const a of items) { if (!byCanonical.has(a.canonical)) byCanonical.set(a.canonical, []); byCanonical.get(a.canonical).push(a); }
      for (const [canon, list] of byCanonical) {
        const clade = h('div', { class: `clade${list.some((a) => a.topic === selected) ? ' sel' : ''}` });
        list.forEach((a, i) => clade.append(h('div', { class: `alias${i === list.length - 1 ? ' last' : ''}${selected === a.topic ? ' on' : ''}` }, uai(a.uai.slice(-2), { onClick: () => navigate('resources', { alias: a.topic }) }), hollow())));
        const c = canonical.find((x) => x.topic === canon);
        clade.append(h('div', { class: 'canon' }, note('of'), uai(c ? c.uai : ['?'], { onClick: () => c && navigate('resources', { uai: c.topic }) }), dot()));
        t2.append(clade);
      }
    }
  }
  el.append(t2, h('div', { class: 'legend' }, h('span', {}, dot(), ' canonical'), h('span', {}, hollow(), ' alias')),
    h('div', { class: 'bar' }, btn('+ Resource', addResource), btn('+ Alias', () => selected && addAlias(canonical.find((c) => c.topic === selected || c.aliases.includes(selected))))));
  return el;
}

// ---------------------------------------------------------------- canonical card
function renderCanonical(main, ctx, c, aliases) {
  const source = c.source || {}, device = source.kind === 'device' ? state.model.devices.find((d) => d.topic === source.device) : null;
  const sections = [];
  const sourceBody = source.kind === 'device' ? kv([
    ['Device topic', h('span', { class: 'mono' }, `devices/${source.device}`)], ['Driver', `${source.driver_type || '?'} · ${roleLabel(source.driver_role)}`],
    ['Publishes', h('span', {}, h('span', { class: 'mono' }, `…/${source.publishes}`), source.interval ? ` · every ${source.interval} s` : '')], ['Writes', 'RPC on the device topic'],
    ['Encoding', h('span', {}, c.encoding, ' ', note('· the driver publishes JSON; another encoding is an alias'))], ['Registry', device && device.registry ? h('a', { onClick: () => navigate('devices', { topic: device.topic }) }, device.registry.replace('registry_configs/', '')) : '—']], 2)
    : source.kind === 'agent' ? kv([['Agent', h('a', { onClick: () => navigate('agents', { identity: source.identity }) }, source.identity)], ['Publishes', h('span', { class: 'mono' }, source.publication_topic || '—')], ['Encoding', c.encoding]], 2)
    : kv([['Publication topic', h('span', { class: 'mono' }, c.publication_topic || '—')], ['RPC topic', h('span', { class: 'mono' }, c.rpc_topic || '—')], ['Owner', c.owner || '—']], 2);
  const sourceTitle = source.kind === 'device' ? 'a device of the platform driver' : source.kind === 'agent' ? 'an agent' : 'no device or agent matches the publication topic';
  const sourceSection = section('Source', sourceBody, { note: sourceTitle, actions: device ? [btn('Open device ▸', () => navigate('devices', { topic: device.topic }))] : [] });
  const aliasRows = h('div', {}, ...c.aliases.map((topic) => { const a = aliases.find((x) => x.topic === topic); if (!a) return null;
    return h('div', { class: 'arow2' }, hollow(a.deliveries.length ? 'ok' : 'warn'), uai(a.uai, { onClick: () => navigate('resources', { alias: a.topic }) }), h('a', { onClick: () => navigate('resources', { alias: a.topic }) }, 'Open ▸'),
      h('div', { class: 'l2' }, h('span', { class: 'f' }, a.format), h('span', {}, wireText(a)), ...a.deliveries.map((d) => h('span', { class: 'd' }, deliveryText(d))), a.deliveries.length ? null : h('span', { class: 'd warn' }, 'no delivery'))); }),
    c.aliases.length ? null : note('No aliases: everything consumes the canonical form.'));
  const aliasSection = section('Aliases', aliasRows, { note: `${c.aliases.length} · other forms of this resource, each for something that consumes it`, actions: [btn('+ Alias', () => addAlias(c), { primary: true })] });
  const paramRows = Object.entries(c.parameters || {});
  const paramsSection = section('Static parameters', () => paramRows.length ? h('table', {}, h('tr', {}, h('th', {}, 'key'), h('th', {}, 'value')), ...paramRows.map(([k, v]) => h('tr', {}, h('td', { class: 'mono' }, k), h('td', { class: 'mono' }, String(v))))) : note('none'),
    { collapsed: state.layout === 'tabs' ? null : true, open: true, note: paramRows.length ? `${paramRows.map(([k]) => k).join(', ')} · set here so the aliases inherit them` : 'none' });
  // In the tabbed layout a tab is the section, so it is never collapsed; stacked, the sections fold but start open.
  const consumersSection = section('Consumers', () => consumersCard(c.consumers, state.model).querySelector('.uby'), { collapsed: state.layout === 'tabs' ? null : true, open: true, note: consumersSummary(c.consumers) });
  const buttons = [btn('Edit', () => resourceDialog(c)), btn('Raw JSON', () => rawEditor('platform.presentation', 'config')),
    btn('⋯', (e) => menu(e.target, [{ header: 'Layout' }, { layout: true }, { header: 'This resource' }, { label: 'Export entry (JSON)', onClick: () => exportResource(c) }, { label: 'Check references', onClick: checkReferences },
      ...(device ? [{ header: 'Device' }, { label: 'Open device ▸', onClick: () => navigate('devices', { topic: device.topic }) }] : []),
      { label: 'Delete…', danger: true, note: c.aliases.length || c.consumers.length ? `${c.aliases.length} aliases, ${c.consumers.length} consumers depend on it` : undefined, onClick: () => deleteResource(c) }]))];
  const header = { title: uai(c.uai, { box: false }), badge: kind('canonical'), boxes: [mb('format', c.format || '—'), mb('owner', c.owner || '—')], buttons };
  if (state.layout === 'tabs') {
    const tabs = [['Overview', () => h('div', {}, sourceSection, glance(c))], ['Aliases', () => aliasSection], ['Parameters', () => paramsSection], ['Consumers', () => consumersSection], ['JSON', () => h('div', { class: 'rsec' }, h('pre', { class: 'mono' }, JSON.stringify(c.raw, null, 2)))]];
    const body = h('div', {}); let active = 0;
    // Only the tab spans themselves: the count badges inside them are spans too and would shift the highlight.
    const bar = h('div', { class: 'ctabs' }, ...tabs.map(([label], i) => h('span', { class: i === 0 ? 'on' : '', onClick: (e) => { active = i; [...bar.children].forEach((s, j) => s.classList.toggle('on', j === i)); body.replaceChildren(tabs[i][1]()); } }, label,
      label === 'Aliases' ? h('span', { class: 'n' }, String(c.aliases.length)) : label === 'Consumers' ? h('span', { class: 'n' }, String(c.consumers.length)) : null)));
    body.append(tabs[0][1]());
    main.append(card({ ...header, sections: [bar, body] }));
  } else {
    main.append(card({ ...header, sections: [sourceSection, aliasSection, paramsSection, consumersSection] }));
  }
  if (ctx) ctx.append(h('h3', { class: 'ph' }, collapseHandle('ctx'), h('span', { class: 'sp' })), healthFor(c, device), checksCard(checksFor(c, aliases)));
}
function glance(c) {
  return section('At a glance', h('div', { class: 'tiles' },
    tile('Aliases', c.aliases.length, c.aliases.length ? 'open the Aliases tab' : 'none'),
    tile('Parameters', Object.keys(c.parameters || {}).length, Object.keys(c.parameters || {}).join(', ') || 'none'),
    tile('Consumers', c.consumers.length, consumersSummary(c.consumers))));
}
const tile = (title, big, text) => h('div', { class: 'tile' }, h('h6', {}, title), h('div', { class: 'big' }, String(big)), note(text));
function consumersSummary(consumers) {
  const bridges = consumers.filter((c) => c.kind === 'bridge').length, agents = consumers.filter((c) => c.kind === 'agent').length;
  return consumers.length ? `${bridges} bridge${bridges === 1 ? '' : 's'} · ${agents} agent${agents === 1 ? '' : 's'} · derived from the store` : 'nothing yet';
}
function healthFor(c, device) {
  const driver = (state.model.agents || []).find((a) => a.identity === (c.owner || 'platform.driver'));
  const rows = [];
  if (device) rows.push(['driver', driver ? (driver.running ? '● running' : '○ stopped') : '—', driver && driver.running ? 'ok' : 'warn'],
    ['driver health', driver && driver.health && driver.health.status ? driver.health.status : '—', driver && driver.health && driver.health.status === 'GOOD' ? 'ok' : ''],
    ['interval', device.interval ? `${device.interval} s` : 'driver default'], ['points', device.registry_rows ? String(device.registry_rows.length) : '—']);
  else if (c.source && c.source.kind === 'agent') rows.push(['agent', driver ? (driver.running ? '● running' : '○ stopped') : 'not installed', driver && driver.running ? 'ok' : 'warn']);
  else rows.push(['source', 'unknown', 'warn']);
  return healthCard(rows);
}
function checksFor(c, aliases) {
  const checks = [];
  const source = c.source || {};
  if (source.kind === 'device') {
    const pub = c.publication_topic || '';
    checks.push([pub.endsWith('/' + source.publishes) ? 'ok' : 'warn', pub.endsWith('/' + source.publishes) ? `publication topic matches the device's publish mode (${source.publishes})` : `publication topic ${pub} does not match the device's publish mode (${source.publishes})`]);
  } else if (source.kind === 'unknown') checks.push(['warn', 'no device entry publishes on the publication topic']);
  for (const topic of c.aliases) { const a = aliases.find((x) => x.topic === topic); if (a && !a.deliveries.length) checks.push(['warn', `alias ${a.format} has no delivery`]); if (a && a.encoding === 'protobuf' && !a.edition && !defaultEdition()) checks.push(['warn', `alias ${a.format} is protobuf without an edition`]); }
  if (!c.aliases.length && !c.consumers.length) checks.push(['warn', 'nothing consumes this resource']);
  return checks;
}
const roleLabel = (role) => !role || role === 'client' || role === 'master' ? 'client (master)' : `server (${role})`;
function deliveryText(d) {
  if (d.kind === 'remote_topic') return `${d.direction === 'outbound' ? '⇈ delivered to' : '⇊ delivered from'} ${d.bus} · ${d.direction === 'outbound' ? 'local → remote' : 'remote → local'}`;
  if (d.kind === 'local_topic') return `◎ published on the local bus by bridge ${d.bridge}`;
  if (d.kind === 'device') return `⇄ writes device ${d.target} (bridge ${d.bridge})`;
  return JSON.stringify(d);
}

// ---------------------------------------------------------------- alias card
function renderAlias(main, ctx, a, c) {
  const resolveBox = h('div', {}, note('resolving…'));
  api.resolve(a.uai, a.format, a.deliveries.some((d) => d.kind === 'device') ? 'write' : 'read').then((r) => {
    resolveBox.replaceChildren(steps(r.path || [], Object.fromEntries((r.path || []).map((f) => [f, HUBS.includes(f) ? 'hub' : f === (r.path || [])[0] ? 'source format' : f === a.format ? 'this alias' : 'bundled']))),
      h('div', { class: 'tiles' },
        h('div', { class: 'tile' }, h('h6', {}, 'Retention'), h('div', { class: 'big' }, r.retention != null ? `${Math.round(r.retention * 100)} %` : '—'), meter(r.retention), note(`${(r.path || []).length ? (r.path || []).length - 1 : 0} hops`), h('a', { class: 'rep', onClick: () => chainReport((r.path || [])[0] || a.format, (r.path || []).slice(-1)[0] || a.format) }, 'per hop and per field ▸')),
        h('div', { class: 'tile' }, h('h6', {}, 'Formats'), h('div', {}, `${r.data_format || '?'} → ${r.target_format || a.format}`), note('as the service resolves this alias')),
        h('div', { class: 'tile' }, h('h6', {}, 'Wire'), h('div', {}, h('b', {}, a.encoding), editionOf(a) ? ` · edition ${editionOf(a)}` : ''), note(r.codec ? `proto ${r.codec.proto || JSON.stringify(r.codec)}` : 'json on the local bus'))));
  }).catch((e) => resolveBox.replaceChildren(h('div', { class: 'warn' }, `The service could not resolve this alias: ${e.message}`)));
  const deliveries = h('div', {}, ...a.deliveries.map((d) => h('div', { class: 'arow2', style: { gridTemplateColumns: '18px minmax(0,1fr) auto' } }, h('span', {}, d.kind === 'remote_topic' ? (d.direction === 'outbound' ? '⇈' : '⇊') : d.kind === 'device' ? '⇄' : '◎'),
    h('span', {}, h('b', {}, d.kind.replace('_', ' ')), ' · ', deliveryText(d)), d.bridge ? h('a', { onClick: () => navigate('bridges', { bridge: d.bridge }) }, 'Open ▸') : d.kind === 'remote_topic' ? h('a', { onClick: () => navigate('bridges', { topic: d.topic }) }, 'Open ▸') : null)),
    a.deliveries.length ? null : note('Nothing carries this alias yet. Agents that use the resource library resolve it themselves and need no delivery.'));
  const params = Object.entries({ ...(c ? c.parameters : {}), ...(a.parameters || {}) });
  const paramTable = h('table', { style: { maxWidth: '640px' } }, h('tr', {}, h('th', {}, 'key'), h('th', {}, 'value here'), h('th', {}, 'from canonical')),
    ...params.map(([k]) => h('tr', {}, h('td', { class: 'mono' }, k), h('td', { class: 'mono' }, a.parameters && k in a.parameters ? String(a.parameters[k]) : h('span', { class: 'note' }, '—')), h('td', { class: 'mono' }, c && k in (c.parameters || {}) ? String(c.parameters[k]) : h('span', { class: 'note' }, '—')))));
  const sections = [
    section('Form', kv([['Format', a.format], ['Encoding · edition', wireText(a)], ['Published as', h('span', { class: 'mono' }, a.topic, ' ', note('· the UAI joined with the bus delimiter'))]], 2), { note: 'what this alias presents the resource as' }),
    section('Canonical resource', c ? h('div', { class: 'subcard' }, dot(), uai(c.uai, { box: false, onClick: () => navigate('resources', { uai: c.topic }) }), kind('canonical'), note(`${c.format} · ${c.source && c.source.kind === 'device' ? 'device ' + c.source.device : c.owner}`), h('span', { class: 'sp' }), btn('Open ▸', () => navigate('resources', { uai: c.topic })))
      : h('div', { class: 'warn' }, `dangling: references ${a.references.join('/')}, which is not a canonical resource`), { note: 'what this is a form of' }),
    section('Delivered to', deliveries, { note: `${a.deliveries.length} · what carries this form; several may share one alias`, actions: [btn('+ Delivery', () => addDelivery(a, c))] }),
    section('How this resolves', resolveBox, { note: a.deliveries.some((d) => d.kind === 'device') ? 'write' : 'read', actions: [btn('Chain report ▸', () => chainReport(a.deliveries.some((d) => d.kind === 'device') ? a.format : (c ? c.format : a.format), a.deliveries.some((d) => d.kind === 'device') ? (c ? c.format : a.format) : a.format)), btn('Open transform ▸', () => navigate('transforms', { input: c ? c.format : a.format, output: a.format }))] }),
    section('Static parameters', params.length ? paramTable : note('the chain references none'), { note: 'alias values override the canonical\'s' }),
  ];
  main.append(card({ title: uai(a.uai, { box: false }), badge: kind('alias', true), boxes: [c ? h('span', { class: 'mb' }, 'of ', h('a', { onClick: () => navigate('resources', { uai: c.topic }) }, c.uai.join(' / '))) : null, mb('format', a.format)],
    buttons: [btn('Edit', () => aliasDialog(c, a)), btn('Raw JSON', () => rawEditor('platform.presentation', 'config')), btn('⋯', (e) => menu(e.target, [{ header: 'Layout' }, { layout: true }, { header: 'This alias' },
      { label: 'Delete…', danger: true, note: a.deliveries.length ? `${a.deliveries.length} deliveries depend on it` : undefined, onClick: () => deleteAlias(a) }]))], sections }));
  if (ctx) ctx.append(h('h3', { class: 'ph' }, collapseHandle('ctx'), h('span', { class: 'sp' })), healthCard(a.deliveries.filter((d) => d.kind === 'remote_topic').map((d) => [d.bus, 'see bus adapter', ''])),
    checksCard([a.dangling ? ['err', 'the referenced canonical does not exist'] : ['ok', 'references an existing canonical'], a.deliveries.length ? ['ok', 'has a delivery'] : ['warn', 'no delivery carries this alias'],
      a.encoding === 'protobuf' && !a.edition && !defaultEdition() ? ['warn', 'protobuf without an edition and no default known'] : ['ok', `wire ${wireText(a)}`]]));
}

// ---------------------------------------------------------------- actions
function exportResource(c) {
  const blob = new Blob([JSON.stringify(c.raw, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${c.topic.replace(/\//g, '_')}.json`; a.click();
}
async function checkReferences() {
  try { const r = await api.post('/api/interop/rpc', { identity: 'platform.presentation', method: 'check_references' }); toast(`cycles: ${(r.cycles || []).length}, dangling: ${(r.dangling || []).length}`, (r.cycles || []).length ? 'err' : 'ok'); }
  catch (e) { toast(`check_references: ${e.message}`, 'err'); }
}
function deleteResource(c) {
  deleteDialog({ label: c.topic, dependents: dependentsOf(c), onDelete: async () => {
    await updateServiceConfig((d) => { d.mappings = d.mappings.filter((m) => topicOf(m.uai) !== c.topic); }); toast('deleted', 'ok'); navigate('resources');
  } });
}
function deleteAlias(a) {
  deleteDialog({ label: a.topic, dependents: dependentsOf(a), onDelete: async () => {
    await updateServiceConfig((d) => { d.mappings = d.mappings.filter((m) => topicOf(m.uai) !== a.topic); }); toast('deleted', 'ok'); navigate('resources', { uai: a.canonical });
  } });
}
const topicOf = (u) => (Array.isArray(u) ? u : String(u || '').split('/').filter(Boolean)).join('/');
// An alias that names no edition gets the newest the service knows; show that rather than nothing.
const defaultEdition = () => ((state.catalog || {}).openfmb || {}).latest || null;
const editionOf = (a) => a.edition || (a.encoding === 'protobuf' && defaultEdition() ? `${defaultEdition()} (default)` : null);
const wireText = (a) => `${a.encoding}${editionOf(a) ? ' · ' + editionOf(a) : ''}`;

// Add or edit a canonical resource: the same form both ways, prefilled when editing.
function resourceDialog(existing = null) {
  const form = { uai: existing ? [...existing.uai] : [], format: existing ? existing.format || '' : '', owner: existing ? existing.owner || 'platform.driver' : 'platform.driver',
    publication_topic: existing ? existing.publication_topic || '' : '', rpc_topic: existing ? existing.rpc_topic || '' : '' };
  const body = h('div', { class: 'grid kv1' },
    labelled('UAI', 'The segments that name the resource. Type / or press Tab to start the next segment; Backspace on an empty one removes it.'), segmentsInput(form.uai, { onChange: (v) => (form.uai = v) }),
    labelled('Format', 'The format the owner publishes the resource in; aliases are converted from it.'), select(form.format, formatOptions().map((f) => [f, f]), { blank: 'choose…', onChange: (v) => (form.format = v) }),
    labelled('Owner', 'The agent that publishes the resource and answers its RPCs.'), input(form.owner, { width: '260px', onChange: (v) => (form.owner = v) }),
    labelled('Publication topic', 'Where the owner publishes it; devices/<topic>/multi or /all for a device of the Platform Driver.'), input(form.publication_topic, { placeholder: 'devices/<topic>/multi', width: '100%', mono: true, onChange: (v) => (form.publication_topic = v) }),
    labelled('RPC topic', 'Where writes to the resource are sent; devices/<topic> for a device.'), input(form.rpc_topic, { placeholder: 'devices/<topic>', width: '100%', mono: true, onChange: (v) => (form.rpc_topic = v) }));
  dialog({ title: existing ? `Edit ${existing.uai.join(' / ')}` : 'Add a canonical resource',
    body: h('div', {}, body, existing ? null : note('A device made with Discover gets its resource automatically; this is for resources another agent or a remote bus publishes. An alias (the same resource in another format) is added from the resource\'s card.')),
    actions: [{ label: 'Cancel', onClick: (close) => close() }, { label: 'Save', primary: true, onClick: async (close) => {
      if (!form.uai.length || !form.format) return toast('UAI and format are required', 'err');
      const topic = form.uai.join('/');
      try {
        await updateServiceConfig((d) => {
          const resource = { data_format: form.format, owner: form.owner, publication_topic: form.publication_topic || null, rpc_topic: form.rpc_topic || null };
          if (existing) {
            const m = d.mappings.find((x) => topicOf(x.uai) === existing.topic);
            if (!m) throw new Error('resource not found');
            m.uai = form.uai; m.resource = { ...m.resource, ...resource };
            if (topic !== existing.topic) for (const x of d.mappings) if (x.resource && topicOf(x.resource.references) === existing.topic) x.resource.references = form.uai;    // aliases follow the rename
          } else {
            if (d.mappings.some((x) => topicOf(x.uai) === topic)) throw new Error(`${topic} already exists`);
            d.mappings.push({ uai: form.uai, resource_type: 'canonical', resource });
          }
        });
        close(); toast('saved', 'ok'); navigate('resources', { uai: topic });
      } catch (e) { toast(e.message, 'err'); } } }] });
}
const addResource = () => resourceDialog();

// Add or edit an alias: format, encoding, edition and, when adding, zero or more deliveries. An alias alone is saved
// at once; with a delivery the entries of several agents form one pending set.
function aliasDialog(c, existing = null) {
  if (!c && !existing) return toast('select a canonical resource first', 'err');
  const form = { uai: existing ? [...existing.uai] : [], format: existing ? existing.format || '' : '', encoding: existing ? existing.encoding || 'json' : 'json', edition: existing ? existing.edition || '' : '',
    parameters_text: '', delivery: 'none', bus: (state.model.buses[0] || {}).name || '', direction: 'outbound', device: '' };
  const parametersOf = () => { const t = (form.parameters_text || '').trim(); if (!t) return null; const v = JSON.parse(t); if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('parameters must be a JSON object'); return v; };
  const chain = h('div', { class: 'note' }, 'choose a format to check the chain');
  const checkChain = async () => { if (!form.format || !c) return; chain.textContent = 'checking…'; try { const r = await api.resolve(c.uai, form.format, form.delivery === 'device' ? 'write' : 'read'); chain.replaceChildren(steps(r.path || []), note(`retention ${r.retention != null ? Math.round(r.retention * 100) + ' %' : '—'}`)); } catch (e) { chain.replaceChildren(h('span', { class: 'warn' }, `no chain: ${e.message} `), btn('Create transform ▸', () => navigate('transforms', { input: c.format, output: form.format }))); } };
  const deliveryFields = h('div', { class: 'grid kv1', style: { marginTop: '8px' } });
  const renderDelivery = () => { deliveryFields.replaceChildren();
    if (form.delivery === 'remote_topic') deliveryFields.append(labelled('Bus', 'The bus adapter connection that carries the topic.'), select(form.bus, state.model.buses.map((b) => [b.name, `${b.name} · ${b.bus_type || ''}`]), { onChange: (v) => (form.bus = v), width: '260px' }),
      labelled('Direction', 'Outbound publishes the alias to the remote bus; inbound relays what the remote publishes.'), radios('dir', form.direction, [['outbound', 'outbound', 'local → remote'], ['inbound', 'inbound', 'remote → local']], (v) => (form.direction = v)));
    if (form.delivery === 'device') deliveryFields.append(labelled('Device', 'The device the Resource Bridge writes the alias to.'), select(form.device, state.model.devices.map((d) => [d.topic, d.topic]), { blank: 'choose…', onChange: (v) => (form.device = v), width: '320px' }));
    if (form.delivery === 'local_topic') deliveryFields.append(h('span', { class: 'k' }, 'Local topic'), note('a Resource Bridge bus end publishes the alias on its UAI; any agent may subscribe'));
    checkChain(); };
  const formatSelect = select(form.format, formatOptions().filter((f) => !c || f !== c.format).map((f) => [f, f]), { blank: 'choose…', onChange: (v) => { form.format = v; checkChain(); } });
  const body = h('div', {},
    h('div', { class: 'grid kv1' },
      h('span', { class: 'k' }, 'Of'), c ? uai(c.uai) : h('span', { class: 'warn' }, `${existing.references.join(' / ')} (not a canonical resource)`),
      labelled('UAI', 'The segments the alias is published and resolved under. Type / or press Tab to start the next segment.'), segmentsInput(form.uai, { onChange: (v) => (form.uai = v) }),
      labelled('Format', 'The format this form of the resource is in; the service converts from the canonical\'s format.'), formatSelect,
      labelled('Encoding · edition', 'The wire encoding its topic carries and, for protobuf, the edition of the standard.'), h('div', { class: 'row' }, select(form.encoding, [['json', 'json'], ['protobuf', 'protobuf']], { onChange: (v) => (form.encoding = v), width: '140px' }), input(form.edition, { placeholder: defaultEdition() ? `edition, default ${defaultEdition()}` : 'edition, e.g. 2.2', width: '140px', onChange: (v) => (form.edition = v) })),
      h('span', { class: 'k' }, 'Static parameters'), note(`${Object.keys((c && c.parameters) || {}).join(', ') || 'none'} inherited from the canonical`),
      labelled('Parameters of this alias', 'JSON object of values transform expressions reach with param(\'name\'), merged over the canonical\'s; an OpenFMB alias needs {"mrid": "<device mRID>"} for its message header.'),
      input(existing && existing.parameters && Object.keys(existing.parameters).length ? JSON.stringify(existing.parameters) : '', { placeholder: '{"mrid": "7d1a2b3c-0000-4000-8000-000000000011"}', width: '100%', mono: true, onChange: (v) => (form.parameters_text = v) })),
    existing ? note('Deliveries of this alias are listed on its card and edited on the Bridges tab.') : [h('h3', { style: { marginTop: '14px' } }, 'Delivery'),
      radios('delivery', 'none', [['none', 'none', 'the alias only; library clients resolve it themselves'], ['remote_topic', 'a remote topic on a bus'], ['local_topic', 'a local bus topic'], ['device', 'a device, whatever its role']], (v) => { form.delivery = v; renderDelivery(); }),
      deliveryFields],
    c ? h('fieldset', {}, h('legend', {}, 'Chain check'), chain) : null);
  if (existing) checkChain();
  dialog({ title: existing ? `Edit alias ${existing.uai.join(' / ')}` : `Add an alias of ${c.uai.join(' / ')}`, width: 820, body, actions: [{ label: 'Cancel', onClick: (close) => close() }, { label: 'Save', primary: true, onClick: async (close) => {
    if (!form.uai.length || !form.format) return toast('UAI and format are required', 'err');
    const topic = form.uai.join('/');
    try {
      if (existing) {
        const params = form.parameters_text === '' && existing.parameters ? existing.parameters : parametersOf();
        await updateServiceConfig((d) => { const m = d.mappings.find((x) => topicOf(x.uai) === existing.topic); if (!m) throw new Error('alias not found');
          m.uai = form.uai; m.resource.data_format = form.format; m.resource.encoding = form.encoding; if (form.edition) m.resource.edition = form.edition; else delete m.resource.edition;
          if (params && Object.keys(params).length) m.resource.parameters = params; else delete m.resource.parameters; });
        close(); toast('saved', 'ok'); navigate('resources', { alias: topic }); return;
      }
      const entries = await aliasEntries(c, form);
      if (entries.length === 1) { await api.putEntry('platform.presentation', 'config', { type: 'json', data: entries[0].data }); close(); toast('saved', 'ok'); await refreshModel(false); navigate('resources', { alias: topic }); }
      else { await api.addPending(entries); close(); toast(`${entries.length} entries added to Pending changes · apply them there`, 'ok'); await refreshModel(false); }
    } catch (e) { toast(e.message, 'err'); } } }] });
}
const addAlias = (c) => aliasDialog(c);
async function aliasEntries(c, form) {
  const aliasUai = [...form.uai], topic = aliasUai.join('/');
  const service = await api.entry('platform.presentation', 'config').catch(() => ({ data: {} }));
  const data = { ...(service.data || {}) }; data.mappings = [...(data.mappings || []).filter((m) => topicOf(m.uai) !== topic)];
  const resource = { data_format: form.format, owner: c.owner || 'platform.driver', references: c.uai, encoding: form.encoding };
  if (form.edition) resource.edition = form.edition;
  if (form.parameters_text && form.parameters_text.trim()) resource.parameters = JSON.parse(form.parameters_text);
  data.mappings.push({ uai: aliasUai, resource_type: 'alias', resource });
  const entries = [{ identity: 'platform.presentation', name: 'config', type: 'json', data, summary: `alias ${topic} (${form.format}, ${form.encoding}${form.edition ? ' ' + form.edition : ''})` }];
  if (form.delivery === 'remote_topic') {
    const bus = await api.entry('platform.bus_adapter', 'config').catch(() => ({ data: { adapters: [] } }));
    const cfg = { ...(bus.data || {}) }; cfg.adapters = (cfg.adapters || []).map((a) => ({ ...a }));
    const adapter = cfg.adapters.find((a) => (a.name || a.host) === form.bus) || cfg.adapters[0];
    if (!adapter) throw new Error('the bus adapter has no bus configured');
    const key = form.direction === 'outbound' ? 'local_subscriptions' : 'remote_subscriptions';
    adapter[key] = [...new Set([...(adapter[key] || []), topic])];
    entries.push({ identity: 'platform.bus_adapter', name: 'config', type: 'json', data: cfg, summary: `${form.direction} remote topic ${topic} on ${form.bus}` });
  }
  if (form.delivery === 'local_topic' || form.delivery === 'device') {
    const bridge = await api.entry('platform.resource_bridge', 'config').catch(() => ({ data: { bridges: [] } }));
    const cfg = { ...(bridge.data || {}) }; cfg.bridges = [...(cfg.bridges || [])];
    if (form.delivery === 'local_topic') cfg.bridges.push({ source: c.uai, target: { uai: aliasUai, bus: true } });
    else { const device = state.model.devices.find((d) => d.topic === form.device); if (!device || !device.resource) throw new Error('choose a device that has a canonical resource');
      cfg.bridges.push({ source: { uai: aliasUai, bus: true }, target: device.resource.split('/') }); }
    entries.push({ identity: 'platform.resource_bridge', name: 'config', type: 'json', data: cfg, summary: form.delivery === 'local_topic' ? `bridge publishing ${topic} on the local bus` : `bridge from ${topic} to device ${form.device}` });
  }
  return entries;
}
function addDelivery(a, c) { if (!c) return toast('the alias references no canonical', 'err'); aliasDialog(c); }
