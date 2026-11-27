'use strict';
const CACHE = 'quadra-online-shell-v10';
const SHELL = ['/', '/index.html', '/styles.css', '/browser-runtime.js', '/accounting.js',
  '/payments.js', '/schedule.js', '/notifications.js', '/app.js', '/favicon.svg',
  '/icon-192.png', '/icon-512.png', '/manifest.webmanifest', '/catalogo_categorie.json', '/initial-state.json',
  '/online.css', '/dialogs.js', '/iphone-backup.js', '/local-folder.js', '/data-tools.js', '/google-config.js', '/drive-sync.js', '/vendor/fflate.js', '/vendor/xlsx.js'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) {
    if (key.startsWith('quadra-online-shell-') && key !== CACHE) await caches.delete(key);
  }
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method === 'GET' && url.origin === location.origin && /^\/api\/(attachments|statement-documents)\/[a-f0-9]{32}$/.test(url.pathname)) {
    event.respondWith((async () => {
      const record = await new Promise((resolve,reject) => {
        const opening = indexedDB.open('quadra-online',1);
        opening.onsuccess = () => {
          const db = opening.result;
          if (!db.objectStoreNames.contains('workspace')) { db.close(); resolve(null); return; }
          const transaction = db.transaction('workspace','readonly');
          const request = transaction.objectStore('workspace').get('current');
          request.onsuccess = () => resolve(request.result);
          transaction.oncomplete = () => db.close();
          transaction.onerror = () => { db.close(); reject(transaction.error); };
        };
        opening.onerror = () => reject(opening.error);
      });
      const id = url.pathname.split('/').pop(), blob = record?.documents?.[id];
      if (!blob) return new Response('Documento non trovato',{status:404});
      return new Response(blob,{headers:{'Content-Type':blob.type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    })()); return;
  }
  if (event.request.method !== 'GET' || url.origin !== location.origin || !SHELL.includes(url.pathname)) return;
  // Prefer the current build online; retain cached resources for offline use.
  // Cache-first previously kept the old timestamped Drive uploader active.
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request,{cache:'no-store'});
      if (response.ok) return response;
    } catch {}
    const cached = await caches.match(url.pathname,{cacheName:CACHE});
    return cached || new Response('Risorsa offline non disponibile',{status:503});
  })());
});
