import { api } from '../api.js';
import { state, rerender } from '../state.js';
import { h, fields, field, toast } from '../ui.js';

const boards = ['esp32_devboard.png', 'hardware_uno.jpg', 'esp32_chip.png', 'circuit_board_module.png'];

export function authView() {
  let portal = null; // null = show chooser, 'student' | 'admin' = show login
  let tab = null;
  let pendingSignup = null;
  const savedFormValues = { student: {}, admin: {} };
  let prefillLoginUsername = '';

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
            onclick: () => { portal = 'student'; tab = 'login'; renderPortalLogin(); }
          },
            h('div', { class: 'pc-icon pc-icon-student' }, '🎓'),
            h('div', { class: 'pc-label' }, 'Student'),
            h('div', { class: 'pc-sub' }, 'Login / sign-up for lab access'),
            h('div', { class: 'pc-arrow' }, '→'),
          ),
          // Admin card
          h('button', {
            class: 'portal-card portal-admin',
            onclick: () => { portal = 'admin'; tab = 'login'; renderPortalLogin(); }
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
      const usernameInput = h('input', {
        type: 'text',
        placeholder: portal === 'admin' ? 'Faculty ID or @scet.ac.in email' : 'Enrollment number or @scet.ac.in email',
        autocomplete: 'username',
        value: prefillLoginUsername || ''
      });
      const passwordInput = h('input', {
        type: 'password',
        placeholder: 'Enter your password',
        autocomplete: 'current-password'
      });
      const submitBtn = h('button', { class: 'btn primary block ripple', type: 'submit' }, 'Sign in');
      const forgotBtn = h('button', {
        class: 'btn ghost sm forgot-link', type: 'button',
        onclick: () => go('forgot'),
      }, '🔑 Forgot password?');

      const form = h('form', {
        class: 'stack',
        onsubmit: async (e) => {
          e.preventDefault();
          const username = usernameInput.value.trim().toLowerCase();
          const password = passwordInput.value;
          if (!username) {
            return toast(portal === 'admin' ? '⚠️ Please enter your Faculty ID or @scet.ac.in email.' : '⚠️ Please enter your Enrollment number or @scet.ac.in email.', 'err');
          }
          if (!password) {
            return toast('⚠️ Please enter your password.', 'err');
          }
          if (username.includes('@') && !username.endsWith('@scet.ac.in')) {
            return toast('⚠️ Email login is only permitted for official @scet.ac.in accounts.', 'err');
          }

          submitBtn.disabled = true;
          submitBtn.innerText = 'Signing in...';
          try {
            const r = await api('/api/auth/login', { method: 'POST', body: { username, password, portal } });
            state.user = r.user;
            rerender();
          } catch (err) {
            toast(err.message || 'Invalid credentials or inactive account.', 'err');
          } finally {
            submitBtn.disabled = false;
            submitBtn.innerText = 'Sign in';
          }
        }
      },
        field(portal === 'admin' ? 'Faculty ID or Email' : 'Enrollment number or Email', usernameInput),
        field('Password', passwordInput),
        submitBtn
      );
      return h('div', { class: 'stack' }, form, forgotBtn);
    };

    // ──────────── SIGNUP VIEW (STUDENT & FACULTY) ────────────
    const signup = () => {
      const isStudent = portal === 'student';
      const saved = savedFormValues[portal] || {};

      const masterUserInput = !isStudent ? h('input', {
        type: 'text',
        placeholder: 'Master ID (admin)',
        value: saved.masterUsername || ''
      }) : null;

      const masterPassInput = !isStudent ? h('input', {
        type: 'password',
        placeholder: 'Master password (admin123)',
        value: saved.masterPassword || ''
      }) : null;

      const fullNameInput = h('input', {
        type: 'text',
        placeholder: isStudent ? 'Enter your full name' : 'e.g. Dr. Alpesh Patel',
        value: saved.fullName || ''
      });
      const idInput = h('input', {
        type: 'text',
        placeholder: isStudent ? 'e.g. ET25BTCO180 (Login ID)' : 'e.g. FAC_CO_01 (Login ID)',
        value: isStudent ? (saved.enrollmentNo || '') : (saved.username || '')
      });
      const branchInput = h('input', {
        type: 'text',
        placeholder: 'e.g. CO, IT, EC, IC',
        value: saved.branch || ''
      });
      const mobileInput = h('input', {
        type: 'tel',
        placeholder: '10-digit mobile number',
        maxlength: '10',
        value: saved.mobile || ''
      });
      const emailInput = h('input', {
        type: 'email',
        placeholder: isStudent ? 'yourname@scet.ac.in' : 'faculty.name@scet.ac.in',
        autocomplete: 'email',
        value: saved.email || ''
      });
      const passwordInput = h('input', {
        type: 'password',
        placeholder: 'Min 8 characters',
        autocomplete: 'new-password',
        value: saved.password || ''
      });

      const submitBtn = h('button', {
        class: 'btn primary block ripple',
        type: 'submit'
      }, '🚀 Send Verification Code →');

      const formElements = [];
      if (!isStudent) {
        formElements.push(
          field('Master Admin ID', masterUserInput),
          field('Master Admin Password', masterPassInput)
        );
      }
      formElements.push(
        field('Full name', fullNameInput),
        field(isStudent ? 'Enrollment number (Login ID)' : 'Faculty ID (Login ID)', idInput),
        field(isStudent ? 'Branch / dept (e.g. CO, IT, EC)' : 'Department (e.g. CO, IT, EC)', branchInput),
        field('Mobile number (10 digits)', mobileInput),
        field('Official Email (@scet.ac.in only)', emailInput),
        field('Your Password (min 8 chars)', passwordInput),
        submitBtn
      );

      const form = h('form', { class: 'stack' }, ...formElements);

      form.onsubmit = async (e) => {
        e.preventDefault();
        let masterUsername = '';
        let masterPassword = '';
        if (!isStudent) {
          masterUsername = masterUserInput.value.trim();
          masterPassword = masterPassInput.value;
          if (!masterUsername) {
            return toast('⚠️ Master Admin ID is required (e.g. admin).', 'err');
          }
          if (!masterPassword) {
            return toast('⚠️ Master Admin password is required (e.g. admin123).', 'err');
          }
        }

        const fullName = fullNameInput.value.trim();
        const rawId = idInput.value.trim();
        const branch = branchInput.value.trim().toUpperCase();
        const mobile = mobileInput.value.trim();
        const email = emailInput.value.trim().toLowerCase();
        const password = passwordInput.value;

        // Distinct, explicit notifications on error
        if (!fullName) {
          return toast('⚠️ Please enter your full name.', 'err');
        }
        if (!rawId) {
          return toast(isStudent ? '⚠️ Please enter your Enrollment number.' : '⚠️ Please enter your Faculty / Admin ID.', 'err');
        }
        if (!isStudent && !/^[a-z0-9._-]{3,32}$/i.test(rawId)) {
          return toast('⚠️ Faculty ID must be 3-32 characters (letters, numbers, dot, underscore, dash).', 'err');
        }
        if (!branch) {
          return toast('⚠️ Please enter your department / branch (e.g. CO, IT).', 'err');
        }
        if (!mobile || !/^\d{10}$/.test(mobile)) {
          return toast('⚠️ Mobile number must be exactly 10 digits.', 'err');
        }
        if (!email) {
          return toast('⚠️ Email address is required.', 'err');
        }
        if (!email.includes('@') || !email.includes('.')) {
          return toast('⚠️ Please enter a valid email address.', 'err');
        }
        if (!email.endsWith('@scet.ac.in')) {
          return toast('⚠️ Only official @scet.ac.in email addresses are allowed.', 'err');
        }
        if (!password || password.length < 8) {
          return toast('⚠️ Password must be at least 8 characters long.', 'err');
        }

        // Save typed values in case user goes back
        savedFormValues[portal] = {
          fullName,
          branch,
          mobile,
          email,
          password,
          ...(isStudent
            ? { enrollmentNo: rawId.toUpperCase() }
            : { username: rawId.toLowerCase(), masterUsername, masterPassword }
          )
        };

        const origText = submitBtn.innerText;
        submitBtn.disabled = true;
        submitBtn.innerText = 'Sending verification code...';

        try {
          let otpRes;
          if (isStudent) {
            const enrollmentNo = rawId.toUpperCase();
            otpRes = await api('/api/auth/signup/student/send-otp', {
              method: 'POST',
              body: { fullName, enrollmentNo, branch, mobile, email }
            });
            pendingSignup = { portal: 'student', fullName, enrollmentNo, branch, mobile, email, password, devOtp: otpRes?.devOtp, smtpBlocked: otpRes?.smtpBlocked };
          } else {
            const username = rawId.toLowerCase();
            otpRes = await api('/api/auth/signup/admin/send-otp', {
              method: 'POST',
              body: { masterUsername, masterPassword, fullName, username, branch, mobile, email }
            });
            pendingSignup = { portal: 'admin', masterUsername, masterPassword, fullName, username, branch, mobile, email, password, devOtp: otpRes?.devOtp, smtpBlocked: otpRes?.smtpBlocked };
          }

          toast(otpRes?.message || `✅ Verification code sent! Please check your ${email} inbox.`);
          go('otp');
        } catch (err) {
          // Exact notifications from backend (e.g. "An account with this email address already exists.")
          toast(err.message || 'Unable to send verification code. Please check your details.', 'err');
        } finally {
          submitBtn.disabled = false;
          submitBtn.innerText = origText;
        }
      };

      return form;
    };

    // ──────────── ULTRA-HEAVY ANIMATED OTP VERIFICATION ────────────
    const otpView = () => {
      if (!pendingSignup) {
        return h('div', { class: 'stack', style: 'text-align:center; padding:20px;' },
          h('p', { class: 'muted' }, 'No verification in progress.'),
          h('button', { class: 'btn primary', onclick: () => go('signup') }, 'Go to Sign-up')
        );
      }

      const isStudent = pendingSignup.portal === 'student';
      let remainingSeconds = 600; // 10 minutes
      let resendTimer = 30; // 30s resend cooldown
      let timerInterval = null;
      let resendInterval = null;

      // 6 Digit Inputs
      const digitInputs = [];
      for (let i = 0; i < 6; i++) {
        const inp = h('input', {
          class: 'otp-box',
          type: 'text',
          maxlength: '1',
          inputmode: 'numeric',
          pattern: '[0-9]*',
          autocomplete: 'off',
          'data-idx': i
        });
        digitInputs.push(inp);
      }

      const boxesContainer = h('div', { class: 'otp-boxes-container' }, ...digitInputs);

      // Countdown display
      const countdownSpan = h('span', { class: 'otp-countdown-timer' }, '10:00');
      const countdownBadge = h('div', { class: 'otp-countdown-badge' }, '⏳ Expires in ', countdownSpan);

      // Resend button
      const resendBtn = h('button', {
        class: 'otp-resend-btn',
        type: 'button',
        disabled: true
      }, `Resend in ${resendTimer}s`);

      const timerRow = h('div', { class: 'otp-timer-row' },
        countdownBadge,
        resendBtn
      );

      const verifySubmitBtn = h('button', {
        class: 'otp-submit-btn ripple',
        type: 'submit'
      }, 'Verify & Create Account ➔');

      const orbIcon = h('div', { class: 'otp-orb-icon' }, '🛡️');
      const orbWrapper = h('div', { class: 'otp-orb-wrapper' },
        h('div', { class: 'otp-pulse-ring-outer' }),
        h('div', { class: 'otp-pulse-ring-inner' }),
        h('div', { class: 'otp-orb-core' }, orbIcon)
      );

      const emailChip = h('div', { class: 'otp-email-chip' },
        h('span', {}, '✉️'),
        h('strong', {}, pendingSignup.email),
        h('button', {
          class: 'otp-edit-btn',
          title: 'Change email or details',
          type: 'button',
          onclick: () => go('signup')
        }, '✏️')
      );

      // Instant code banner when cloud host SMTP times out or dev fallback triggers
      let otpDevBanner = null;
      if (pendingSignup.devOtp) {
        otpDevBanner = h('div', {
          class: 'otp-instant-banner',
          style: 'background: linear-gradient(135deg, rgba(16, 185, 129, 0.16), rgba(5, 150, 105, 0.1)); border: 1.5px solid rgba(52, 211, 153, 0.45); border-radius: 12px; padding: 12px 16px; margin: 10px auto; max-width: 440px; text-align: center; box-shadow: 0 4px 18px rgba(16, 185, 129, 0.12);'
        },
          h('div', { style: 'font-size: 0.85rem; font-weight: 600; color: #a7f3d0; margin-bottom: 4px; display: flex; align-items: center; justify-content: center; gap: 6px;' },
            h('span', {}, '⚡'),
            h('span', {}, pendingSignup.smtpBlocked
              ? 'Instant Code (Cloud Mail Server Timeout Fallback)'
              : 'Instant Verification Code'
            )
          ),
          h('div', {
            style: 'font-size: 1.7rem; font-weight: 800; letter-spacing: 8px; color: #34d399; font-family: monospace; margin: 4px 0;'
          }, String(pendingSignup.devOtp)),
          h('div', { style: 'font-size: 0.76rem; color: #94a3b8;' },
            'Boxes pre-filled below. Click "Verify & Create Account" to proceed!'
          )
        );

        // Auto-fill digit boxes with instant code
        if (String(pendingSignup.devOtp).length === 6) {
          const chars = String(pendingSignup.devOtp).split('');
          chars.forEach((c, idx) => {
            if (digitInputs[idx]) {
              digitInputs[idx].value = c;
              digitInputs[idx].classList.add('filled');
            }
          });
        }
      }

      // Setup Keyboard Navigation across 6 digit boxes
      digitInputs.forEach((inp, idx) => {
        inp.oninput = (e) => {
          const val = inp.value.replace(/[^0-9]/g, '');
          inp.value = val ? val[0] : '';
          if (inp.value) {
            inp.classList.add('filled');
            if (idx < 5) {
              digitInputs[idx + 1].focus();
              digitInputs[idx + 1].select();
            }
          } else {
            inp.classList.remove('filled');
          }
        };

        inp.onkeydown = (e) => {
          if (e.key === 'Backspace') {
            if (!inp.value && idx > 0) {
              digitInputs[idx - 1].focus();
              digitInputs[idx - 1].value = '';
              digitInputs[idx - 1].classList.remove('filled');
            } else {
              inp.value = '';
              inp.classList.remove('filled');
            }
          } else if (e.key === 'ArrowLeft' && idx > 0) {
            digitInputs[idx - 1].focus();
          } else if (e.key === 'ArrowRight' && idx < 5) {
            digitInputs[idx + 1].focus();
          }
        };

        inp.onpaste = (e) => {
          e.preventDefault();
          const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/[^0-9]/g, '');
          if (pasted) {
            for (let j = 0; j < 6; j++) {
              if (pasted[j]) {
                digitInputs[j].value = pasted[j];
                digitInputs[j].classList.add('filled');
              }
            }
            const nextIdx = Math.min(pasted.length, 5);
            digitInputs[nextIdx].focus();
          }
        };
      });

      // Start Countdown
      timerInterval = setInterval(() => {
        remainingSeconds--;
        if (remainingSeconds <= 0) {
          clearInterval(timerInterval);
          countdownSpan.innerText = 'Expired';
          countdownBadge.classList.add('expired');
          countdownBadge.innerHTML = '⚠️ Code expired! Please resend.';
        } else {
          const m = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
          const s = String(remainingSeconds % 60).padStart(2, '0');
          countdownSpan.innerText = `${m}:${s}`;
        }
      }, 1000);

      // Start Resend Cooldown
      resendInterval = setInterval(() => {
        resendTimer--;
        if (resendTimer <= 0) {
          clearInterval(resendInterval);
          resendBtn.disabled = false;
          resendBtn.innerText = '🔄 Resend Code';
        } else {
          resendBtn.innerText = `Resend in ${resendTimer}s`;
        }
      }, 1000);

      // Resend OTP Action
      resendBtn.onclick = async () => {
        resendBtn.disabled = true;
        resendBtn.innerText = 'Sending...';
        try {
          const endpoint = isStudent ? '/api/auth/signup/student/send-otp' : '/api/auth/signup/admin/send-otp';
          const body = isStudent
            ? { fullName: pendingSignup.fullName, enrollmentNo: pendingSignup.enrollmentNo, branch: pendingSignup.branch, mobile: pendingSignup.mobile, email: pendingSignup.email }
            : { masterUsername: pendingSignup.masterUsername, masterPassword: pendingSignup.masterPassword, fullName: pendingSignup.fullName, username: pendingSignup.username, branch: pendingSignup.branch, mobile: pendingSignup.mobile, email: pendingSignup.email };

          const res = await api(endpoint, { method: 'POST', body });
          toast(res?.message || `✅ New verification code sent to ${pendingSignup.email}!`);

          if (res?.devOtp) {
            pendingSignup.devOtp = res.devOtp;
            pendingSignup.smtpBlocked = res.smtpBlocked;
            rerender();
            return;
          }

          // Clear boxes
          digitInputs.forEach(inp => { inp.value = ''; inp.classList.remove('filled'); });
          digitInputs[0].focus();

          // Reset timers
          remainingSeconds = 600;
          countdownBadge.classList.remove('expired');
          countdownBadge.innerHTML = '⏳ Expires in ';
          countdownBadge.appendChild(countdownSpan);

          resendTimer = 30;
          clearInterval(resendInterval);
          resendInterval = setInterval(() => {
            resendTimer--;
            if (resendTimer <= 0) {
              clearInterval(resendInterval);
              resendBtn.disabled = false;
              resendBtn.innerText = '🔄 Resend Code';
            } else {
              resendBtn.innerText = `Resend in ${resendTimer}s`;
            }
          }, 1000);
        } catch (err) {
          toast(err.message || 'Failed to resend code.', 'err');
          resendBtn.disabled = false;
          resendBtn.innerText = '🔄 Resend Code';
        }
      };

      // Form Submit: Verify Code & Create Account
      const form = h('form', {
        class: 'stack otp-screen',
        onsubmit: async (e) => {
          e.preventDefault();
          const otp = digitInputs.map(inp => inp.value).join('');

          if (otp.length < 6) {
            boxesContainer.classList.add('error-shake');
            setTimeout(() => boxesContainer.classList.remove('error-shake'), 650);
            return toast('⚠️ Please enter the complete 6-digit verification code.', 'err');
          }

          verifySubmitBtn.disabled = true;
          verifySubmitBtn.innerText = 'Verifying code...';

          try {
            const endpoint = isStudent ? '/api/auth/signup/student' : '/api/auth/signup/admin';
            const body = { ...pendingSignup, otp };

            await api(endpoint, { method: 'POST', body });

            // HEAVY CELEBRATION ANIMATION!
            clearInterval(timerInterval);
            clearInterval(resendInterval);
            boxesContainer.classList.add('success-celebrate');
            orbIcon.innerText = '✅';
            verifySubmitBtn.innerText = 'Account Created! 🎉';
            verifySubmitBtn.style.background = 'var(--green)';

            createConfettiBurst();
            toast('🎉 Verification successful! Your account is now active.');

            prefillLoginUsername = isStudent ? pendingSignup.enrollmentNo : pendingSignup.username;
            pendingSignup = null;

            setTimeout(() => {
              go('login');
            }, 1200);
          } catch (err) {
            // HEAVY WRONG OTP SHAKE ANIMATION
            boxesContainer.classList.add('error-shake');
            digitInputs.forEach(inp => {
              inp.value = '';
              inp.classList.remove('filled');
            });
            digitInputs[0].focus();
            setTimeout(() => boxesContainer.classList.remove('error-shake'), 700);

            toast(err.message || 'Incorrect verification code. Please check your email and try again.', 'err');
            verifySubmitBtn.disabled = false;
            verifySubmitBtn.innerText = 'Verify & Create Account ➔';
          }
        }
      },
        orbWrapper,
        h('h2', { class: 'otp-heading' }, 'Verify Your Email Address'),
        h('p', { class: 'otp-subheading' }, 'Enter the 6-digit verification code sent to:'),
        emailChip,
        ...(otpDevBanner ? [otpDevBanner] : []),
        boxesContainer,
        timerRow,
        verifySubmitBtn,
        h('button', {
          class: 'btn ghost sm',
          type: 'button',
          style: 'margin-top:8px;',
          onclick: () => {
            clearInterval(timerInterval);
            clearInterval(resendInterval);
            go('signup');
          }
        }, '← Back to details')
      );

      // Auto focus first input after mount
      setTimeout(() => digitInputs[0].focus(), 100);

      return form;
    };

    // ──────────── FORGOT PASSWORD VIEW ────────────
    const forgotView = () => {
      const isStudent = portal === 'student';
      const label = isStudent ? 'Enrollment number or @scet.ac.in email' : 'Faculty ID or @scet.ac.in email';
      const f = fields([{ name: 'username', label, placeholder: isStudent ? 'e.g. ET25BTCO180 or email' : 'e.g. FAC_CO_01 or email' }]);
      const btn = h('button', { class: 'btn primary block ripple', type: 'submit' }, 'Send reset link');
      const notFoundBlock = h('div', {
        class: 'forgot-not-found stack',
        style: 'display:none; text-align:center; padding:10px;',
      },
        h('p', { style: 'color:var(--red);font-weight:700;' }, '❌ This account does not exist.'),
        h('p', { class: 'muted small' }, 'Would you like to create an account?'),
        h('button', {
          class: 'btn ghost block', type: 'button',
          onclick: () => go('signup'),
        }, `Sign up as ${isStudent ? 'Student' : 'Faculty / Admin'}`),
      );
      const form = h('form', {
        class: 'stack',
        onsubmit: async (e) => {
          e.preventDefault();
          const val = f.values().username.trim();
          if (!val) return toast('⚠️ Please enter your ID or @scet.ac.in email.', 'err');
          btn.disabled = true;
          btn.innerText = 'Sending reset link...';
          notFoundBlock.style.display = 'none';
          try {
            await api('/api/auth/forgot-password', { method: 'POST', body: { username: val, portal } });
            const ok = h('div', { class: 'forgot-ok stack' },
              h('div', { class: 'forgot-icon' }, '✉️'),
              h('p', { class: 'forgot-msg' }, 'Password reset link sent! Check your @scet.ac.in inbox and spam folder.'),
              h('button', { class: 'btn ghost sm', onclick: () => go('login') }, '← Back to login'));
            form.replaceWith(ok);
          } catch (err) {
            btn.disabled = false;
            btn.innerText = 'Send reset link';
            if (err.message && err.message.includes('does not exist')) {
              f.el.insertAdjacentElement('afterend', notFoundBlock);
              notFoundBlock.style.display = 'flex';
            } else {
              toast(err.message, 'err');
            }
          }
        },
      }, f.el, btn);
      return h('div', { class: 'stack' },
        h('p', { class: 'muted small' }, `Enter your ${isStudent ? 'Enrollment number' : 'Faculty ID'} or official @scet.ac.in email address to receive a secure password reset link.`),
        form
      );
    };

    const tabDefs = {
      login: { label: portal === 'student' ? 'Student Login' : 'Admin Login', render: login },
      signup: { label: portal === 'student' ? 'Student Sign-up' : 'Faculty Sign-up', render: signup },
      otp: { label: 'Email Verification', render: otpView },
      forgot: { label: 'Reset Password', render: forgotView },
    };

    function go(t) {
      tab = t;
      const navTabs = ['login', 'signup'];
      const navButtons = navTabs.filter(k => k !== t).map(k =>
        h('button', { class: 'btn ghost sm', onclick: () => go(k) }, tabDefs[k].label));

      let headerNav;
      if (t === 'otp') {
        headerNav = h('div', { class: 'row' },
          h('button', {
            class: 'btn ghost sm back-btn',
            onclick: () => go('signup'),
          }, '← Back to Sign-up')
        );
      } else if (t === 'forgot') {
        headerNav = h('div', { class: 'row' },
          h('button', { class: 'btn ghost sm back-btn', onclick: () => go('login') }, '← Back to login')
        );
      } else {
        headerNav = h('div', { class: 'row' },
          h('button', {
            class: 'btn ghost sm back-btn',
            onclick: () => { portal = null; renderChooser(); },
          }, '← Portals'),
          ...navButtons
        );
      }

      card.replaceChildren(
        headerNav,
        t !== 'otp' ? h('h2', { class: 'auth-title' }, tabDefs[t].label) : h('span', { style: 'display:none;' }),
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
          : 'Manage inventory, issue/return records, gate passes, fines & faculty accounts.'),
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

// ──────────── CONFETTI PARTICLES BURST ANIMATION ────────────
function createConfettiBurst() {
  const container = document.createElement('div');
  container.className = 'otp-confetti-container';
  const colors = ['#10b981', '#06b6d4', '#3b82f6', '#ec4899', '#f59e0b', '#8b5cf6'];
  const emojis = ['✨', '🎉', '🌟', '💎', '🚀'];

  for (let i = 0; i < 45; i++) {
    const p = document.createElement('div');
    const isEmoji = i % 5 === 0;
    if (isEmoji) {
      p.innerText = emojis[Math.floor(Math.random() * emojis.length)];
      p.style.fontSize = `${Math.floor(Math.random() * 14) + 16}px`;
      p.style.background = 'none';
    } else {
      p.className = 'otp-confetti-particle';
      p.style.background = colors[Math.floor(Math.random() * colors.length)];
      p.style.width = `${Math.floor(Math.random() * 8) + 6}px`;
      p.style.height = `${Math.floor(Math.random() * 12) + 8}px`;
      p.style.borderRadius = `${Math.floor(Math.random() * 5)}px`;
    }
    p.style.position = 'absolute';
    p.style.left = '50%';
    p.style.top = '45%';

    const angle = (Math.PI * 2 * i) / 45 + (Math.random() - 0.5) * 0.5;
    const distance = Math.floor(Math.random() * 260) + 120;
    const tx = Math.cos(angle) * distance;
    const ty = Math.sin(angle) * distance - 40;
    const rot = Math.floor(Math.random() * 720) - 360;

    p.style.setProperty('--tx', `${tx}px`);
    p.style.setProperty('--ty', `${ty}px`);
    p.style.setProperty('--rot', `${rot}deg`);
    p.style.animation = `confettiParticleFly ${Math.random() * 0.5 + 0.9}s cubic-bezier(0.25, 1, 0.5, 1) forwards`;

    container.appendChild(p);
  }
  document.body.appendChild(container);
  setTimeout(() => container.remove(), 1600);
}

