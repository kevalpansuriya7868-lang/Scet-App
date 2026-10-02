import { api } from './api.js?v=20261003_01';
import { state, bus } from './state.js?v=20261003_01';
import { h } from './ui.js?v=20261003_01';
import { authView } from './views/auth.js?v=20261003_01';
import { studentView } from './views/student.js?v=20261003_01';
import { branchView } from './views/branches.js?v=20261003_01';
import { consoleView } from './views/console.js?v=20261003_01';
import { registerServiceWorker } from './notifications.js?v=20261003_01';

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
  try {
    const me = await api('/api/auth/me');
    state.user = me?.user || null;
    state.branch = me?.activeBranch || null;
    if (!state.user) {
      localStorage.removeItem('scet_auth_token');
      localStorage.removeItem('scet_branch_token');
    }
    registerServiceWorker();
  } catch {
    localStorage.removeItem('scet_auth_token');
    localStorage.removeItem('scet_branch_token');
  }

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
