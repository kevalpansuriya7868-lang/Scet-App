/* =========================================================
   SCET Lab Portal — Service Worker (Web Push & Offline Shell)
   ========================================================= */

const SW_VERSION = 'scet-sw-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle incoming Web Push notifications from server
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'SCET Lab Notification', body: event.data.text() };
    }
  }

  const title = data.title || 'SCET Lab Notification';
  const options = {
    body: data.body || 'Your hardware request status has been updated.',
    icon: data.icon || '/assets/logo-footer.png',
    badge: data.badge || '/assets/logo-footer.png',
    vibrate: data.vibrate || [200, 100, 200, 100, 200],
    tag: data.tag || 'scet-request-update',
    renotify: true,
    data: data.data || { url: '/#tab=requests' },
    actions: data.actions || [
      { action: 'view', title: 'View Request 📦' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Handle notification click on phone/desktop
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If a window is already open, focus it and broadcast event
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({
            type: 'NOTIFICATION_CLICKED',
            payload: event.notification.data,
          });
          return client.focus();
        }
      }
      // If no window is open, open a new one
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
