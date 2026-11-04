// Pieces several pages share: the raw entry editor, the card menu, health and checks cards, service-config writes.
import { api } from '../api.js';
import { h, btn, dialog, toast, note, kv, dot, confirmDialog, steps, meter, checkbox, radios, kind, schemaForm, select, input, labelled } from '../ui.js';
import { state, refreshModel, setLayout, navigate } from '../app.js';

export function rawEditor(identity, name, { onSaved } = {}) {
  api.entry(identity, name).then((entry) => {
    const area = h('textarea', { class: 'in mono' }, entry.text);
    dialog({ title: `${identity} · ${name} · ${entry.type}`, width: 820, body: h('div', {}, area, note(`Stored as ${entry.type}. Saving writes the entry to the platform now.`)),
      actions: [{ label: 'Cancel', onClick: (close) => close() },
        { label: 'Save', primary: true, onClick: async (close) => {
          try {
            if (entry.type === 'json') JSON.parse(area.value);
            await api.putEntry(identity, name, { type: entry.type, text: area.value });
            toast(`Saved ${name}`, 'ok'); close(); await refreshModel(false); onSaved && onSaved();
          } catch (e) { toast(e.message, 'err'); }
        } }] });
  }).catch((e) => toast(e.message, 'err'));
}

export function menu(anchor, items) {
  const existing = document.querySelector('.menu2'); if (existing) existing.remove();
  const el = h('div', { class: 'menu2', style: { right: '14px', top: '46px' } });
  for (const item of items) {
    if (item.header) { el.append(h('div', { class: 'h' }, item.header)); continue; }
    if (item.layout) {
      el.append(h('div', { class: 'sub' }, ...['stacked', 'tabs'].map((l) => h('span', { style: { cursor: 'pointer', marginRight: '12px' }, onClick: () => { setLayout(l); el.remove(); } },
        h('span', { class: `rad${state.layout === l ? ' on' : ''}` }), ' ', l))));
      continue;
    }
    el.append(h('div', { class: item.danger ? 'danger' : '', style: { cursor: item.onClick ? 'pointer' : 'default' }, onClick: () => { el.remove(); item.onClick && item.onClick(); } }, item.label, item.note ? [' ', note(item.note)] : null));
  }
  anchor.closest('.rc').append(el);
  setTimeout(() => document.addEventListener('click', (e) => { if (!el.contains(e.target)) el.remove(); }, { once: true }), 0);
}

export function healthCard(rows) {
  return h('div', { class: 'card' }, h('h4', {}, 'Health'), ...rows.map(([k, v, cls]) => h('div', { class: 'hrow' }, h('span', {}, k), h('span', { class: cls || '' }, v))));
}
export function checksCard(checks) {
  return h('div', { class: 'card' }, h('h4', {}, 'Checks'), ...(checks.length ? checks : [['ok', 'nothing to report']]).map(([level, text]) =>
    h('div', { class: level }, level === 'ok' ? '✓ ' : level === 'warn' ? '⚠ ' : '✗ ', text)));
}
export function consumersCard(consumers, model) {
  const rows = consumers.map((c) => c.kind === 'bridge'
    ? h('div', {}, h('span', { class: 'w' }, '⇄ '), 'bridge ', h('a', { onClick: () => navigate('bridges', { bridge: c.name }) }, c.name), c.enabled === false ? [' ', note('disabled')] : null)
    : c.kind === 'agent' ? h('div', {}, h('span', { class: 'w' }, '◎ '), 'agent ', h('a', { onClick: () => navigate('agents', { identity: c.identity }) }, c.identity))
    : h('div', {}, JSON.stringify(c)));
  return h('div', { class: 'card' }, h('h4', {}, 'Consumers'), h('div', { class: 'uby' }, ...(rows.length ? rows : [note('nothing consumes this yet')])));
}
export function agentHealth(identity) {
  const agent = (state.model.agents || []).find((a) => a.identity === identity);
  return agent || null;
}

