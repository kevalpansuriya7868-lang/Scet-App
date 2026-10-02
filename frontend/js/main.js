import { api } from './api.js';
import { state, bus } from './state.js';
import { h } from './ui.js';
import { authView } from './views/auth.js';
import { studentView } from './views/student.js';
import { branchView } from './views/branches.js';
import { consoleView } from './views/console.js';
import { registerServiceWorker } from './notifications.js';

const root = document.getElementById('app');
let dispose = null;

async function render() {
  dispose?.(); dispose = null;
  root.replaceChildren();
  const view = !state.user ? authView() : state.user.role === 'student' ? studentView() : !state.branch ? branchView() : consoleView();
  const out = await view;
  if (out?.el) { dispose = out.dispose; root.append(out.el); } else root.append(out);
  // Trigger page fade-in animation on every view switch
  root.style.animation = 'none';
  void root.offsetWidth;
  root.style.animation = '';
}
bus.addEventListener('render', render);

document.addEventListener('ip-blocked', (e) => {
  root.replaceChildren(h('div', { class: 'blocked' }, h('div', { class: 'card stack' },
    h('img', { src: 'assets/logo-footer.png', height: 80, style: 'margin:auto' }),
    h('h2', {}, 'Unauthorized network'), h('p', { class: 'muted' }, e.detail),
    h('p', { class: 'small muted' }, 'Connect to the authorised SCET lab network and reload this page.'))));
});

(async () => {
  // Only maintain active login state within the active tab session (sessionStorage)
  // When opening the web fresh (new tab/reopening browser), always show the Portal Chooser
  const activeTabToken = sessionStorage.getItem('scet_auth_token');
  if (activeTabToken) {
    try {
      const me = await api('/api/auth/me');
      state.user = me?.user || null;
      state.branch = me?.activeBranch || null;
    } catch {
      sessionStorage.removeItem('scet_auth_token');
      sessionStorage.removeItem('scet_branch_token');
      localStorage.removeItem('scet_auth_token');
      localStorage.removeItem('scet_branch_token');
      state.user = state.branch = null;
    }
  } else {
    // Fresh website visit: clean startup at the Portal Chooser
    localStorage.removeItem('scet_auth_token');
    localStorage.removeItem('scet_branch_token');
    state.user = null;
    state.branch = null;
  }
  registerServiceWorker();

  if (!document.querySelector('.blocked')) {
    // Wait for splash screen animation to run
    const splash = document.getElementById('splash');
    setTimeout(() => {
      splash.classList.add('splash-exit');
      setTimeout(() => {
        splash.style.display = 'none';
        document.getElementById('app').style.display = 'block';
        render();
      }, 500); // Wait for fade out animation
    }, 2800); // Splash visible duration
  }
})();
