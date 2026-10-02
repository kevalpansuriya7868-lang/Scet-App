import { api } from '../api.js';
import { state, rerender } from '../state.js';
import { h } from '../ui.js';
import { shell } from './shell.js';
import { inventoryTab } from './inventory.js';
import { ledgerTab } from './ledger.js';
import { requestAuditTab } from './requestAudit.js';
import { reportsTab } from './tools.js';
import { auditTab } from './audit.js';

const TABS = [
  ['inventory', 'Inventory', inventoryTab],
  ['ledger', 'Issue & Return Ledger', ledgerTab],
  ['request-audit', '📜 Request Audit Trail', requestAuditTab],
  ['reports', 'Reports', reportsTab],
  ['audit', 'Audit Trail', auditTab],
];

export function consoleView() {
  const code = state.branch;
  let tab = 'inventory', dispose = null;
  const tabs = h('div', { class: 'tabs' }), body = h('div');

  const draw = async () => {
    dispose?.(); dispose = null;
    tabs.replaceChildren(...TABS.map(([k, t]) => h('button', { class: `tab${tab === k ? ' on' : ''}`, onclick: () => { tab = k; draw(); } }, t)));
    body.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
    try {
      const out = await TABS.find(([k]) => k === tab)[2](code);
      dispose = out.dispose;
      // Animate tab body in
      body.replaceChildren(out.el);
      body.classList.remove('tab-body-enter');
      void body.offsetWidth;
      body.classList.add('tab-body-enter');
    } catch (e) {
      if (e.code === 'BRANCH_LOCKED') { state.branch = null; return rerender(); }
      body.replaceChildren(h('p', { style: 'color:var(--red)' }, e.message));
    }
  };
  draw();

  const back = h('button', { class: 'btn ghost sm', onclick: async () => { await api(`/api/branches/${code}/lock`, { method: 'POST' }); state.branch = null; rerender(); } }, '← Switch branch');
  return { el: shell(`Department ${code}`, h('div', { class: 'row', style: 'margin-bottom:8px' }, back, h('span', { class: 'chip' }, `Branch: ${code}`)), tabs, body), dispose: () => dispose?.() };
}