// The service's configuration is one entry holding every mapping; a change to one resource rewrites the entry.
export async function updateServiceConfig(mutate) {
  const settings = state.session;
  const identity = 'platform.presentation';
  const entry = await api.entry(identity, 'config').catch(() => ({ type: 'json', data: {} }));
  const data = entry.data && typeof entry.data === 'object' ? entry.data : {};
  data.mappings = data.mappings || [];
  mutate(data);
  await api.putEntry(identity, 'config', { type: 'json', data });
  await refreshModel(false);
}
// Deleting something other objects depend on. The dialog lists every dependent and asks for a decision on each:
// remove it along (when the UI knows how) or keep it, which leaves it referring to a deleted object. Delete stays
// disabled until every row is decided and any kept dependents are explicitly approved. "Open" leaves to the dependent.
// A dependent is { kind, label, open?, remove?, keepNote? }.
export function deleteDialog({ label, dependents = [], onDelete, extra = null }) {
  const run = async (remove) => { try { for (const d of remove) await d.remove(); await onDelete(); } catch (e) { toast(e.message, 'err'); } };
  if (!dependents.length) { confirmDialog(h('div', {}, `Delete ${label}?`, extra ? [' ', extra] : null), () => run([])); return; }
  const decisions = new Map();
  let approved = false;
  const ready = () => dependents.every((d) => decisions.has(d)) && ([...decisions.values()].every((v) => v === 'remove') || approved);
  const approval = h('div', { class: 'hidden', style: { marginTop: '10px' } }, h('label', { class: 'chk' }, checkbox(false, (v) => { approved = v; update(); }), ' ',
    h('b', {}, 'Delete anyway'), note(' and leave the kept items referring to something that no longer exists')));
  const del = btn('Delete', async () => { if (!ready()) return; close(); await run(dependents.filter((d) => decisions.get(d) === 'remove')); }, { primary: true, small: false });
  const rows = dependents.map((d) => {
    const keepNote = h('div', { class: 'note small hidden' }, d.keepNote || 'will refer to something that no longer exists');
    const choice = radios(`dep${Math.random().toString(36).slice(2)}`, null, [...(d.remove ? [['remove', 'remove with it']] : []), ['keep', d.remove ? 'keep' : 'keep (this UI cannot remove it)']],
      (v) => { decisions.set(d, v); keepNote.classList.toggle('hidden', v !== 'keep'); update(); });
    return h('tr', {}, h('td', {}, kind(d.kind, d.kind === 'alias' || d.kind === 'remote topic')), h('td', {}, h('div', { class: 'mono' }, d.label), keepNote),
      h('td', {}, choice), h('td', {}, d.open ? h('a', { onClick: () => { close(); d.open(); } }, 'Open ▸') : null));
  });
  const update = () => { approval.classList.toggle('hidden', ![...decisions.values()].includes('keep')); del.classList.toggle('dis', !ready()); };
  const body = h('div', {}, h('div', {}, `${dependents.length} item${dependents.length === 1 ? '' : 's'} depend${dependents.length === 1 ? 's' : ''} on it. Decide what happens to each, then confirm.`),
    h('table', { style: { marginTop: '8px' } }, h('tr', {}, h('th', {}, 'kind'), h('th', {}, 'dependent'), h('th', {}, 'decision'), h('th', {})), ...rows),
    approval, extra ? h('div', { style: { marginTop: '8px' } }, extra) : null,
    h('div', { class: 'bar', style: { marginTop: '14px' } }, h('span', { class: 'sp' }), btn('Cancel', () => close(), { small: false }), del));
  const close = dialog({ title: `Delete ${label}?`, body, width: 720, actions: [] });
  update();
}

