export const h = (tag, props = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat(Infinity).filter((k) => k != null && k !== false)); // strings become text nodes (XSS-safe)
  return el;
};

export function toast(msg, type = 'ok') {
  const t = h('div', { class: `toast ${type}` }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 4000);
}

export const field = (label, input) => h('label', { class: 'field' }, h('span', {}, label), input);

/** Build labelled inputs from a spec; returns {el, refs, values()}. */
export function fields(spec) {
  const refs = {}, el = h('div', { class: 'stack' });
  for (const s of spec) {
    const i = s.type === 'select' ? h('select', {}, ...s.options.map((o) => h('option', { value: o.value ?? o }, o.label ?? o)))
      : s.type === 'textarea' ? h('textarea', { rows: 3 })
      : h('input', { type: s.type || 'text', placeholder: s.placeholder || '', autocomplete: s.ac || 'off', min: s.min });
    if (s.value != null) i.value = s.value;
    if (s.onblur) i.addEventListener('blur', () => s.onblur(refs));
    refs[s.name] = i;
    el.append(field(s.label, i));
  }
  return { el, refs, values: () => Object.fromEntries(Object.entries(refs).map(([k, i]) => [k, i.value])) };
}

/** actions: [{label, cls, run(close)}]; run errors are shown as toasts. */
export function modal(title, body, actions = [], wide = false) {
  const close = () => ov.remove();
  const ov = h('div', { class: 'overlay', onmousedown: (e) => e.target === ov && close() },
    h('div', { class: `modal${wide ? ' wide' : ''}` }, h('h3', {}, title), body,
      h('div', { class: 'row end' },
        h('button', { class: 'btn ghost', onclick: close }, actions.length ? 'Cancel' : 'Close'),
        ...actions.map((a) => h('button', {
          class: `btn ${a.cls || 'primary'}`,
          onclick: async (e) => {
            e.target.disabled = true;
            try { await a.run(close); } catch (err) { toast(err.message, 'err'); } finally { e.target.disabled = false; }
          },
        }, a.label)))));
  document.body.append(ov);
  return close;
}

export const fmt = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const rupees = (n) => `₹${Number(n || 0).toFixed(2)}`;
export const badge = (text, kind) => h('span', { class: `badge b-${kind}` }, text);

export function countdown(dueIso) {
  const s = Math.floor((new Date(dueIso) - Date.now()) / 1000);
  const t = Math.abs(s), d = Math.floor(t / 86400), hr = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  if (s >= 0) return d ? `${d}d ${hr}h ${m}m left` : hr ? `${hr}h ${m}m ${sec}s left` : `${m}m ${sec}s left`;
  return d ? `OVERDUE ${d}d ${hr}h` : `OVERDUE ${hr}h ${m}m`;
}

export const table = (heads, rows) =>
  h('div', { class: 'tbl-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, heads.map((x) => h('th', {}, x)))), h('tbody', {}, rows)));

/** Resize to <=800px JPEG so each image stays well under Firestore's 1 MB document limit. */
export const resizeImage = (file, max = 800) => new Promise((res, rej) => {
  const img = new Image();
  img.onload = () => {
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src);
    res(c.toDataURL('image/jpeg', 0.72));
  };
  img.onerror = () => rej(new Error('Not a valid image file.'));
  img.src = URL.createObjectURL(file);
});
