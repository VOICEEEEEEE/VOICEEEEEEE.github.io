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
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate — чистим старые кэши
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch — стратегия stale-while-revalidate для API, cache-first для статики
self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // API запросы — сеть с fallback на кэш
  if (url.hostname.includes('supabase.co')) {
    e.respondWith(
      fetch(request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Статика — кэш first
  if (request.method === 'GET') {
    e.respondWith(
      caches.match(request).then(cached => {
        if (cached) {
          // Обновляем кэш в фоне
          fetch(request).then(response => {
            caches.open(CACHE_NAME).then(cache => cache.put(request, response));
          }).catch(() => {});
          return cached;
        }
        return fetch(request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          return response;
        });
      })
    );
  }
});

// Background Sync — отложенная отправка данных
self.addEventListener('sync', (e) => {
  if (e.tag === 'sync-vods') {
    e.waitUntil(syncPendingVods());
  }
});

async function syncPendingVods() {
  const db = await openDB('cutierover', 1);
  const pending = await db.getAll('pendingVods');
  for (const vod of pending) {
    try {
      await fetch(`${self.location.origin}/api/vods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vod)
      });
      await db.delete('pendingVods', vod.id);
    } catch(e) {
      console.log('Sync failed for vod', vod.id);
    }
  }
}

// Push notifications
self.addEventListener('push', (e) => {
  const data = e.data?.json() || {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'cutierover', {
      body: data.body || 'Новый VOD доступен!',
      icon: 'https://i.imgur.com/rNexn9C.jpeg',
      badge: 'https://i.imgur.com/FLcgea4.jpeg',
      tag: 'new-vod',
      requireInteraction: true,
      actions: [
        { action: 'open', title: 'Смотреть' },
        { action: 'close', title: 'Закрыть' }
      ]
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  if (e.action === 'open' || !e.action) {
    e.waitUntil(
      clients.openWindow('/')
    );
  }
});

// IndexedDB helper
function openDB(name, version) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('pendingVods')) {
        db.createObjectStore('pendingVods', { keyPath: 'id' });
      }
    };
  });
}
