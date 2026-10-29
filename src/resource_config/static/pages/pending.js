// Pending changes: the cart. Entries a multi-entry action produced, applied in dependency order.
import { api } from '../api.js';
import { h, note, btn, card, section, toast, kind } from '../ui.js';
import { state, refreshModel, collapseHandle } from '../app.js';
import { checksCard } from './common.js';

export const title = 'Pending changes';

export function render({ side, main, ctx }) {
  const entries = state.pending;
  if (side) side.append(h('h3', { class: 'ph' }, 'Pending', h('span', { class: 'sp' }), collapseHandle('side')), note(`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`));
  const rows = entries.map((e) => h('tr', {}, h('td', {}, e.identity), h('td', { class: 'mono' }, e.name), h('td', {}, e.delete ? 'delete' : e.type), h('td', {}, e.summary || ''), h('td', {}, h('a', { onClick: async () => { await api.discardPendingEntry(e.identity, e.name); await refreshModel(false); } }, 'drop'))));
  main.append(card({ title: h('span', { style: { fontSize: '18px', fontWeight: 600 } }, 'Pending changes'), badge: kind(`${entries.length}`), boxes: [],
    buttons: [btn('Apply in order', apply, { primary: true }), btn('Discard all', async () => { await api.discardPending(); await refreshModel(false); })],
    sections: [section('Entries', entries.length ? h('table', {}, h('tr', {}, h('th', {}, 'identity'), h('th', {}, 'entry'), h('th', {}, 'type'), h('th', {}, 'change'), h('th', {})), ...rows) : note('Nothing pending. Saving an object writes it immediately; a pending set forms only when one action touches several entries, such as adding an alias with a delivery.'),
      { note: 'applied in order: driver (registries first), then service mappings, then Resource Bridge and bus adapter, then other agents' })] }));
  if (ctx) ctx.append(h('h3', { class: 'ph' }, collapseHandle('ctx'), h('span', { class: 'sp' })), checksCard(entries.length ? [['ok', `${entries.length} entries ready`]] : []));
}
async function apply() {
  try { const r = await api.applyPending(); toast(`applied ${r.applied.length} entries`, 'ok'); await refreshModel(true); }
  catch (e) { toast(`apply stopped: ${e.message}`, 'err'); await refreshModel(true); }
}
