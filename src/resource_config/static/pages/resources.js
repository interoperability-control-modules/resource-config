// Resources, the home page: the clade tree, the canonical card (R1 stacked / R3 tabs), the alias card (R2), Add alias.
import { api } from '../api.js';
import { h, uai, dot, hollow, tag, kind, note, btn, mb, card, section, kv, steps, meter, dialog, toast, input, select, radios, checkbox, info } from '../ui.js';
import { state, navigate, refreshModel, collapseHandle } from '../app.js';
import { rawEditor, menu, healthCard, checksCard, consumersCard, updateServiceConfig, formatOptions, deleteWithDependents } from './common.js';

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
      h('div', { class: 'l2' }, h('span', { class: 'f' }, a.format), h('span', {}, `${a.encoding}${a.edition ? ' · ' + a.edition : ''}`), ...a.deliveries.map((d) => h('span', { class: 'd' }, deliveryText(d))), a.deliveries.length ? null : h('span', { class: 'd warn' }, 'no delivery'))); }),
    c.aliases.length ? null : note('No aliases: everything consumes the canonical form.'));
  const aliasSection = section('Aliases', aliasRows, { note: `${c.aliases.length} · other forms of this resource, each for something that consumes it`, actions: [btn('+ Alias', () => addAlias(c), { primary: true })] });
  const paramRows = Object.entries(c.parameters || {});
  const paramsSection = section('Static parameters', () => paramRows.length ? h('table', {}, h('tr', {}, h('th', {}, 'key'), h('th', {}, 'value')), ...paramRows.map(([k, v]) => h('tr', {}, h('td', { class: 'mono' }, k), h('td', { class: 'mono' }, String(v))))) : note('none'),
    { collapsed: true, note: paramRows.length ? `${paramRows.map(([k]) => k).join(', ')} · set here so the aliases inherit them` : 'none' });
  const consumersSection = section('Consumers', () => consumersCard(c.consumers, state.model).querySelector('.uby'), { collapsed: true, note: consumersSummary(c.consumers) });
  const buttons = [btn('Edit', () => rawEditor('platform.presentation', 'config')), btn('Raw JSON', () => rawEditor('platform.presentation', 'config')),
    btn('⋯', (e) => menu(e.target, [{ header: 'Layout' }, { layout: true }, { header: 'This resource' }, { label: 'Export entry (JSON)', onClick: () => exportResource(c) }, { label: 'Check references', onClick: checkReferences },
      ...(device ? [{ header: 'Device' }, { label: 'Open device ▸', onClick: () => navigate('devices', { topic: device.topic }) }] : []),
      { label: 'Delete…', danger: true, note: c.aliases.length || c.consumers.length ? `${c.aliases.length} aliases, ${c.consumers.length} consumers depend on it` : undefined, onClick: () => deleteResource(c) }]))];
  const header = { title: uai(c.uai, { box: false }), badge: kind('canonical'), boxes: [mb('format', c.format || '—'), mb('owner', c.owner || '—')], buttons };
  if (state.layout === 'tabs') {
    const tabs = [['Overview', () => h('div', {}, sourceSection, glance(c))], ['Aliases', () => aliasSection], ['Parameters', () => paramsSection], ['Consumers', () => consumersSection], ['JSON', () => h('div', { class: 'rsec' }, h('pre', { class: 'mono' }, JSON.stringify(c.raw, null, 2)))]];
    const body = h('div', {}); let active = 0;
    const bar = h('div', { class: 'ctabs' }, ...tabs.map(([label], i) => h('span', { class: i === 0 ? 'on' : '', onClick: (e) => { active = i; bar.querySelectorAll('span').forEach((s, j) => s.classList.toggle('on', j === i)); body.replaceChildren(tabs[i][1]()); } }, label,
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
  for (const topic of c.aliases) { const a = aliases.find((x) => x.topic === topic); if (a && !a.deliveries.length) checks.push(['warn', `alias ${a.format} has no delivery`]); if (a && a.encoding === 'protobuf' && !a.edition) checks.push(['warn', `alias ${a.format} is protobuf without an edition`]); }
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
        h('div', { class: 'tile' }, h('h6', {}, 'Retention'), h('div', { class: 'big' }, r.retention != null ? `${Math.round(r.retention * 100)} %` : '—'), meter(r.retention), note(`${(r.path || []).length ? (r.path || []).length - 1 : 0} hops`)),
        h('div', { class: 'tile' }, h('h6', {}, 'Formats'), h('div', {}, `${r.data_format || '?'} → ${r.target_format || a.format}`), note('as the service resolves this alias')),
        h('div', { class: 'tile' }, h('h6', {}, 'Wire'), h('div', {}, h('b', {}, a.encoding), a.edition ? ` · edition ${a.edition}` : ''), note(r.codec ? `proto ${r.codec.proto || JSON.stringify(r.codec)}` : 'json on the local bus'))));
  }).catch((e) => resolveBox.replaceChildren(h('div', { class: 'warn' }, `The service could not resolve this alias: ${e.message}`)));
  const deliveries = h('div', {}, ...a.deliveries.map((d) => h('div', { class: 'arow2', style: { gridTemplateColumns: '18px minmax(0,1fr) auto' } }, h('span', {}, d.kind === 'remote_topic' ? (d.direction === 'outbound' ? '⇈' : '⇊') : d.kind === 'device' ? '⇄' : '◎'),
    h('span', {}, h('b', {}, d.kind.replace('_', ' ')), ' · ', deliveryText(d)), d.bridge ? h('a', { onClick: () => navigate('bridges', { bridge: d.bridge }) }, 'Open ▸') : d.kind === 'remote_topic' ? h('a', { onClick: () => navigate('bridges', { topic: d.topic }) }, 'Open ▸') : null)),
    a.deliveries.length ? null : note('Nothing carries this alias yet. Agents that use the resource library resolve it themselves and need no delivery.'));
  const params = Object.entries({ ...(c ? c.parameters : {}), ...(a.parameters || {}) });
  const paramTable = h('table', { style: { maxWidth: '640px' } }, h('tr', {}, h('th', {}, 'key'), h('th', {}, 'value here'), h('th', {}, 'from canonical')),
    ...params.map(([k]) => h('tr', {}, h('td', { class: 'mono' }, k), h('td', { class: 'mono' }, a.parameters && k in a.parameters ? String(a.parameters[k]) : h('span', { class: 'note' }, '—')), h('td', { class: 'mono' }, c && k in (c.parameters || {}) ? String(c.parameters[k]) : h('span', { class: 'note' }, '—')))));
  const sections = [
    section('Form', kv([['Format', a.format], ['Encoding · edition', `${a.encoding}${a.edition ? ' · ' + a.edition : ''}`], ['Published as', h('span', { class: 'mono' }, a.topic, ' ', note('· the UAI joined with the bus delimiter'))]], 2), { note: 'what this alias presents the resource as' }),
    section('Canonical resource', c ? h('div', { class: 'subcard' }, dot(), uai(c.uai, { box: false, onClick: () => navigate('resources', { uai: c.topic }) }), kind('canonical'), note(`${c.format} · ${c.source && c.source.kind === 'device' ? 'device ' + c.source.device : c.owner}`), h('span', { class: 'sp' }), btn('Open ▸', () => navigate('resources', { uai: c.topic })))
      : h('div', { class: 'warn' }, `dangling: references ${a.references.join('/')}, which is not a canonical resource`), { note: 'what this is a form of' }),
    section('Delivered to', deliveries, { note: `${a.deliveries.length} · what carries this form; several may share one alias`, actions: [btn('+ Delivery', () => addDelivery(a, c))] }),
    section('How this resolves', resolveBox, { note: a.deliveries.some((d) => d.kind === 'device') ? 'write' : 'read' }),
    section('Static parameters', params.length ? paramTable : note('the chain references none'), { note: 'alias values override the canonical\'s' }),
  ];
  main.append(card({ title: uai(a.uai, { box: false }), badge: kind('alias', true), boxes: [c ? h('span', { class: 'mb' }, 'of ', h('a', { onClick: () => navigate('resources', { uai: c.topic }) }, c.uai.join(' / '))) : null, mb('format', a.format)],
    buttons: [btn('Edit', () => editAlias(a)), btn('Raw JSON', () => rawEditor('platform.presentation', 'config')), btn('⋯', (e) => menu(e.target, [{ header: 'Layout' }, { layout: true }, { header: 'This alias' },
      { label: 'Delete…', danger: true, note: a.deliveries.length ? `${a.deliveries.length} deliveries depend on it` : undefined, onClick: () => deleteAlias(a) }]))], sections }));
  if (ctx) ctx.append(h('h3', { class: 'ph' }, collapseHandle('ctx'), h('span', { class: 'sp' })), healthCard(a.deliveries.filter((d) => d.kind === 'remote_topic').map((d) => [d.bus, 'see bus adapter', ''])),
    checksCard([a.dangling ? ['err', 'the referenced canonical does not exist'] : ['ok', 'references an existing canonical'], a.deliveries.length ? ['ok', 'has a delivery'] : ['warn', 'no delivery carries this alias'],
      a.encoding === 'protobuf' && !a.edition ? ['warn', 'protobuf without an edition'] : ['ok', `wire ${a.encoding}${a.edition ? ' · ' + a.edition : ''}`]]));
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
  deleteWithDependents(c.topic, [...c.aliases, ...c.consumers.map((x) => x.name || x.identity)], async () => {
    try { await updateServiceConfig((d) => { d.mappings = d.mappings.filter((m) => topicOf(m.uai) !== c.topic); }); toast('deleted', 'ok'); navigate('resources'); } catch (e) { toast(e.message, 'err'); }
  });
}
function deleteAlias(a) {
  deleteWithDependents(a.topic, a.deliveries.map((d) => d.bridge || d.topic), async () => {
    try { await updateServiceConfig((d) => { d.mappings = d.mappings.filter((m) => topicOf(m.uai) !== a.topic); }); toast('deleted', 'ok'); navigate('resources', { uai: a.canonical }); } catch (e) { toast(e.message, 'err'); }
  });
}
const topicOf = (u) => (Array.isArray(u) ? u : String(u || '').split('/').filter(Boolean)).join('/');

