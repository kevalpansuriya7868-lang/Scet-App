import { api } from './api.js';
import { toast } from './ui.js';

/**
 * Converts VAPID public key from Base64 URL to Uint8Array
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Web Audio API synthesized chimes for notifications (Zero external mp3 files required)
 */
let audioCtx = null;
export function playChime(type = 'success') {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!audioCtx) audioCtx = new AudioCtx();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const now = audioCtx.currentTime;
    if (type === 'success' || type === 'accepted') {
      // Cheerful approval chord / chime: E5 (659Hz) -> G#5 (830Hz) -> B5 (987Hz)
      const notes = [659.25, 830.61, 987.77];
      notes.forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);

        gain.gain.setValueAtTime(0.001, now + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.18, now + idx * 0.08 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.08 + 0.6);

        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 0.65);
      });
    } else {
      // Friendly notification ping
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.45);
    }
  } catch (e) {
    // Audio optional - non-critical
  }
}

/** Check if Web Push is supported */
export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** Get current permission state: 'granted' | 'denied' | 'default' | 'unsupported' */
export function getNotificationPermission() {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission;
}

/** Register service worker if not already registered */
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    return reg;
  } catch (err) {
    console.warn('[SW Registration failed]:', err);
    return null;
  }
}

/**
 * Subscribe user's browser/phone to push notifications
 */
export async function enablePushNotifications() {
  if (!isPushSupported()) {
    throw new Error('Push notifications are not supported on this browser or platform.');
  }

  // 1. Request permission
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notification permission was denied. Please allow notifications in your browser or phone site settings.'
        : 'Notification permission was dismissed.'
    );
  }

  // 2. Register Service Worker
  const reg = await registerServiceWorker();
  if (!reg) {
    throw new Error('Service Worker could not be registered.');
  }

  // 3. Fetch VAPID Public Key from backend
  const { publicKey } = await api('/api/me/push-key');
  if (!publicKey) {
    throw new Error('Server VAPID public key not available.');
  }

  // 4. Subscribe to PushManager
  const applicationServerKey = urlBase64ToUint8Array(publicKey);
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  }

  // 5. Send subscription to server
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth <= 768;
  const res = await api('/api/me/push-subscribe', {
    method: 'POST',
    body: {
      subscription: subscription.toJSON(),
      deviceType: isMobile ? 'mobile' : 'desktop',
    },
  });

  playChime('success');
  return { ok: true, isMobile, subscription };
}

/**
 * Send a test notification to verify delivery on phone/desktop
 */
export async function testPushNotification() {
  playChime('accepted');
  const res = await api('/api/me/push-test', { method: 'POST' });
  return res;
}

/**
 * Listen for service worker messages when notification is tapped
 */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'NOTIFICATION_CLICKED') {
      window.dispatchEvent(new CustomEvent('scet:notification-click', { detail: event.data.payload }));
    }
  });
}
