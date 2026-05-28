const CACHE_NAME = 'cutierover-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Mono:wght@300;400;500&family=Outfit:wght@300;400;500;600&display=swap'
];

// Install — кэшируем статику
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate — чистим старые кэши
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — стратегия stale-while-revalidate для API, cache-first для статики
self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // API запросы — network first с fallback
  if (url.pathname.includes('/rest/v1/')) {
    e.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // Статика — cache first
  e.respondWith(
    caches.match(request).then(cached => {
      const fetchPromise = fetch(request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

// Push уведомления о новых VOD
self.addEventListener('push', (e) => {
  const data = e.data?.json() || {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'Новый VOD!', {
      body: data.body || 'cutierover загрузила новую запись стрима',
      icon: 'https://i.imgur.com/FLcgea4.jpeg',
      badge: 'https://i.imgur.com/FLcgea4.jpeg',
      tag: 'new-vod',
      requireInteraction: true,
      data: { url: data.url || '/' }
    })
  );
});

// Клик по уведомлению
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.openWindow(e.notification.data?.url || '/')
  );
});