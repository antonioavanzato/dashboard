// Кэшируем ТОЛЬКО оболочку. Заявки — персональные данные,
// на диск устройства они не попадают (152-ФЗ).
//
// Стратегия — «сначала сеть». Кэш нужен лишь для работы без связи.
// Обратный порядок (сначала кэш) приводил к тому, что на устройстве
// неделями жила старая версия страницы.
const CACHE = 'dashboard-shell-v1';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/main.js',
  'js/ui.js',
  'js/api.js',
  'js/auth.js',
  'js/store.js',
  'js/status.js',
  'js/planner.js',
  'js/event-editor.js',
  'js/tasks.js',
  'js/task-editor.js',
  'js/tasks-view.js',
  'js/settings.js',
  'js/lock.js',
  'js/home.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Запросы к API мимо кэша всегда: ответы содержат персональные данные.
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    // cache: 'no-cache' — сверяться с сервером всегда. GitHub Pages разрешает
    // браузеру 10 минут держать старые файлы, и после выкладки страница
    // получала смесь новых и старых скриптов (чёрный экран).
    fetch(event.request, { cache: 'no-cache' })
      .then((response) => {
        // Свежий файл кладём в кэш — пригодится, когда связи не будет.
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || Response.error()))
  );
});
