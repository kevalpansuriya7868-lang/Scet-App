import { api } from '../api.js';
import { state, rerender } from '../state.js';
import { h, fields, toast } from '../ui.js';

const boards = ['esp32_devboard.png', 'hardware_uno.jpg', 'esp32_chip.png', 'circuit_board_module.png'];

export function authView() {
  // Phase 1: Portal chooser (Astra-style landing)
  let portal = null; // null = show chooser, 'student' | 'admin' = show login
  let tab = null;

  const root = h('div', { class: 'auth-root' });

  function setTheme(p) {
    document.body.className = p === 'admin' ? 'theme-admin' : p === 'student' ? 'theme-student' : '';
  }

  // ──────────── PORTAL CHOOSER ────────────
  function renderChooser() {
    setTheme(null);
    const el = h('div', { class: 'portal-chooser' },
      h('div', { class: 'chooser-bg' }),
      h('div', { class: 'chooser-content' },
        h('div', { class: 'chooser-header' },
          h('div', { class: 'chooser-logos' },
            h('img', { src: 'assets/sesuni.png', alt: '', class: 'cl-logo' }),
            h('img', { src: 'assets/logo-footer.png', alt: '', class: 'cl-logo' }),
          ),
          h('h1', { class: 'chooser-title' }, 'SCET Lab Portal'),
          h('p', { class: 'chooser-sub' }, 'Sarvajanik College of Engineering & Technology'),
        ),
        h('div', { class: 'chooser-cards' },
          // Student card
          h('button', {
            class: 'portal-card portal-student',
            onclick: () => { portal = 'student'; tab = 'student-login'; renderPortalLogin(); }
          },
            h('div', { class: 'pc-icon pc-icon-student' }, '🎓'),
            h('div', { class: 'pc-label' }, 'Student'),
            h('div', { class: 'pc-sub' }, 'Login / sign-up for lab access'),
            h('div', { class: 'pc-arrow' }, '→'),
          ),
          // Admin card
          h('button', {
            class: 'portal-card portal-admin',
            onclick: () => { portal = 'admin'; tab = 'admin-login'; renderPortalLogin(); }
          },
            h('div', { class: 'pc-icon pc-icon-admin' }, '🔐'),
            h('div', { class: 'pc-label' }, 'Faculty / Admin'),
            h('div', { class: 'pc-sub' }, 'Manage inventory & records'),
            h('div', { class: 'pc-arrow' }, '→'),
          ),
        ),
      ),
    );
    root.replaceChildren(el);
  }

  // ──────────── PORTAL LOGIN (themed) ────────────
  function renderPortalLogin() {
    setTheme(portal);
    const card = h('div', { class: 'card auth-card stack' });

    const login = () => {
      const f = fields([
        { name: 'username', label: portal === 'admin' ? 'Admin ID' : 'Enrollment number or @scet.ac.in email', ac: 'username' },
        { name: 'password', label: 'Password', type: 'password', ac: 'current-password' },
      ]);
      const forgotBtn = h('button', {
        class: 'btn ghost sm forgot-link', type: 'button',
        onclick: () => go('forgot'),
      }, '🔑 Forgot password?');
      const form = submitForm(f, 'Sign in', async (v) => {
        if (portal === 'student' && v.username.includes('@') && !v.username.trim().toLowerCase().endsWith('@scet.ac.in')) {
          throw new Error('Student login is only allowed with an @scet.ac.in email address or your Enrollment number.');
        }
        const r = await api('/api/auth/login', { method: 'POST', body: { ...v, portal } });
        state.user = r.user; rerender();
      });
      return h('div', { class: 'stack' }, form, forgotBtn);
    };

    const signup = () => {
      if (portal === 'admin') return adminSignup();
      // Student signup — enforce @scet.ac.in and email OTP verification
      const fullNameInput = h('input', { type: 'text', placeholder: 'Enter your full name' });
      const enrollmentInput = h('input', { type: 'text', placeholder: 'e.g. ET25BTCO177 (Login ID)' });
      const branchInput = h('input', { type: 'text', placeholder: 'e.g. CO, IT, EC' });
      const mobileInput = h('input', { type: 'tel', placeholder: '10-digit mobile number', maxlength: '10' });
      const emailInput = h('input', { type: 'email', placeholder: 'yourname@scet.ac.in', autocomplete: 'email' });
      const passwordInput = h('input', { type: 'password', placeholder: 'Min 8 characters', autocomplete: 'new-password' });
      const otpInput = h('input', { type: 'text', placeholder: 'Enter 6-digit code', maxlength: '6', autocomplete: 'one-time-code', style: 'font-size:18px;letter-spacing:4px;text-align:center;font-weight:700;' });

      const otpRow = h('div', { class: 'stack', style: 'display:none; padding:14px; background:rgba(30,58,138,0.06); border-radius:10px; border:1.5px solid rgba(30,58,138,0.25); margin:6px 0;' },
        h('label', { class: 'field' },
          h('span', { style: 'font-weight:700; color:var(--blue);' }, '📧 Enter 6-digit Verification Code:'),
          otpInput
        ),
        h('div', { class: 'row between', style: 'margin-top:6px; align-items:center;' },
          h('span', { class: 'muted small' }, 'Code sent to your @scet.ac.in email.'),
          h('button', {
            class: 'btn ghost sm',
            type: 'button',
            onclick: async (e) => {
              await sendOtpHandler(e.target);
            }
          }, '🔄 Resend Code')
        )
      );

      const submitBtn = h('button', { class: 'btn primary block', type: 'submit' }, 'Send Verification Code');
      let otpSent = false;

      async function sendOtpHandler(btnEl) {
        const email = emailInput.value.trim().toLowerCase();
        const enrollmentNo = enrollmentInput.value.trim().toUpperCase();
        const mobile = mobileInput.value.trim();
        const fullName = fullNameInput.value.trim();

        if (!fullName) throw new Error('Please enter your full name.');
        if (!enrollmentNo) throw new Error('Please enter your enrollment number.');
        if (!email) throw new Error('Please enter your @scet.ac.in email address.');
        if (!email.endsWith('@scet.ac.in')) throw new Error('Only official @scet.ac.in email addresses are permitted for student accounts.');
        if (mobile && !/^\d{10}$/.test(mobile)) throw new Error('Mobile number must be exactly 10 digits.');

        const orig = btnEl.innerText;
        btnEl.disabled = true;
        btnEl.innerText = 'Sending OTP...';
        try {
          const res = await api('/api/auth/signup/student/send-otp', {
            method: 'POST',
            body: { email, enrollmentNo, mobile, fullName }
          });
          otpSent = true;
          otpRow.style.display = 'block';
          submitBtn.innerText = 'Verify Code & Create Account';
          toast(res.message || `Verification code sent to ${email}!`);
          otpInput.focus();
        } finally {
          btnEl.disabled = false;
          btnEl.innerText = orig;
        }
      }

      const form = h('form', { class: 'stack' },
        field('Full name', fullNameInput),
        field('Enrollment number (your login ID)', enrollmentInput),
        field('Branch / dept (e.g. CO, IT, EC)', branchInput),
        field('Mobile (10 digits)', mobileInput),
        field('Email (@scet.ac.in only)', emailInput),
        field('Password (min 8 chars)', passwordInput),
        otpRow,
        submitBtn
      );

      form.onsubmit = async (e) => {
        e.preventDefault();
        const email = emailInput.value.trim().toLowerCase();
        const enrollmentNo = enrollmentInput.value.trim().toUpperCase();
        const fullName = fullNameInput.value.trim();
        const branch = branchInput.value.trim().toUpperCase();
        const mobile = mobileInput.value.trim();
        const password = passwordInput.value;
        const otp = otpInput.value.trim();

        if (!fullName || !enrollmentNo || !branch) {
          return toast('Please fill in all required fields.', 'err');
        }
        if (!email.endsWith('@scet.ac.in')) {
          return toast('Only official @scet.ac.in email addresses are allowed.', 'err');
        }
        if (!/^\d{10}$/.test(mobile)) {
          return toast('Mobile number must be exactly 10 digits.', 'err');
        }
        if (password.length < 8) {
          return toast('Password must be at least 8 characters.', 'err');
        }

        if (!otpSent) {
          try {
            await sendOtpHandler(submitBtn);
          } catch (err) {
            toast(err.message, 'err');
          }
          return;
        }

        if (!otp || otp.length < 6) {
          return toast('Please enter the 6-digit verification code sent to your email.', 'err');
        }

        submitBtn.disabled = true;
        submitBtn.innerText = 'Creating account...';
        try {
          await api('/api/auth/signup/student', {
            method: 'POST',
            body: { fullName, enrollmentNo, branch, mobile, email, password, otp }
          });
          toast('Account created successfully! You can sign in now.');
          go('login');
        } catch (err) {
          toast(err.message, 'err');
        } finally {
          submitBtn.disabled = false;
          submitBtn.innerText = 'Verify Code & Create Account';
        }
      };

      return form;
    };

    const forgotView = () => {
      const label = portal === 'student' ? 'Enrollment number' : 'Admin ID';
      const f = fields([{ name: 'username', label }]);
      const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Send reset link');
      const notFoundBlock = h('div', {
        class: 'forgot-not-found stack',
        style: 'display:none; text-align:center; padding:10px;',
      },
        h('p', { style: 'color:var(--red);font-weight:700;' }, '❌ This username does not exist.'),
        h('p', { class: 'muted small' }, 'Would you like to create an account?'),
        h('button', {
          class: 'btn ghost block', type: 'button',
          onclick: () => go('signup'),
        }, `Sign up as ${portal === 'student' ? 'Student' : 'Admin'}`),
      );
      const form = h('form', {
        class: 'stack',
        onsubmit: async (e) => {
          e.preventDefault(); btn.disabled = true; notFoundBlock.style.display = 'none';
          try {
            await api('/api/auth/forgot-password', { method: 'POST', body: { username: f.values().username, portal } });
            const ok = h('div', { class: 'forgot-ok stack' },
              h('div', { class: 'forgot-icon' }, '✉️'),
              h('p', { class: 'forgot-msg' }, 'Reset link sent! Check your inbox and spam folder.'),
              h('button', { class: 'btn ghost sm', onclick: () => go('login') }, '← Back to login'));
            form.replaceWith(ok);
          } catch (err) {
            btn.disabled = false;
            if (err.message.includes('does not exist')) {
              f.el.insertAdjacentElement('afterend', notFoundBlock);
              notFoundBlock.style.display = 'flex';
            } else toast(err.message, 'err');
          }
        },
      }, f.el, btn);
      return h('div', { class: 'stack' },
        h('p', { class: 'muted small' }, `Enter your ${label.toLowerCase()} to receive a password reset link.`),
        form);
    };

    const tabDefs = {
      login: { label: portal === 'student' ? 'Student Login' : 'Admin Login', render: login },
      signup: { label: portal === 'student' ? 'Student Sign-up' : 'Admin Setup', render: signup },
      forgot: { label: 'Reset Password', render: forgotView },
    };

    function go(t) {
      tab = t;
      const navTabs = ['login', 'signup'];
      const navButtons = navTabs.filter(k => k !== t).map(k =>
        h('button', { class: 'btn ghost sm', onclick: () => go(k) }, tabDefs[k].label));
      card.replaceChildren(
        t !== 'forgot'
          ? h('div', { class: 'row' },
            h('button', {
              class: 'btn ghost sm back-btn',
              onclick: () => { portal = null; renderChooser(); },
            }, '← Portals'),
            ...navButtons,
          )
          : h('button', { class: 'btn ghost sm back-btn', onclick: () => go('login') }, '← Back to login'),
        h('h2', { class: 'auth-title' }, tabDefs[t].label),
        tabDefs[t].render(),
      );
      card.classList.remove('auth-card-enter');
      void card.offsetWidth;
      card.classList.add('auth-card-enter');
    }

    go('login');

    const isStudent = portal === 'student';
    const el = h('div', { class: `auth auth-${portal}` },
      h('section', { class: 'hero' },
        h('div', { class: 'logos' },
          h('img', { src: 'assets/sesuni.png', alt: '' }),
          h('img', { src: 'assets/logo-footer.png', alt: '' }),
        ),
        h('h2', {}, isStudent ? '🎓 Student Portal' : '🔐 Faculty & Admin Portal'),
        h('p', {}, isStudent
          ? 'Browse components, request hardware, track issues & returns — all in one place.'
          : 'Manage inventory, issue/return records, gate passes, fines & admin accounts.'),
        h('div', { class: 'boards' },
          boards.map((b, i) => h('img', {
            src: `assets/${b}`, alt: '',
            class: `board-img board-img-${i % 2 === 0 ? 'even' : 'odd'}`,
          })),
        ),
      ),
      h('section', { style: 'display:grid;padding:24px;place-items:center' }, card),
    );
    root.replaceChildren(el);
  }

  renderChooser();
  return root;
}