// The dependents of a canonical resource or an alias: its aliases, what delivers it and what consumes it.
export function dependentsOf(resource) {
  const deps = [], seen = new Set();
  const add = (d) => { const k = `${d.kind}:${d.label}`; if (!seen.has(k)) { seen.add(k); deps.push(d); } };
  for (const t of resource.aliases || []) add({ kind: 'alias', label: t, open: () => navigate('resources', { alias: t }), remove: () => removeMapping(t), keepNote: 'becomes dangling: it references a canonical that no longer exists' });
  for (const d of resource.deliveries || []) {
    if (d.kind === 'remote_topic') add({ kind: 'remote topic', label: `${d.topic} · ${d.direction} on ${d.bus}`, open: () => navigate('bridges', { topic: d.topic }), remove: () => removeRemoteTopic(d.bus, d.direction, d.topic), keepNote: 'the bus adapter keeps relaying a topic no alias describes' });
    else if (d.bridge) add({ kind: 'bridge', label: d.bridge, open: () => navigate('bridges', { bridge: d.bridge }), remove: () => removeBridge(d.bridge), keepNote: 'one end of the bridge stops resolving' });
  }
  for (const c of resource.consumers || []) {
    if (c.kind === 'bridge') add({ kind: 'bridge', label: c.name, open: () => navigate('bridges', { bridge: c.name }), remove: () => removeBridge(c.name), keepNote: 'its source stops resolving' });
    else if (c.identity) add({ kind: 'agent', label: c.identity, open: () => navigate('agents', { identity: c.identity }), keepNote: 'its configuration names a topic nothing publishes; edit the agent' });
  }
  return deps;
}
export async function updateEntry(identity, name, mutate, fallback = {}) {
  const entry = await api.entry(identity, name).catch(() => ({ type: 'json', data: fallback }));
  const data = entry.data && typeof entry.data === 'object' ? entry.data : { ...fallback };
  mutate(data);
  await api.putEntry(identity, name, { type: 'json', data });
}
const topicOfUai = (u) => (Array.isArray(u) ? u : String(u || '').split('/').filter(Boolean)).join('/');
export const removeMapping = (topic) => updateEntry('platform.presentation', 'config', (d) => { d.mappings = (d.mappings || []).filter((m) => topicOfUai(m.uai) !== topic); });
export const removeBridge = (name) => { const b = (state.model.bridges || []).find((x) => x.name === name); return updateEntry('platform.resource_bridge', 'config', (d) => { d.bridges = (d.bridges || []).filter((raw) => !b || JSON.stringify(raw) !== JSON.stringify(b.raw)); }); };
export const removeRemoteTopic = (bus, direction, topic) => updateEntry('platform.bus_adapter', 'config', (d) => { for (const a of d.adapters || []) if ((a.name || a.host || a.servers || 'bus') === bus) { const key = direction === 'outbound' ? 'local_subscriptions' : 'remote_subscriptions'; a[key] = (a[key] || []).filter((t) => t !== topic); } });
export const formatOptions = () => (state.model.formats || []).map((f) => f.name).sort();
export const since = (ts) => (ts ? `${Math.round(Date.now() / 1000 - ts)} s ago` : '—');


