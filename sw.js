// Кэшируем ТОЛЬКО оболочку (код, стили, иконки, шрифты). Заявки, события
// и задачи — персональные данные, на диск устройства они не попадают (152-ФЗ).
//
// Стратегия — «сначала кэш» из ОДНОЙ версии оболочки: приложение открывается
// мгновенно, без ожидания сети. Обновление приходит только целиком — новой
// версией этого файла (CACHE ниже меняется при каждой выкладке). Браузер
// проверяет sw.js при каждом запуске (updateViaCache: 'none' в main.js),
// ставит новую версию в фоне, и страница один раз перезагружается.
// Так нет ни «неделями старой версии», ни смеси старых и новых файлов.
const CACHE = 'dashboard-shell-v24';
const FONTS = 'dashboard-fonts-v1';
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
  'js/sheet-swipe.js',
  'js/students.js',
  'js/student-actions.js',
  'icons/icon.svg',
  'icons/logo.svg',
  'icons/apple-touch-icon-v3.png',
  'icons/icon-192-v3.png',
  'icons/icon-512-v3.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE && key !== FONTS).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Шрифты Google: неизменны, держим в отдельном кэше.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(caches.open(FONTS).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    }));
    return;
  }

  // Всё остальное чужое (API, Firebase) — мимо кэша: там персональные данные.
  if (url.origin !== self.location.origin) return;

  // Иконки и описание приложения Safari берёт сам при «На экран Домой» / «Добавить в Dock» —
  // отдаём их напрямую из сети, без участия этого обработчика.
  if (/\.(png|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/apple-touch-icon.png')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Запуск приложения (навигация) всегда отдаём из оболочки.
    const hit = await cache.match(req.mode === 'navigate' ? './' : req, { ignoreSearch: req.mode === 'navigate' })
      || await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch {
      return Response.error();
    }
  })());
});
