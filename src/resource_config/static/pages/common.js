// Pieces several pages share: the raw entry editor, the card menu, health and checks cards, service-config writes.
import { api } from '../api.js';
import { h, btn, dialog, toast, note, kv, dot, confirmDialog, steps, meter } from '../ui.js';
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
export function deleteWithDependents(label, dependents, onDelete) {
  if (dependents.length) { toast(`${label} still has dependents: ${dependents.join(', ')}`, 'err'); return; }
  confirmDialog(`Delete ${label}?`, onDelete);
}
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