// The chain report (R2b): hop by hop what is kept and lost, and where each target field comes from.
export async function chainReport(inputFormat, outputFormat, title) {
  let report;
  try { report = await api.chainReport(inputFormat, outputFormat); } catch (e) { return toast(`chain report: ${e.message}`, 'err'); }
  const filter = h('input', { class: 'in mono', placeholder: 'filter target fields', style: { width: '260px' } });
  const rows = () => (report.targets || []).filter((t) => !filter.value || t.target.toLowerCase().includes(filter.value.toLowerCase()) || (t.source || '').toLowerCase().includes(filter.value.toLowerCase()));
  const table = h('table', {});
  const fill = () => {
    table.replaceChildren(h('tr', {}, h('th', {}, 'target'), h('th', {}, 'source'), h('th', {}, 'fidelity'), h('th', {}, 'functions')),
      ...rows().slice(0, 200).map((t) => h('tr', {}, h('td', { class: 'mono' }, t.target), h('td', { class: 'mono' }, t.source || '—'), h('td', {}, t.fidelity == null ? '—' : t.fidelity === 1 ? 'exact' : t.fidelity.toFixed(2)), h('td', { class: 'note' }, (t.functions || []).join(' → ')))),
      ...(report.unmapped_targets || []).filter((u) => !filter.value || u.target.toLowerCase().includes(filter.value.toLowerCase())).map((u) => h('tr', {}, h('td', { class: 'mono' }, u.target), h('td', { class: 'warn' }, '— unmapped'), h('td', { class: 'warn' }, u.lost_at ? `lost at ${u.lost_at}` : 'no hop produces it'), h('td', {}))));
  };
  filter.addEventListener('input', fill); fill();
  const hops = h('div', { class: 'rep' }, h('div', { class: 'r h' }, h('span', {}, 'hop'), h('span', { class: 'num' }, 'in'), h('span', { class: 'num' }, 'kept'), h('span', { class: 'num' }, 'lost'), h('span', {}, 'dropped fields (first few)')),
    ...(report.hops || []).map((hp) => h('div', { class: 'r' }, h('span', {}, `${hp.input} → ${hp.output}`), h('span', { class: 'num' }, String(hp.in)), h('span', { class: 'num' }, String(hp.kept)), h('span', { class: 'num' }, String(hp.lost)), h('span', { class: 'mono note' }, (hp.lost_fields || []).slice(0, 6).join(', ')))));
  dialog({ title: title || `Chain report · ${inputFormat} → ${outputFormat}`, width: 900, body: h('div', {},
    steps(report.path || []), h('div', { class: 'row', style: { margin: '8px 0' } }, h('div', { style: { flex: 1 } }, meter(report.retention)), note(`retention ${report.retention != null ? Math.round(report.retention * 100) + ' %' : '—'} · ${(report.path || []).length ? report.path.length - 1 : 0} hops`)),
    h('fieldset', {}, h('legend', {}, 'Per hop'), hops),
    h('fieldset', {}, h('legend', {}, 'Per target field ', note(`· ${(report.targets || []).length} mapped · ${(report.unmapped_targets || []).length} unmapped`)), filter, h('div', { class: 'scrollbox', style: { marginTop: '6px' } }, h('div', { class: 'scrollin', style: { overflow: 'auto', maxHeight: '320px' } }, table)))),
    actions: [{ label: 'Export JSON', onClick: () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })); a.download = `chain_${inputFormat}_${outputFormat}.json`; a.click(); } },
      { label: 'Close', primary: true, onClick: (close) => close() }] });
}
export function activityCard(stats) {
  if (!stats) return h('div', { class: 'card' }, h('h4', {}, 'Activity'), note('The Resource Bridge did not answer its statistics RPC; nothing to show.'));
  const ago = (ts) => (ts ? `${Math.round(Date.now() / 1000 - ts)} s ago` : '—');
  const drifted = Object.entries(stats.drifted || {});
  return h('div', { class: 'card' }, h('h4', {}, 'Activity'),
    ...[['messages', stats.messages], ['last message', ago(stats.last_message)], ['writes', `${stats.writes}${stats.publishes ? ' · ' + stats.publishes + ' publishes' : ''}`], ['points written', stats.points_written],
      ['points skipped', stats.points_skipped, 'the target already held the value'], ['points refused', stats.points_refused], ['last write', ago(stats.last_write)], ['transform errors', stats.transform_errors]].map(([k, v, tip]) => h('div', { class: 'hrow' }, h('span', { title: tip }, k), h('span', {}, String(v)))),
    stats.last_error ? h('div', { class: 'err', style: { marginTop: '4px' } }, stats.last_error) : null,
    drifted.length ? h('div', { style: { marginTop: '6px' } }, h('b', {}, 'Drifted'), ...drifted.map(([p, d]) => h('div', { class: 'warn mono' }, `${p}: wanted ${d.intended}, holds ${d.actual}`))) : h('div', { class: 'ok', style: { marginTop: '4px' } }, '✓ no drift'));
}


