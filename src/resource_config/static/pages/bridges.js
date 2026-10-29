// Bridges: device bridges of the Resource Bridge as a source tree; remote topics of the bus adapter grouped by bus.
import { api } from '../api.js';
import { h, uai, dot, tag, kind, note, btn, mb, card, section, kv, steps, meter, toast, dialog, select, input, radios, checkbox } from '../ui.js';
import { state, navigate, refreshModel, collapseHandle } from '../app.js';
import { rawEditor, menu, checksCard, healthCard, chainReport, activityCard } from './common.js';

export const title = 'Bridges';
export const railBadges = (s) => [h('span', { class: 'pill n' }, String(s.model.bridges.length + s.model.remote_topics.length))];

export function render({ side, main, ctx, params }) {
  const m = state.model;
  const bridge = m.bridges.find((b) => b.name === params.bridge) || (!params.topic ? m.bridges[0] : null);
  const remote = params.topic ? m.remote_topics.find((t) => t.topic === params.topic) : null;
  if (side) side.append(tree(m, bridge, remote));
  if (remote) renderRemote(main, ctx, remote);
  else if (bridge) renderBridge(main, ctx, bridge);
  else main.append(h('div', { class: 'empty' }, 'No bridges or remote topics. ', btn('+ Device bridge', addBridge), ' ', btn('+ Remote topic', addRemote)));
}
function tree(m, bridge, remote) {
  const el = h('div', {}, h('h3', { class: 'ph' }, 'Bridges', h('span', { class: 'sp' }), collapseHandle('side')));
  el.append(h('div', { class: 'grp' }, 'Device bridges ', h('span', { class: 'n' }, String(m.bridges.length)), h('span', { class: 'sp', style: { flex: 1 } }), h('span', { class: 'hd', onClick: () => rawEditor('platform.resource_bridge', 'config') }, '⚙ Resource Bridge')));
  const bySource = new Map();
  for (const b of m.bridges) { const k = b.source.uai.join('/') + (b.source.bus ? '|bus' : ''); if (!bySource.has(k)) bySource.set(k, []); bySource.get(k).push(b); }
  const bt = h('div', { class: 'btree' });
  for (const [, list] of bySource) { const s = list[0].source;
    const box = h('div', { class: 'src', style: list.every((b) => !b.enabled) ? { opacity: .55 } : undefined }, h('div', { class: 'h' }, dot(list.some((b) => b.enabled) ? 'ok' : 'off'), h('span', { class: 'ic' }, s.bus ? '◎' : '▣'), uai(s.uai)));
    list.forEach((b, i) => box.append(h('div', { class: `tg${i === list.length - 1 ? ' last' : ''}${bridge === b ? ' on' : ''}`, style: { cursor: 'pointer' }, onClick: () => navigate('bridges', { bridge: b.name }) }, h('span', { class: 'ic' }, '→'), h('span', { class: 'ic' }, b.target.bus ? '◎' : '▣'), uai(b.target.uai))));
    bt.append(box); }
  el.append(bt, h('div', { class: 'bar', style: { marginTop: '4px' } }, btn('+ Device bridge', addBridge)));
  el.append(h('div', { class: 'grp', style: { marginTop: '14px' } }, 'Remote topics ', h('span', { class: 'n' }, String(m.remote_topics.length)), h('span', { class: 'sp', style: { flex: 1 } }), h('span', { class: 'hd', onClick: () => rawEditor('platform.bus_adapter', 'config') }, '⚙ bus adapter')));
  const byBus = new Map();
  for (const t of m.remote_topics) { if (!byBus.has(t.bus)) byBus.set(t.bus, []); byBus.get(t.bus).push(t); }
  const rtl = h('div', { class: 'rtl' });
  for (const [bus, list] of byBus) { rtl.append(h('div', { class: 'grp' }, bus, ' ', h('span', { class: 'n' }, String(list.length)), ' ', note(list[0].bus_type || '')));
    for (const t of list) rtl.append(h('div', { class: `row${remote === t ? ' on' : ''}`, style: { cursor: 'pointer' }, onClick: () => navigate('bridges', { topic: t.topic }) }, dot(t.alias ? 'ok' : 'warn'), h('span', { class: 'ic', title: t.direction }, t.direction === 'outbound' ? '⇈' : '⇊'), uai(t.topic.split('/')), t.wildcard ? tag('wildcard') : null)); }
  el.append(rtl, h('div', { class: 'bar', style: { marginTop: '4px' } }, btn('+ Remote topic', addRemote)), h('div', { class: 'legend' }, h('span', {}, '▣ device end'), h('span', {}, '◎ bus topic end'), h('span', {}, '⇈ outbound'), h('span', {}, '⇊ inbound')));
  return el;
}
function renderBridge(main, ctx, b) {
  const m = state.model;
  const resOf = (end) => (end.bus ? m.resources.aliases : m.resources.canonical).find((r) => r.topic === end.uai.join('/'));
  const sRes = resOf(b.source), tRes = resOf(b.target);
  const sDev = sRes && sRes.kind === 'canonical' && sRes.source && sRes.source.kind === 'device' ? m.devices.find((d) => d.topic === sRes.source.device) : null;
  const tDev = tRes && tRes.kind === 'canonical' && tRes.source && tRes.source.kind === 'device' ? m.devices.find((d) => d.topic === tRes.source.device) : null;
  const chainBox = h('div', {}, note('resolving the write chain…'));
  if (sRes && tRes) api.resolve(b.target.uai, sRes.format, 'write').then((r) => chainBox.replaceChildren(steps(r.path || []), h('div', { class: 'row', style: { marginTop: '8px' } }, h('div', { style: { flex: 1 } }, meter(r.retention)), note(`retention ${r.retention != null ? Math.round(r.retention * 100) + ' %' : '—'}`))))
    .catch((e) => chainBox.replaceChildren(h('span', { class: 'warn' }, `no chain: ${e.message} `), btn('Create transform ▸', () => navigate('transforms', { input: sRes.format, output: tRes.format, new: 1 }))));
  else chainBox.replaceChildren(h('span', { class: 'warn' }, 'an end does not resolve to a resource'));
  const endKv = (end, res, dev, isSource) => kv([['UAI', uai(end.uai)], ['Kind', end.bus ? 'bus topic' : 'device'], ['Format', res ? res.format : h('span', { class: 'warn' }, 'does not resolve')],
    isSource ? ['Points', b.points ? b.points.join(', ') : 'all'] : null, isSource ? ['Reads', h('span', { class: 'mono' }, end.bus ? (end.topic || end.uai.join('/')) : (res && res.publication_topic) || '—')] : ['Writes', h('span', { class: 'mono' }, end.bus ? (end.topic || end.uai.join('/')) : (res && res.rpc_topic) || '—')],
    isSource ? null : ['Write policy', b.write_unchanged ? 'write every point' : 'changes only', 'By default only changed values are written. write_unchanged writes every point on every message.']].filter(Boolean));
  main.append(card({ title: h('span', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, uai(b.source.uai, { box: false }), h('span', { style: { color: 'var(--muted)', fontSize: '18px' } }, '→'), uai(b.target.uai, { box: false })), badge: kind('device bridge'),
    boxes: [mb('chain', sRes && tRes ? `${sRes.format} → … → ${tRes.format}` : '—'), mb('enabled', b.enabled ? 'yes' : 'no')],
    buttons: [btn(b.enabled ? 'Disable' : 'Enable', () => toggleBridge(b)), btn('Raw JSON', () => rawEditor('platform.resource_bridge', 'config')), btn('⋯', (e) => menu(e.target, [{ header: 'Layout' }, { layout: true }, { header: 'This bridge' }, { label: 'Delete…', danger: true, onClick: () => deleteBridge(b) }]))],
    sections: [section('Ends', h('div', { class: 'two', style: { gap: '24px' } }, h('div', {}, h('h5', { style: { margin: '0 0 8px' } }, 'Source · read from'), endKv(b.source, sRes, sDev, true)), h('div', {}, h('h5', { style: { margin: '0 0 8px' } }, 'Target · written to'), endKv(b.target, tRes, tDev, false)))),
      section('How this resolves', chainBox, { note: 'write', actions: sRes && tRes ? [btn('Chain report ▸', () => chainReport(sRes.format, tRes.format))] : [] }),
      section('Delivery policy', () => note('reserved for the resource library\'s models (each · complete · merge · interval · trigger)'), { collapsed: true, note: 'not yet' })] }));
  if (ctx) ctx.append(h('h3', { class: 'ph' }, collapseHandle('ctx'), h('span', { class: 'sp' })),
    checksCard([[sRes ? 'ok' : 'err', sRes ? 'source resolves' : 'source does not resolve'], [tRes ? 'ok' : 'err', tRes ? 'target resolves' : 'target does not resolve'],
      ...(tDev && tDev.registry_rows && tDev.driver_role !== 'client' ? [[tDev.registry_rows.some((r) => (r['Data Source'] || '').toLowerCase() === 'server') ? 'ok' : 'warn', 'target rows writable (Data Source = server)']] : []),
      ...(m.bridges.some((o) => o !== b && o.source.uai.join('/') === b.target.uai.join('/') && o.target.uai.join('/') === b.source.uai.join('/')) ? [['warn', 'pairs with a bridge in the other direction: the echo window applies']] : [])]),
    h('div', { class: 'card' }, h('h4', {}, 'Write tracking'), note('Only changes are written. What the target holds is known from its publications, this agent\'s writes and the driver\'s last RPC when older than stale_after.')),
    activityCard(b.stats));
}
function renderRemote(main, ctx, t) {
  const alias = state.model.resources.aliases.find((a) => a.topic === t.alias || a.topic === t.topic);
  main.append(card({ title: h('span', { class: 'mono', style: { fontSize: '15px', fontWeight: 600 } }, t.topic), badge: kind('remote topic', true), boxes: [mb('bus', `${t.bus} · ${t.bus_type || ''}`), mb('direction', t.direction)],
    buttons: [btn('Raw JSON', () => rawEditor('platform.bus_adapter', 'config')), btn('⋯', (e) => menu(e.target, [{ header: 'Layout' }, { layout: true }, { header: 'This topic' }, { label: 'Delete…', danger: true, onClick: () => deleteRemote(t) }]))],
    sections: [section('Relay', kv([['Bus', `${t.bus} · ${t.bus_type || ''}`], ['Direction', t.direction === 'inbound' ? 'inbound · remote → local' : 'outbound · local → remote'], ['Remote topic', h('span', { class: 'mono' }, t.topic)], ['Local topic', h('span', { class: 'mono' }, t.topic, ' ', note('· the same, with origin headers'))], ['Strict', t.direction === 'inbound' ? 'yes · no longest-prefix fallback' : '—']]), { note: 'the bus adapter copies the topic between the buses' }),
      section('Alias this topic names', alias ? h('div', { class: 'subcard' }, h('span', { class: 'hol' }), uai(alias.uai, { box: false, onClick: () => navigate('resources', { alias: alias.topic }) }), kind('alias', true), note(`format ${alias.format} · wire ${alias.encoding}${alias.edition ? ' · edition ' + alias.edition : ''}`), h('span', { class: 'sp' }), btn('Open alias ▸', () => navigate('resources', { alias: alias.topic })))
        : h('div', { class: 'warn' }, 'no alias is registered under this topic: the adapter cannot decode or encode it'), { note: 'what the payload is decoded with · edited on Resources' })] }));
  if (ctx) ctx.append(h('h3', { class: 'ph' }, collapseHandle('ctx'), h('span', { class: 'sp' })), checksCard([[alias ? 'ok' : 'err', alias ? 'topic names a registered alias' : 'topic names no alias'], [t.wildcard ? 'warn' : 'ok', t.wildcard ? 'wildcard: every topic a remote publishes under it reaches the adapter' : 'exact topic']]),
    h('div', { class: 'card' }, h('h4', {}, 'Bus adapter'), h('div', { class: 'hrow' }, h('span', {}, 'buses'), h('span', {}, `${state.model.buses.length} · ${state.model.buses.map((b) => b.name).join(', ')}`)), h('div', { class: 'bar', style: { marginTop: '6px' } }, btn('Adapter settings ▸', () => rawEditor('platform.bus_adapter', 'config')))));
}
async function toggleBridge(b) { await mutateBridges((list) => list.map((x) => (x === b.raw || sameBridge(x, b) ? { ...x, enabled: !b.enabled } : x))); }
async function deleteBridge(b) { await mutateBridges((list) => list.filter((x) => !sameBridge(x, b))); navigate('bridges'); }
const sameBridge = (raw, b) => JSON.stringify(raw) === JSON.stringify(b.raw);
async function mutateBridges(fn) { try { const entry = await api.entry('platform.resource_bridge', 'config').catch(() => ({ data: { bridges: [] } })); const data = { ...(entry.data || {}) }; data.bridges = fn(data.bridges || []); await api.putEntry('platform.resource_bridge', 'config', { type: 'json', data }); toast('saved', 'ok'); await refreshModel(false); } catch (e) { toast(e.message, 'err'); } }
function addBridge() {
  const m = state.model; const form = { source: '', sourceBus: false, target: '', targetBus: false, write_unchanged: false };
  const options = (bus) => (bus ? m.resources.aliases : m.resources.canonical).map((r) => [r.topic, r.topic]);
  const sourceSel = select('', options(false), { blank: 'choose…', onChange: (v) => (form.source = v), width: '100%' }), targetSel = select('', options(false), { blank: 'choose…', onChange: (v) => (form.target = v), width: '100%' });
  const rebuild = (sel, bus, key) => { const cur = form[key]; sel.replaceChildren(h('option', { value: '' }, 'choose…'), ...options(bus).map(([v, l]) => h('option', { value: v, selected: v === cur }, l))); };
  dialog({ title: 'Add a device bridge', width: 720, body: h('div', { class: 'two', style: { gap: '24px' } },
    h('div', {}, h('h5', {}, 'Source · read from'), radios('sk', 'device', [['device', 'device'], ['bus', 'bus topic']], (v) => { form.sourceBus = v === 'bus'; rebuild(sourceSel, form.sourceBus, 'source'); }), sourceSel),
    h('div', {}, h('h5', {}, 'Target · written to'), radios('tk', 'device', [['device', 'device'], ['bus', 'bus topic']], (v) => { form.targetBus = v === 'bus'; rebuild(targetSel, form.targetBus, 'target'); }), targetSel, h('label', { class: 'chk', style: { marginTop: '8px' } }, checkbox(false, (v) => (form.write_unchanged = v)), ' write unchanged'))),
    actions: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Save', primary: true, onClick: async (close) => { if (!form.source || !form.target) return toast('both ends are required', 'err');
      await mutateBridges((list) => [...list, { source: form.sourceBus ? { uai: form.source.split('/'), bus: true } : form.source.split('/'), target: form.targetBus ? { uai: form.target.split('/'), bus: true } : form.target.split('/'), ...(form.write_unchanged ? { write_unchanged: true } : {}) }]); close(); } }] });
}
function addRemote() {
  const m = state.model; const form = { bus: (m.buses[0] || {}).name || '', direction: 'outbound', topic: '' };
  dialog({ title: 'Add a remote topic', width: 640, body: h('div', { class: 'grid kv1' }, h('span', { class: 'k' }, 'Bus'), select(form.bus, m.buses.map((b) => [b.name, `${b.name} · ${b.bus_type || ''}`]), { onChange: (v) => (form.bus = v), width: '260px' }),
    h('span', { class: 'k' }, 'Direction'), radios('rd', 'outbound', [['outbound', 'outbound', 'local → remote'], ['inbound', 'inbound', 'remote → local']], (v) => (form.direction = v)),
    h('span', { class: 'k' }, 'Topic'), select('', m.resources.aliases.map((a) => [a.topic, a.topic]), { blank: 'an alias UAI…', onChange: (v) => (form.topic = v), width: '100%' })),
    actions: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Save', primary: true, onClick: async (close) => { if (!form.topic || !form.bus) return toast('bus and topic are required', 'err');
      try { const entry = await api.entry('platform.bus_adapter', 'config'); const data = { ...entry.data }; data.adapters = (data.adapters || []).map((a) => ({ ...a })); const adapter = data.adapters.find((a) => (a.name || a.host) === form.bus); if (!adapter) throw new Error('bus not found');
        const key = form.direction === 'outbound' ? 'local_subscriptions' : 'remote_subscriptions'; adapter[key] = [...new Set([...(adapter[key] || []), form.topic])];
        await api.putEntry('platform.bus_adapter', 'config', { type: 'json', data }); close(); toast('saved', 'ok'); await refreshModel(false); navigate('bridges', { topic: form.topic }); } catch (e) { toast(e.message, 'err'); } } }] });
}
async function deleteRemote(t) {
  try { const entry = await api.entry('platform.bus_adapter', 'config'); const data = { ...entry.data }; data.adapters = (data.adapters || []).map((a) => ({ ...a, local_subscriptions: (a.local_subscriptions || []).filter((x) => !(x === t.topic && t.direction === 'outbound')), remote_subscriptions: (a.remote_subscriptions || []).filter((x) => !(x === t.topic && t.direction === 'inbound')) }));
    await api.putEntry('platform.bus_adapter', 'config', { type: 'json', data }); toast('deleted', 'ok'); await refreshModel(false); navigate('bridges'); } catch (e) { toast(e.message, 'err'); }
}
