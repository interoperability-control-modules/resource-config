// Pieces several pages share: the raw entry editor, the card menu, health and checks cards, service-config writes.
import { api } from '../api.js';
import { h, btn, dialog, toast, note, kv, dot, confirmDialog } from '../ui.js';
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