// ---- agent configuration editors: the form of the agent's model, special-cased where the model has structure the
// generic form cannot show (the bus adapter's list of buses, each typed by bus_type). Every editor has getValue().
export const SCHEMA_OF_TYPE = { driver: 'driver/config', 'resource bridge': 'resource_bridge/config', 'bus adapter': 'bus_adapter/config' };
export const agentOf = (identity) => (state.model.agents || []).find((a) => a.identity === identity) || { identity, type: 'agent' };
export const busTypes = () => Object.keys((state.catalog || { schemas: {} }).schemas).filter((k) => k.startsWith('bus_adapter/') && k !== 'bus_adapter/config').map((k) => k.slice('bus_adapter/'.length));

export function configEditor(agent, draft, onChange = () => {}) {
  const schemas = (state.catalog || { schemas: {} }).schemas;
  if (agent.type === 'bus adapter' && schemas['bus_adapter/config']) return busAdapterEditor(draft, onChange);
  if (agent.type === 'service') { const el = serviceSummary(draft); el.getValue = () => draft; return el; }
  const key = SCHEMA_OF_TYPE[agent.type], schema = key && schemas[key];
  if (schema) {
    const hide = agent.type === 'resource bridge' ? ['bridges'] : [];
    const form = schemaForm(schema, draft, { hide, onChange: (name, value) => { if (value === null) delete draft[name]; else draft[name] = value; onChange(); } });
    const el = h('div', {}, form, hide.length ? note(`${hide.join(', ')}: unchanged here, managed on the Bridges tab`) : null);
    el.getValue = () => draft;
    return el;
  }
  // No model for this agent type: the entry as JSON text.
  const area = h('textarea', { class: 'in mono', style: { width: '100%', minHeight: '200px', fontFamily: 'ui-monospace,Menlo,Consolas,monospace', fontSize: '12px' } }, JSON.stringify(draft, null, 2));
  area.addEventListener('change', () => { try { JSON.parse(area.value); area.classList.remove('errrow'); onChange(); } catch { area.classList.add('errrow'); } });
  const el = h('div', {}, area, note('no configuration model for this agent type; the entry is edited as JSON'));
  el.getValue = () => JSON.parse(area.value);
  return el;
}

