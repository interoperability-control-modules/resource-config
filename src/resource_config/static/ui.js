// Small DOM helpers and the shared components of the design: chips, trees, the card, sections, schema forms, dialogs.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value' && (tag === 'input' || tag === 'textarea' || tag === 'select')) el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (typeof v === 'boolean') { if (v) el.setAttribute(k, ''); }
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}
export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export const text = (s) => document.createTextNode(s);

// ---- UAIs are boxed sets of chips, never slash-joined strings (except the one "published as" line).
export function uai(segments, { size = '', box = true, onClick } = {}) {
  const chips = h('span', { class: `chips${box ? ' uaibox' : ''}${size ? ' ' + size : ''}`, onClick, style: onClick ? { cursor: 'pointer' } : undefined },
    (segments || []).map((s) => h('span', { class: 'c', title: s }, shorten(s))));
  return chips;
}
export function shorten(segment) { return /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(segment) ? segment.slice(0, 4) + '…' : segment; }
export const dot = (status = 'ok') => h('span', { class: `dot${status === 'ok' ? '' : ' ' + status}` });
export const hollow = (status = 'ok') => h('span', { class: `hol${status === 'ok' ? '' : ' ' + status}` });
export const tag = (label) => h('span', { class: 'tag' }, label);
export const kind = (label, alias = false) => h('span', { class: `kind${alias ? ' alias' : ''}` }, label);
export const note = (...children) => h('span', { class: 'note' }, ...children);
export const btn = (label, onClick, { primary = false, small = true, title } = {}) =>
  h('span', { class: `btn${small ? ' sm' : ''}${primary ? ' pri' : ''}`, onClick, title }, label);
export const mb = (label, value) => h('span', { class: 'mb' }, label + ' ', h('b', {}, value));
export const info = (tip) => h('span', { class: 'note', title: tip }, 'ⓘ');

// ---- the card: header with identity, badges, boxes and buttons; sections; collapsed rows.
export function card({ title, badge, boxes = [], buttons = [], sections = [] }) {
  const el = h('div', { class: 'rc' },
    h('div', { class: 'rch2' },
      h('div', { class: 'l' }, h('div', { class: 'row1' }, title, badge), boxes.length ? h('div', { class: 'row2' }, ...boxes) : null),
      h('div', { class: 'r' }, ...buttons)),
    ...sections);
  return el;
}
export function section(title, body, { note: n, actions = [], collapsed = null, open = false } = {}) {
  if (collapsed !== null) {
    const row = h('div', { class: 'rsec col' });
    const head = h('h5', { style: { cursor: 'pointer' } }, h('span', { class: 'tri' }, open ? '▾ ' : '▸ '), title, n ? h('span', { class: 'n' }, ' · ', n) : null,
      h('span', { class: 'sp' }), ...actions);
    const content = h('div', { class: open ? '' : 'hidden', style: { padding: '8px 0 2px' } });
    const fill = () => { if (!content.hasChildNodes()) append(content, [typeof body === 'function' ? body() : body]); };
    if (open) fill();
    head.addEventListener('click', (e) => { if (e.target.closest('.btn,a')) return; const shown = content.classList.toggle('hidden'); head.querySelector('.tri').textContent = shown ? '▸ ' : '▾ '; if (!shown) fill(); });
    row.append(head, content);
    return row;
  }
  return h('div', { class: 'rsec' }, h('h5', {}, title, n ? h('span', { class: 'n' }, ' · ', n) : null, h('span', { class: 'sp' }), ...actions), body);
}
export function kv(rows, cols = 1) {
  const el = h('div', { class: `grid kv${cols}` });
  for (const [label, value, tip] of rows) {
    if (value === undefined) continue;
    el.append(h('span', { class: 'k' }, label, tip ? [' ', info(tip)] : null), h('span', { class: 'v' }, value));
  }
  return el;
}
export const steps = (path, labels = {}) => h('div', { class: 'steps2' }, ...(path || []).flatMap((f, i) => [
  i ? h('div', { class: 'ar' }, '→') : null,
  h('div', { class: `s${i === 0 || i === path.length - 1 ? ' end' : (labels.hubs || []).includes(f) ? ' hub' : ''}` }, f, labels[f] ? h('small', {}, labels[f]) : null)]));
