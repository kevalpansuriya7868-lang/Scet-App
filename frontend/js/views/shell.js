import { h } from '../ui.js';
import { api } from '../api.js';
import { state, rerender } from '../state.js';

/** Common branded header; shows the logged-in username (admins: the audit identity). */
export function shell(subtitle, ...content) {
  const u = state.user;
  return h('div', {},
    h('header', { class: 'topbar' },
      h('img', { src: 'assets/sesuni.png', alt: 'Sarvajanik University' }),
      h('img', { src: 'assets/logo-footer.png', alt: 'SCET' }),
      h('div', { class: 'grow' }, h('h1', {}, 'SCET Lab Component & Issue Tracking System'), h('div', { class: 'sub' }, subtitle)),
      u && h('span', { class: 'chip' }, `${u.role === 'admin' ? 'Admin' : 'Student'}: ${u.username}`),
      u && h('button', { class: 'btn ghost sm', onclick: async () => { await api('/api/auth/logout', { method: 'POST' }); state.user = state.branch = null; rerender(); } }, 'Log out')),
    h('main', { class: 'wrap' }, ...content));
}
