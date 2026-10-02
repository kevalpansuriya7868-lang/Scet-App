import { api } from '../api.js';
import { state, rerender } from '../state.js';
import { h, fields, modal, toast } from '../ui.js';
import { shell } from './shell.js';

export async function branchView() {
  const branches = await api('/api/catalog/branches');
  const cards = branches.map((b) => h('div', { class: 'card branch stack', onclick: () => unlock(b) },
    h('h3', {}, b.code), h('div', { class: 'muted' }, b.name),
    h('div', { class: 'row', onclick: (e) => e.stopPropagation() },
      h('button', { class: 'btn ghost sm', onclick: () => otpFlow(b, 'reset') }, 'Forgot password'),
      h('button', { class: 'btn ghost sm', onclick: () => otpFlow(b, 'delete') }, 'Delete'))));
  return shell('Select your department lab',
    h('div', { class: 'row', style: 'margin-bottom:14px' }, h('h2', { class: 'grow' }, 'Departments'), h('button', { class: 'btn gold', onclick: create }, '+ Register branch')),
    cards.length ? h('div', { class: 'grid' }, cards) : h('p', { class: 'muted' }, 'No branches yet. Register the first department.'));
}

function unlock(b) {
  const f = fields([{ name: 'password', label: `Password for ${b.code}`, type: 'password', ac: 'off' }]);
  modal(`Enter ${b.code} — ${b.name}`, f.el, [{ label: 'Unlock', run: async (close) => {
    await api(`/api/branches/${b.code}/unlock`, { method: 'POST', body: f.values() });
    state.branch = b.code; close(); rerender();
  } }]);
}

function create() {
  const f = fields([
    { name: 'code', label: 'Branch code (e.g. CO, IT, EC)' }, { name: 'name', label: 'Full branch name' },
    { name: 'password', label: 'Branch password (isolates this department)', type: 'password' },
    { name: 'recoveryEmail', label: 'Faculty recovery email (for OTP)', type: 'email' },
  ]);
  modal('Register department branch', f.el, [{ label: 'Register', cls: 'green', run: async (close) => {
    await api('/api/branches', { method: 'POST', body: f.values() });
    toast('Branch registered.'); close(); rerender();
  } }]);
}

/** Emailed-OTP flows for password reset and branch deletion. */
function otpFlow(b, purpose) {
  const del = purpose === 'delete';
  const status = h('p', { class: 'small muted' }, 'Click "Send OTP" to email a 6-digit code to the branch recovery address.');
  const f = fields([
    { name: 'otp', label: '6-digit OTP' },
    ...(del ? [{ name: 'password', label: 'Branch password', type: 'password' }]
            : [{ name: 'newPassword', label: 'New password (min 6)', type: 'password' }]),
  ]);
  const send = h('button', { class: 'btn ghost', onclick: async (e) => {
    e.target.disabled = true;
    try {
      const r = await api(`/api/branches/${b.code}/otp`, { method: 'POST', body: { purpose } });
      if (r.devOtp) {
        f.refs.otp.value = r.devOtp;
        status.innerHTML = `OTP sent to ${r.sentTo} (valid 10 minutes).<br><span style="color:#b06000;font-size:0.9em;display:block;margin-top:4px">⚠️ <b>Dev Mode Fallback</b> (Gmail rejected app password: <i>${r.smtpWarning || 'Bad credentials'}</i>)<br><b style="color:#137333">Auto-filled OTP: ${r.devOtp}</b> (also logged in server terminal)</span>`;
        toast(`Dev OTP auto-filled: ${r.devOtp}`);
      } else {
        status.textContent = `OTP sent to ${r.sentTo} (valid 10 minutes).`;
      }
    }
    catch (err) { toast(err.message, 'err'); } finally { e.target.disabled = false; }
  } }, 'Send OTP');
  modal(del ? `Delete branch ${b.code}` : `Reset password — ${b.code}`,
    h('div', { class: 'stack' }, del && h('p', { class: 'small', style: 'color:var(--red)' }, 'Permanently deletes this branch with ALL inventory, images and issue records.'), send, status, f.el),
    [{ label: del ? 'Permanently delete' : 'Reset password', cls: del ? 'danger' : 'green', run: async (close) => {
      if (del && !confirm(`Delete branch ${b.code} and all its data? This cannot be undone.`)) return;
      const v = f.values();
      if (del) await api(`/api/branches/${b.code}`, { method: 'DELETE', body: v });
      else await api(`/api/branches/${b.code}/reset-password`, { method: 'POST', body: v });
      toast(del ? 'Branch deleted.' : 'Password reset.'); close(); rerender();
    } }]);
}