export const meter = (fraction) => h('div', { class: 'meter' }, h('i', { style: { width: `${Math.round((fraction || 0) * 100)}%` } }));

// ---- dialogs and toasts
export function dialog({ title, body, actions = [], width = 760 }) {
  const overlay = h('div', { class: 'overlay' });
  const close = () => overlay.remove();
  const box = h('div', { class: 'dialog', style: { width: `${width}px` } }, h('h4', {}, title), h('div', { class: 'body' }, body),
    h('div', { class: 'bar', style: { padding: '0 16px 14px' } }, h('span', { class: 'sp' }), ...actions.map((a) => btn(a.label, () => a.onClick(close), { primary: a.primary, small: false }))));
  overlay.append(box);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.append(overlay);
  return close;
}
export function toast(message, level = '') {
  const el = h('div', { class: `toast ${level}` }, message);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), level === 'err' ? 8000 : 3500);
}
export function confirmDialog(message, onYes) {
  dialog({ title: 'Please confirm', body: h('div', {}, message), width: 460,
    actions: [{ label: 'Cancel', onClick: (close) => close() }, { label: 'Yes', primary: true, onClick: (close) => { close(); onYes(); } }] });
}

// ---- inputs
export function input(value, { type = 'text', placeholder, width, onChange, mono = false, num = false, list } = {}) {
  const el = h('input', { class: `in${mono ? ' mono' : ''}${num ? ' num' : ''}`, type, value: value ?? '', placeholder, list,
    style: width ? { width } : undefined });
  el.addEventListener('change', () => onChange && onChange(num && el.value !== '' ? Number(el.value) : el.value));
  return el;
}
export function select(value, options, { onChange, width, blank } = {}) {
  const el = h('select', { class: 'in', style: width ? { width } : undefined });
  if (blank !== undefined) el.append(h('option', { value: '' }, blank));
  for (const o of options) { const [v, label] = Array.isArray(o) ? o : [o, o]; el.append(h('option', { value: v, selected: String(v) === String(value) }, label)); }
  el.addEventListener('change', () => onChange && onChange(el.value));
  return el;
}
export function checkbox(checked, onChange) {
  const el = h('input', { type: 'checkbox', class: 'box', checked });
  el.addEventListener('change', () => onChange && onChange(el.checked));
  return el;
}
export function radios(name, value, options, onChange) {
  return h('div', { class: 'row' }, ...options.map(([v, label, n]) => {
    const r = h('input', { type: 'radio', class: 'rad', name, checked: v === value });
    r.addEventListener('change', () => r.checked && onChange(v));
    return h('label', { class: 'chk' }, r, label, n ? [' ', note(n)] : null);
  }));
}

