// PDV Pro — Service Worker
// Cache todas as dependências CDN para funcionar offline

const CACHE = 'pdv-pro-v1';

const RECURSOS = [
  '/',
  '/index.html',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js',
  'https://unpkg.com/react@17/umd/react.production.min.js',
  'https://unpkg.com/react-dom@17/umd/react-dom.production.min.js',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://unpkg.com/@babel/standalone/babel.min.js',
];

// Instalação — faz cache de tudo
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(RECURSOS))
  );
  self.skipWaiting();
});

// Ativação — limpa caches antigos
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — serve do cache primeiro, busca na rede se não tiver
self.addEventListener('fetch', (e) => {
  // Ignora requisições ao Firebase Firestore (dados em tempo real)
  if (e.request.url.includes('firestore.googleapis.com')) return;
  // Ignora Open Food Facts (sempre precisa de rede)
  if (e.request.url.includes('openfoodfacts.org')) return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((response) => {
        // Guarda no cache se for recurso estático válido
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE).then((cache) => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => {
        // Se falhar e for a página principal, serve o index.html do cache
        if (e.request.destination === 'document') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