function busAdapterEditor(draft, onChange) {
  const schemas = state.catalog.schemas, top = schemas['bus_adapter/config'], hints = top['x-hints'] || {}, types = busTypes();
  draft.adapters = Array.isArray(draft.adapters) ? draft.adapters : [];
  const generic = { properties: ((top.$defs || {}).MessageBusConfig || {}).properties || {}, 'x-hints': {} };
  const busesBox = h('div', {});
  const busCard = (bus, i) => {
    const schema = schemas[`bus_adapter/${draft.bus_type}`] || generic;
    const form = schemaForm(schema, bus, { hide: ['local_subscriptions', 'remote_subscriptions'], onChange: (name, value) => { if (value === null) delete bus[name]; else bus[name] = value; title.textContent = bus.name || `bus ${i + 1}`; onChange(); } });
    const title = h('b', {}, bus.name || `bus ${i + 1}`);
    return h('div', { class: 'subcard', style: { display: 'block', marginTop: '8px' } }, h('div', { class: 'row', style: { marginBottom: '6px' } }, title, h('span', { class: 'sp' }), btn('Remove', () => { draft.adapters.splice(i, 1); renderBuses(); onChange(); })), form,
      schema === generic ? note(`no settings model for bus type "${draft.bus_type || '?'}": its proxy's parameters can be added with Raw JSON`) : null);
  };
  const renderBuses = () => busesBox.replaceChildren(...draft.adapters.map(busCard), h('div', { class: 'bar', style: { marginTop: '8px' } }, btn('+ Bus', () => { draft.adapters.push({}); renderBuses(); onChange(); })));
  const other = input(types.includes(draft.bus_type) ? '' : draft.bus_type || '', { placeholder: 'plugin name', width: '180px', onChange: (v) => { draft.bus_type = v.trim().toLowerCase(); renderBuses(); onChange(); } });
  const typeSel = select(types.includes(draft.bus_type) ? draft.bus_type : (draft.bus_type ? '__other' : ''), [...types.map((t) => [t, t]), ['__other', 'other…']],
    { blank: 'choose…', width: '160px', onChange: (v) => { other.classList.toggle('hidden', v !== '__other'); if (v !== '__other') { draft.bus_type = v; renderBuses(); onChange(); } else other.focus(); } });
  other.classList.toggle('hidden', !draft.bus_type || types.includes(draft.bus_type));
  const timeout = input(draft.proxy_registration_timeout ?? '', { num: true, width: '110px', placeholder: '30', onChange: (v) => { if (v === '') delete draft.proxy_registration_timeout; else draft.proxy_registration_timeout = v; onChange(); } });
  const el = h('div', {},
    h('div', { class: 'grid kv1' }, labelled('Bus type', (hints.bus_type || {}).tooltip || 'The protocol plugin; one per adapter agent.'), h('div', { class: 'row' }, typeSel, other, note(types.length ? `models: ${types.join(', ')}` : '')),
      labelled('Proxy registration timeout', (hints.proxy_registration_timeout || {}).tooltip), h('div', { class: 'row' }, timeout, note('s'))),
    h('h5', { style: { margin: '14px 0 4px' } }, 'Buses', h('span', { class: 'n' }, ' · one entry per remote bus, with the settings of the chosen bus type; its remote topics are managed on Bridges')), busesBox);
  renderBuses();
  el.getValue = () => draft;
  return el;
}

// The settings dialog behind ⚙ on Bridges and the Agents card: the agent's config entry minus the lists other tabs own.
export async function settingsDialog(identity) {
  const agent = agentOf(identity);
  let entry = null;
  try { entry = await api.entry(identity, 'config'); } catch { entry = null; }
  const draft = JSON.parse(JSON.stringify(entry && entry.data && typeof entry.data === 'object' ? entry.data : {}));
  const editor = configEditor(agent, draft);
  dialog({ title: `${agent.type} · ${identity} · settings`, width: 760, body: h('div', {}, editor, note(`Saved as ${identity} · config.`)),
    actions: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Save', primary: true, onClick: async (close) => {
      try { await api.putEntry(identity, 'config', { type: 'json', data: editor.getValue() }); close(); toast('saved', 'ok'); await refreshModel(false); } catch (e) { toast(e.message, 'err'); } } }] });
}

// The interoperability service's entry holds only lists other tabs own: mappings (Resources), formats (Formats) and
// transforms (Transforms). Shown as counts with links, both as the card's view and as the "form" behind Create.
export function serviceSummary(data) {
  const mappings = Array.isArray(data.mappings) ? data.mappings : [], formats = data.formats && typeof data.formats === 'object' ? Object.keys(data.formats) : [], transforms = Array.isArray(data.transforms) ? data.transforms : [];
  const canonical = mappings.filter((m) => /^canon/i.test(String(m.resource_type || ''))).length;
  const row = (label, text, page, tip) => [label, h('span', { class: 'row' }, text, btn(`Open ${page[0].toUpperCase()}${page.slice(1)} ▸`, () => navigate(page))), tip];
  return h('div', {}, kv([row('Mappings', `${canonical} canonical · ${mappings.length - canonical} aliases`, 'resources', 'The resources and aliases the service resolves; added and edited on Resources.'),
    row('Formats', `${formats.length} declared`, 'formats', 'Format declarations beyond the bundled ones; edited on Formats.'),
    row('Transforms', `${transforms.length} local`, 'transforms', 'Local transforms beyond the bundled ones; edited on Transforms.')]),
    note('The service has no settings of its own: this entry is the three lists above, each managed on its tab.'));
}