// ---- a form generated from a JSON Schema with x-hints (CONFIGURATION_UI_DESIGN_V3.md, section 4).
export function schemaForm(schema, value, { onChange, hide = [], groups = null, defaults = {} } = {}) {
  const props = schema.properties || {}, hints = schema['x-hints'] || {}, defs = schema.$defs || {};
  const state = { ...value };
  const advanced = [], visible = [];
  for (const [name, prop] of Object.entries(props)) {
    if (hide.includes(name)) continue;
    ((hints[name] || {}).advanced ? advanced : visible).push([name, prop]);
  }
  const groupOf = (name) => (hints[name] || {}).group || (groups && Object.entries(groups).find(([, names]) => names.includes(name))?.[0]) || '';
  const byGroup = new Map();
  for (const entry of visible) { const g = groupOf(entry[0]); if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(entry); }
  const container = h('div', {});
  const rowsFor = (entries) => {
    const grid = h('div', { class: 'grid kv1' });
    for (const [name, prop] of entries) {
      const hint = hints[name] || {};
      const control = controlFor(name, prop, defs, state[name], hint, defaults[name], (v) => { state[name] = v; onChange && onChange(name, v, state); });
      const label = h('span', { class: 'k' }, prettyName(name), hint.tooltip ? [' ', info(hint.tooltip)] : null);
      const matches = (v, actual) => (Array.isArray(v) ? v.map(String).includes(actual) : String(v) === actual);
      const show = hint.show_when ? () => Object.entries(hint.show_when).every(([k, v]) => matches(v, String(state[k] ?? defaults[k] ?? ''))) : null;
      const row = [label, h('span', { class: 'v', style: { display: 'flex', alignItems: 'center', gap: '6px' } }, control, hint.unit ? note(hint.unit) : null)];
      if (show) { const update = () => row.forEach((r) => r.classList.toggle('hidden', !show())); update(); container.addEventListener('rc:change', update); }
      grid.append(...row);
    }
    return grid;
  };
  const groupsEls = [...byGroup.entries()].map(([g, entries]) => h('div', { style: { minWidth: 0 } },
    g ? h('h6', { style: { margin: '0 0 6px', fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' } }, g) : null, rowsFor(entries)));
  container.append(byGroup.size > 1 ? h('div', { class: 'two', style: { gap: '24px', alignItems: 'start' } }, ...groupsEls) : groupsEls[0] || h('div', {}));
  if (advanced.length) {
    const changed = advanced.filter(([name]) => state[name] !== undefined && JSON.stringify(state[name]) !== JSON.stringify(props[name].default)).length;
    container.append(section('Advanced', () => rowsFor(advanced), { collapsed: true, note: `${advanced.length} fields, ${changed ? changed + ' not at their defaults' : 'all at their defaults'}` }));
  }
  container.getValue = () => state;
  container.addEventListener('change', () => container.dispatchEvent(new CustomEvent('rc:change')));
  return container;
}
function controlFor(name, prop, defs, value, hint, placeholderDefault, onChange) {
  const resolved = resolveProp(prop, defs);
  const enumValues = resolved.enum;
  const types = typesOf(resolved);
  const ph = placeholderDefault !== undefined ? String(placeholderDefault) : (prop.default !== undefined && prop.default !== null && typeof prop.default !== 'object' ? String(prop.default) : '');
  if (enumValues) return select(value ?? '', enumValues.map((e) => [e, String(e)]), { onChange: (v) => onChange(coerce(v, types)), blank: value === undefined || value === null ? `${ph || '—'}` : undefined, width: '200px' });
  if (types.has('boolean') && types.size <= 2) return checkbox(!!value, onChange);
  if (types.has('integer') || types.has('number')) return input(value ?? '', { num: true, width: '110px', placeholder: ph, onChange: (v) => onChange(v === '' ? null : v) });
  if (types.has('array') || types.has('object')) {
    const area = h('textarea', { class: 'in mono', style: { width: '100%', minHeight: '60px', fontFamily: 'ui-monospace,Menlo,Consolas,monospace', fontSize: '12px' } }, value === undefined ? '' : JSON.stringify(value, null, 1));
    area.addEventListener('change', () => { try { onChange(area.value.trim() ? JSON.parse(area.value) : null); area.classList.remove('errrow'); } catch { area.classList.add('errrow'); } });
    return area;
  }
  return input(value ?? '', { placeholder: ph, width: '260px', onChange: (v) => onChange(v === '' ? null : v) });
}
function resolveProp(prop, defs) {
  if (prop.$ref && prop.$ref.startsWith('#/$defs/')) return { ...defs[prop.$ref.slice(8)], ...prop, $ref: undefined };
  if (prop.anyOf) { const alt = prop.anyOf.find((a) => a.type !== 'null') || prop.anyOf[0]; return { ...prop, ...resolveProp(alt, defs), anyOf: undefined }; }
  return prop;
}
function typesOf(prop) {
  const set = new Set();
  const add = (p) => { if (!p) return; if (p.type) (Array.isArray(p.type) ? p.type : [p.type]).forEach((t) => set.add(t)); (p.anyOf || []).forEach(add); if (p.enum) set.add(typeof p.enum[0]); };
  add(prop);
  return set;
}
function coerce(v, types) { if (v === '') return null; if (types.has('integer')) return Number.isNaN(Number(v)) ? v : Number(v); if (types.has('boolean')) return v === 'true'; return v; }
export function prettyName(name) { return name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()); }
export function ago(seconds) { if (seconds == null) return '—'; if (seconds < 60) return `${Math.round(seconds)} s ago`; if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`; return `${(seconds / 3600).toFixed(1)} h ago`; }
