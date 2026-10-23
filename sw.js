// =====================================================================
// Service Worker — deixa o site "instalável" no celular (PWA).
// Estratégia: sempre busca a versão nova na internet; se estiver sem
// internet, usa a cópia guardada. (Os dados do Supabase nunca são guardados.)
// =====================================================================
const CACHE = 'farmalembra-v2';

const ARQUIVOS = [
  './', 'index.html', 'app.html', 'privacidade.html', 'manifest.json',
  'css/style.css', 'img/logo.svg', 'img/icone-192.png', 'img/icone-512.png', 'img/icone-maskable-512.png',
  'js/config.js', 'js/supabase.js', 'js/auth.js', 'js/router.js', 'js/utils.js',
  'js/ui.js', 'js/store.js', 'js/fila.js', 'js/mensagens.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Só arquivos do próprio site (GET). Supabase e CDN passam direto.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp.ok) {
          const copia = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copia));
        }
        return resp;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })),
  );
});