function addResource() {
  const form = { uai: '', format: '', owner: 'platform.driver', publication_topic: '', rpc_topic: '' };
  const body = h('div', { class: 'grid kv1' },
    h('span', { class: 'k' }, 'UAI'), input('', { placeholder: 'segments separated by /', width: '100%', mono: true, onChange: (v) => (form.uai = v) }),
    h('span', { class: 'k' }, 'Format'), select('', formatOptions().map((f) => [f, f]), { blank: 'choose…', onChange: (v) => (form.format = v) }),
    h('span', { class: 'k' }, 'Owner'), input(form.owner, { width: '260px', onChange: (v) => (form.owner = v) }),
    h('span', { class: 'k' }, 'Publication topic'), input('', { placeholder: 'devices/<topic>/multi', width: '100%', mono: true, onChange: (v) => (form.publication_topic = v) }),
    h('span', { class: 'k' }, 'RPC topic'), input('', { placeholder: 'devices/<topic>', width: '100%', mono: true, onChange: (v) => (form.rpc_topic = v) }));
  dialog({ title: 'Add a canonical resource', body: h('div', {}, body, note('A device made with Discover gets its resource automatically; this is for resources another agent or a remote bus publishes.')),
    actions: [{ label: 'Cancel', onClick: (close) => close() }, { label: 'Save', primary: true, onClick: async (close) => {
      if (!form.uai || !form.format) return toast('UAI and format are required', 'err');
      try { await updateServiceConfig((d) => d.mappings.push({ uai: form.uai.split('/').filter(Boolean), resource_type: 'canonical', resource: { data_format: form.format, owner: form.owner, publication_topic: form.publication_topic || null, rpc_topic: form.rpc_topic || null } })); close(); navigate('resources', { uai: topicOf(form.uai) }); } catch (e) { toast(e.message, 'err'); } } }] });
}

