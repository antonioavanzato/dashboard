// Пушер: Web Push о новой заявке в дашборд (подстраховка к Telegram).
// Отдельная функция Yandex Cloud. Будит её сама форма сайта — рядом с notifyGAS,
// после того как hub-api ответил «ok». Один вызов на одну заявку.
//
// БЕЗОПАСНОСТЬ: не обращается ни к hub-api, ни к YDB, ни к чему-либо ещё в облаке.
// Принимает только факт заявки (тип и сайт) — как GAS, без личных данных —
// и пересылает его в Apple. Удалили функцию — облако как было.
//
// Переменные окружения:
//   VAPID_PUBLIC      — публичный VAPID-ключ (его же вставить в настройках дашборда)
//   VAPID_PRIVATE     — приватный VAPID-ключ (никому не показывать)
//   VAPID_SUBJECT     — mailto:ваша@почта
//   PUSH_SUBSCRIPTION — подписка из настроек дашборда (JSON целиком)
const webpush = require('web-push');

// Как SOURCE_LABELS в GAS: чужой источник станет безликим «сайт».
const SOURCE_LABELS = {
  'avanzato.ru': 'avanzato.ru',
  'presets': 'avanzato.ru',
  'presets-maldives': 'alga-tour.com',
  'github': 'antonioavanzato.github.io',
};

// Адрес функции публичный (лежит в коде сайта), поэтому лимит, как в GAS:
// не больше 20 пушей за 10 минут на экземпляр функции.
const FLOOD_LIMIT = 20;
const FLOOD_WINDOW_MS = 10 * 60 * 1000;
let windowId = 0;
let sent = 0;

function underFloodLimit() {
  const id = Math.floor(Date.now() / FLOOD_WINDOW_MS);
  if (id !== windowId) { windowId = id; sent = 0; }
  if (sent >= FLOOD_LIMIT) return false;
  sent += 1;
  return true;
}

const ok = () => ({ statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: 'ok' });

module.exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST' || !event.body) return ok();
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    const data = JSON.parse(raw);
    let type = String(data.type || '').trim() || 'Заявка';
    if (type.length > 60) type = type.slice(0, 60);
    const site = SOURCE_LABELS[String(data.source || '').trim()] || 'сайт';

    if (!underFloodLimit()) return ok();

    webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);
    await webpush.sendNotification(JSON.parse(process.env.PUSH_SUBSCRIPTION), JSON.stringify({
      title: 'Новая заявка',
      body: `${type} · ${site}`,
      tag: `order-${Date.now()}`,
    }), { TTL: 3600 });
  } catch (e) {
    // Видно в логах функции. 410 — подписка устарела: включите пуши в дашборде заново.
    console.error('push', e.statusCode || '', e.body || e.message);
  }
  // Форма шлёт no-cors и ответ не читает — всегда «ok», чтобы ошибка пуша не выглядела как проблема с заявкой.
  return ok();
};
