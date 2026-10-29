// Transforms: the local transforms of the service config; the pattern as a tree with dotted source paths.
import { api } from '../api.js';
import { h, kind, note, btn, mb, card, section, toast, dialog } from '../ui.js';
import { state, navigate, refreshModel, collapseHandle } from '../app.js';
import { rawEditor, menu, checksCard, chainReport } from './common.js';

export const title = 'Transforms';
export const railBadges = (s) => [h('span', { class: 'pill n' }, String(s.model.transforms.length))];

export function render({ side, main, ctx, params }) {
  const transforms = state.model.transforms;
  const selected = transforms.find((t) => t.input === params.input && t.output === params.output) || (params.new ? null : transforms[0]);
  if (side) {
    side.append(h('h3', { class: 'ph' }, 'Transforms', h('span', { class: 'sp' }), collapseHandle('side')));
    const groups = [['bundled', 'Bundled'], ['replaces bundled', 'Replaces bundled'], ['local', 'Local']];
    for (const [kind, label] of groups) {
      const items = transforms.filter((t) => (t.kind || 'local') === kind);
      if (!items.length) continue;
      side.append(h('div', { class: 'grp' }, label, ' ', h('span', { class: 'n' }, String(items.length))),
        h('div', { class: 'tree' }, ...items.map((t) => h('div', { class: selected === t ? 'sel' : '', onClick: () => navigate('transforms', { input: t.input, output: t.output }) }, `${t.input} → ${t.output}`))));
    }
    if (!state.model.transforms_live) side.append(h('div', { class: 'note', style: { marginTop: '8px' } }, 'Only the local transforms of the service config are listed: the service did not answer list_transforms.'));
    side.append(h('div', { class: 'bar' }, btn('+ Transform', () => newTransform(params.input, params.output))));
  }
  if (params.new) { newTransform(params.input, params.output); return; }
  if (!selected) { main.append(h('div', { class: 'empty' }, 'No local transforms. ', btn('+ Transform', () => newTransform()))); return; }
  const t = selected;
  const patternBox = h('div', {});
  if (t.pattern) patternBox.append(patternTree(t.pattern));
  else api.describeTransform(t.input, t.output).then((d) => { t.pattern = d.pattern; patternBox.replaceChildren(patternTree(d.pattern)); }).catch((e) => patternBox.replaceChildren(h('div', { class: 'warn' }, `describe_transform: ${e.message}`)));
  const isBundled = t.kind === 'bundled';
  main.append(card({ title: h('span', { style: { fontSize: '18px', fontWeight: 600 } }, `${t.input} → ${t.output}`), badge: kind(t.kind || 'local', t.kind !== 'bundled'), boxes: [mb('input', t.input), mb('output', t.output), t.retention != null ? mb('retention', `${Math.round(t.retention * 100)} %`) : null, t.fields != null ? mb('fields', `${t.fields} mapped${t.unmapped_targets ? ' · ' + t.unmapped_targets + ' null' : ''}`) : mb('fields', String(countLeaves(t.pattern)))],
    buttons: [isBundled ? btn('Modify (replaces the bundled edge)', () => editPattern(t)) : btn('Edit', () => editPattern(t)), btn('Chain report ▸', () => chainReport(t.input, t.output)), btn('Raw JSON', () => rawEditor('platform.presentation', 'config')), btn('⋯', (e) => menu(e.target, [{ header: 'Layout' }, { layout: true }, { header: 'This transform' }, ...(isBundled ? [] : [{ label: 'Delete…', danger: true, onClick: () => deleteTransform(t) }])]))],
    sections: [section('Pattern', patternBox, { note: isBundled ? 'bundled · read-only until Modify' : 'one row per output field · source paths dotted · functions as written' })] }));
  if (ctx) ctx.append(h('h3', { class: 'ph' }, collapseHandle('ctx'), h('span', { class: 'sp' })), checksCard([['ok', `${countLeaves(t.pattern)} output fields`]]),
    h('div', { class: 'card' }, h('h4', {}, 'Coverage'), t.retention != null ? h('div', {}, h('div', { class: 'hrow' }, h('span', {}, 'retention'), h('span', {}, `${Math.round(t.retention * 100)} %`)), h('div', { class: 'hrow' }, h('span', {}, 'mapped'), h('span', {}, String(t.fields ?? '—'))), h('div', { class: 'hrow' }, h('span', {}, 'null targets'), h('span', {}, String(t.unmapped_targets ?? '—')))) : note('the service did not answer list_transforms')));
}
function patternTree(pattern, depth = 0) {
  const el = h('div', { class: 'bld' });
  if (depth === 0) el.append(h('div', { class: 'r h' }, h('span', {}, 'output key'), h('span', {}, 'source path'), h('span', {}, 'functions')));
  for (const [key, value] of Object.entries(pattern || {})) {
    if (value && typeof value === 'object') { el.append(h('div', { class: `r g i${Math.min(depth, 3)}` }, h('span', { class: 'k' }, '▾ ', key, key.endsWith('[#]') ? [' ', h('span', { class: 'tag' }, 'repeated')] : null), h('span', {}), h('span', {})), ...patternTree(value, depth + 1).children); continue; }
    const parsed = parseExpression(String(value ?? 'null'));
    el.append(h('div', { class: `r i${Math.min(depth, 3)}` }, h('span', { class: 'k' }, key), h('span', { class: 'p' }, parsed.path), h('span', { class: 'f' }, parsed.functions)));
  }
  return el;
}
function parseExpression(expr) {
  const m = expr.match(/^transform(?:\[(.*?)\])?\((.*)\)$/s);
  if (!m) return { path: expr === 'null' ? '—' : '', functions: expr === 'null' ? note('no source') : expr };
  const path = (m[1] || '').split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean).join('.');
  return { path: path || '(the output key)', functions: m[2] || '' };
}
const countLeaves = (p) => Object.values(p || {}).reduce((n, v) => n + (v && typeof v === 'object' ? countLeaves(v) : 1), 0);
function editPattern(t) {
  const area = h('textarea', { class: 'in mono' }, JSON.stringify(t.pattern, null, 2));
  dialog({ title: `${t.input} → ${t.output} · pattern`, width: 860, body: h('div', {}, area, note('The pattern as the service stores it; the builder with the pipeline editor and path picker follows once compile_pattern is exported.')),
    actions: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Check', onClick: async () => { try { const r = await api.compilePattern(JSON.parse(area.value), t.input); toast(r.ok ? `compiles · ${r.mappings.length} mappings · ${r.unmapped_targets.length} unmapped${r.unknown_sources && r.unknown_sources.length ? ' · unknown sources: ' + r.unknown_sources.join(', ') : ''}` : `does not compile: ${r.error}`, r.ok ? 'ok' : 'err'); } catch (e) { toast(e.message, 'err'); } } },
      { label: 'Save', primary: true, onClick: async (close) => { try { const pattern = JSON.parse(area.value); const r = await api.compilePattern(pattern, t.input).catch(() => ({ ok: true })); if (!r.ok) return toast(`not saved: ${r.error}`, 'err'); await saveTransform(t.input, t.output, pattern); close(); toast('saved', 'ok'); } catch (e) { toast(e.message, 'err'); } } }] });
}
function newTransform(input = '', output = '') {
  const formats = state.model.formats.map((f) => f.name).sort();
  let i = input, o = output; const area = h('textarea', { class: 'in mono', style: { minHeight: '200px' } }, '{\n  "#": "transform(device_values())"\n}');
  dialog({ title: 'New transform', width: 860, body: h('div', {}, h('div', { class: 'row', style: { marginBottom: '8px' } }, h('select', { class: 'in', onChange: (e) => (i = e.target.value) }, h('option', { value: '' }, 'input format…'), ...formats.map((f) => h('option', { value: f, selected: f === i }, f))),
    '→', h('select', { class: 'in', onChange: (e) => (o = e.target.value) }, h('option', { value: '' }, 'output format…'), ...formats.map((f) => h('option', { value: f, selected: f === o }, f)))), area),
    actions: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Save', primary: true, onClick: async (close) => { if (!i || !o) return toast('both formats are required', 'err'); try { await saveTransform(i, o, JSON.parse(area.value)); close(); navigate('transforms', { input: i, output: o }); } catch (e) { toast(e.message, 'err'); } } }] });
}
async function saveTransform(input, output, pattern) {
  const entry = await api.entry('platform.presentation', 'config').catch(() => ({ data: {} }));
  const data = { ...(entry.data || {}) }; data.transforms = (data.transforms || []).filter((t) => !(t.input_format === input && t.output_format === output));
  data.transforms.push({ input_format: input, output_format: output, pattern });
  await api.putEntry('platform.presentation', 'config', { type: 'json', data }); await refreshModel(false);
}
async function deleteTransform(t) {
  try { const entry = await api.entry('platform.presentation', 'config'); const data = { ...entry.data }; data.transforms = (data.transforms || []).filter((x) => !(x.input_format === t.input && x.output_format === t.output)); await api.putEntry('platform.presentation', 'config', { type: 'json', data }); toast('deleted', 'ok'); await refreshModel(false); navigate('transforms'); } catch (e) { toast(e.message, 'err'); }
}