function adminSignup() {
  const box = h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Checking…'));
  api('/api/auth/bootstrap-status').then(({ firstAdminExists }) => {
    if (firstAdminExists) {
      box.replaceChildren(
        h('div', { class: 'multi-admin-notice stack' },
          h('div', { class: 'multi-admin-icon' }, '👥'),
          h('p', { class: 'muted' }, 'A master admin already exists.'),
          h('p', { class: 'muted small' }, 'Ask a current admin to add your account from the Admins tab.'),
        ));
      return;
    }
    const f = fields([
      { name: 'masterUsername', label: 'Master admin username' },
      { name: 'masterPassword', label: 'Master admin password', type: 'password' },
      { name: 'username', label: 'Your new admin ID' },
      { name: 'displayName', label: 'Display name' },
      { name: 'email', label: 'Email (for password recovery)', type: 'email' },
      { name: 'password', label: 'Your new password (min 8 chars)', type: 'password', ac: 'new-password' },
    ]);
    box.replaceChildren(
      h('p', { class: 'small muted' }, 'One-time setup. After this, any admin can create more accounts.'),
      submitForm(f, 'Create first admin', async (v) => {
        await api('/api/auth/signup/admin', { method: 'POST', body: v });
        toast('Admin created. Sign in now.');
      }),
    );
  }).catch(e => box.replaceChildren(h('p', {}, e.message)));
  return box;
}

function submitForm(f, label, onSubmit) {
  const btn = h('button', { class: 'btn primary block ripple', type: 'submit' }, label);
  return h('form', {
    class: 'stack',
    onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true;
      try { await onSubmit(f.values()); } catch (err) { toast(err.message, 'err'); } finally { btn.disabled = false; }
    },
  }, f.el, btn);
}
