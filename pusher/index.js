// Пушер: Web Push о новой заявке в дашборд (подстраховка к Telegram).
// Отдельная функция Yandex Cloud. Будит её GAS (notifyPusher_ после Telegram),
// один вызов на одну заявку. Формы сайтов и hub-api не меняются.
//
// БЕЗОПАСНОСТЬ: не обращается ни к hub-api, ни к YDB, ни к чему-либо ещё в облаке.
// Принимает только факт заявки (тип и источник) от GAS, без личных данных,
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

// GAS и формы ответ не читают; текст ответа (sent / skip / err) нужен только для проверки.
const reply = (text) => ({ statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: text });

// Тело по ссылке приходит не так, как в консоли: бывает объектом или base64.
function readBody(event) {
  let raw = event.body;
  if (raw && typeof raw === 'object') return raw;
  raw = String(raw || '');
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  return JSON.parse(raw);
}

module.exports.handler = async (event) => {
  const method = String(event.httpMethod || event.requestContext?.httpMethod || '').toUpperCase();
  if (method && method !== 'POST') return reply(`skip:method ${method}`);
  let data;
  try {
    data = readBody(event);
  } catch (e) {
    return reply(`skip:body ${typeof event.body} b64=${event.isBase64Encoded}`);
  }
  let type = String(data.type || '').trim() || 'Заявка';
  if (type.length > 60) type = type.slice(0, 60);
  const site = SOURCE_LABELS[String(data.source || '').trim()] || 'сайт';

  if (!underFloodLimit()) return reply('skip:flood');

  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);
    const res = await webpush.sendNotification(JSON.parse(process.env.PUSH_SUBSCRIPTION), JSON.stringify({
      title: 'Новая заявка',
      body: `${type} · ${site}`,
      tag: `order-${Date.now()}`,
    }), { TTL: 3600 });
    return reply(`sent ${res.statusCode}`);
  } catch (e) {
    // 410 — подписка устарела: включите пуши в дашборде заново и обновите PUSH_SUBSCRIPTION.
    console.error('push', e.statusCode || '', e.body || e.message);
    return reply(`err:${e.statusCode || ''} ${String(e.body || e.message).slice(0, 200)}`);
  }
};
