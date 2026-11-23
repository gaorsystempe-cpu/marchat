/* MAR Service Worker Push & Mention Notification Extension */
/* Loaded via Workbox importScripts so precaching and runtime caching remain intact. */

self.addEventListener('push', function (event) {
  var payload = {
    title: 'MAR · Nueva mención',
    body: 'Te han mencionado en un canal.',
    channelId: null,
    channelName: '',
    senderName: '',
    tag: 'mar-mention',
    url: '/',
  };

  if (event.data) {
    try {
      var parsed = event.data.json();
      payload = Object.assign(payload, parsed);
    } catch (_err) {
      var text = event.data.text();
      if (text) {
        payload.body = text;
      }
    }
  }

  var targetUrl =
    payload.url ||
    (payload.channelId ? '/?canal=' + encodeURIComponent(String(payload.channelId)) : '/');

  var options = {
    body: payload.body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: payload.tag || 'mar-mention',
    renotify: true,
    vibrate: [150, 80, 150],
    data: {
      url: targetUrl,
      channelId: payload.channelId || null,
      channelName: payload.channelName || '',
    },
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  var data = event.notification.data || {};
  var targetUrl = data.url || '/';
  var channelId = data.channelId || null;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (clientList) {
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if ('focus' in client) {
            client.postMessage({
              type: 'MAR_OPEN_CHANNEL',
              channelId: channelId,
            });
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      })
  );
});

self.addEventListener('pushsubscriptionchange', function (event) {
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (clientList) {
        for (var i = 0; i < clientList.length; i++) {
          clientList[i].postMessage({
            type: 'MAR_PUSH_SUBSCRIPTION_CHANGED',
          });
        }
      })
  );
});