// Add alias: format, encoding, edition, parameters, then zero or more deliveries; everything becomes one pending set.
function addAlias(c) {
  if (!c) return toast('select a canonical resource first', 'err');
  const form = { uai: '', format: '', encoding: 'json', edition: '', parameters: {}, delivery: 'none', bus: (state.model.buses[0] || {}).name || '', direction: 'outbound', device: '' };
  const uaiInput = input('', { placeholder: 'e.g. openfmb/solarmodule/SolarReadingProfile/<mrid>', width: '100%', mono: true, onChange: (v) => (form.uai = v) });
  const chain = h('div', { class: 'note' }, 'choose a format to check the chain');
  const checkChain = async () => { if (!form.format) return; chain.textContent = 'checking…'; try { const r = await api.resolve(c.uai, form.format, form.delivery === 'device' ? 'write' : 'read'); chain.replaceChildren(steps(r.path || []), note(`retention ${r.retention != null ? Math.round(r.retention * 100) + ' %' : '—'}`)); } catch (e) { chain.replaceChildren(h('span', { class: 'warn' }, `no chain: ${e.message} `), btn('Create transform ▸', () => navigate('transforms', { input: c.format, output: form.format }))); } };
  const deliveryFields = h('div', { class: 'grid kv1', style: { marginTop: '8px' } });
  const renderDelivery = () => { deliveryFields.replaceChildren();
    if (form.delivery === 'remote_topic') deliveryFields.append(h('span', { class: 'k' }, 'Bus'), select(form.bus, state.model.buses.map((b) => [b.name, `${b.name} · ${b.bus_type || ''}`]), { onChange: (v) => (form.bus = v), width: '260px' }),
      h('span', { class: 'k' }, 'Direction'), radios('dir', form.direction, [['outbound', 'outbound', 'local → remote'], ['inbound', 'inbound', 'remote → local']], (v) => (form.direction = v)));
    if (form.delivery === 'device') deliveryFields.append(h('span', { class: 'k' }, 'Device'), select(form.device, state.model.devices.map((d) => [d.topic, d.topic]), { blank: 'choose…', onChange: (v) => (form.device = v), width: '320px' }));
    if (form.delivery === 'local_topic') deliveryFields.append(h('span', { class: 'k' }, 'Local topic'), note('a Resource Bridge bus end publishes the alias on its UAI; any agent may subscribe'));
    checkChain(); };
  const body = h('div', {},
    h('div', { class: 'grid kv1' },
      h('span', { class: 'k' }, 'Of'), uai(c.uai),
      h('span', { class: 'k' }, 'UAI'), uaiInput,
      h('span', { class: 'k' }, 'Format'), select('', formatOptions().filter((f) => f !== c.format).map((f) => [f, f]), { blank: 'choose…', onChange: (v) => { form.format = v; checkChain(); } }),
      h('span', { class: 'k' }, 'Encoding · edition'), h('div', { class: 'row' }, select('json', [['json', 'json'], ['protobuf', 'protobuf']], { onChange: (v) => (form.encoding = v), width: '140px' }), input('', { placeholder: 'edition, e.g. 2.2', width: '120px', onChange: (v) => (form.edition = v) })),
      h('span', { class: 'k' }, 'Static parameters'), note(`${Object.keys(c.parameters || {}).join(', ') || 'none'} inherited from the canonical`)),
    h('h3', { style: { marginTop: '14px' } }, 'Delivery'),
    radios('delivery', 'none', [['none', 'none', 'the alias only; library clients resolve it themselves'], ['remote_topic', 'a remote topic on a bus'], ['local_topic', 'a local bus topic'], ['device', 'a device, whatever its role']], (v) => { form.delivery = v; renderDelivery(); }),
    deliveryFields, h('fieldset', {}, h('legend', {}, 'Chain check'), chain));
  dialog({ title: `Add an alias of ${c.uai.join(' / ')}`, width: 820, body, actions: [{ label: 'Cancel', onClick: (close) => close() }, { label: 'Add to pending changes ▸', primary: true, onClick: async (close) => {
    if (!form.uai || !form.format) return toast('UAI and format are required', 'err');
    try { await api.addPending(await aliasEntries(c, form)); toast('added to the pending set', 'ok'); close(); await refreshModel(false); } catch (e) { toast(e.message, 'err'); } } }] });
}
async function aliasEntries(c, form) {
  const aliasUai = form.uai.split('/').filter(Boolean), topic = aliasUai.join('/');
  const service = await api.entry('platform.presentation', 'config').catch(() => ({ data: {} }));
  const data = { ...(service.data || {}) }; data.mappings = [...(data.mappings || []).filter((m) => topicOf(m.uai) !== topic)];
  const resource = { data_format: form.format, owner: c.owner || 'platform.driver', references: c.uai, encoding: form.encoding };
  if (form.edition) resource.edition = form.edition;
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
function addDelivery(a, c) { if (!c) return toast('the alias references no canonical', 'err'); addAlias(c); }
function editAlias(a) {
  const form = { format: a.format, encoding: a.encoding, edition: a.edition || '' };
  dialog({ title: `Edit alias ${a.uai.join(' / ')}`, body: h('div', { class: 'grid kv1' },
    h('span', { class: 'k' }, 'Format'), select(form.format, formatOptions().map((f) => [f, f]), { onChange: (v) => (form.format = v) }),
    h('span', { class: 'k' }, 'Encoding'), select(form.encoding, [['json', 'json'], ['protobuf', 'protobuf']], { onChange: (v) => (form.encoding = v), width: '140px' }),
    h('span', { class: 'k' }, 'Edition'), input(form.edition, { width: '120px', onChange: (v) => (form.edition = v) })),
    actions: [{ label: 'Cancel', onClick: (close) => close() }, { label: 'Save', primary: true, onClick: async (close) => {
      try { await updateServiceConfig((d) => { const m = d.mappings.find((x) => topicOf(x.uai) === a.topic); if (!m) throw new Error('alias not found'); m.resource.data_format = form.format; m.resource.encoding = form.encoding; if (form.edition) m.resource.edition = form.edition; else delete m.resource.edition; }); toast('saved', 'ok'); close(); } catch (e) { toast(e.message, 'err'); } } }] });
}
