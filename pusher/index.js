// Пушер: Web Push о новых заявках в дашборд.
// Отдельная функция Yandex Cloud с таймером «раз в минуту».
//
// БЕЗОПАСНОСТЬ: делает ТОЛЬКО чтение — тот же GET ?r=orders, что дашборд.
// Никаких POST/PATCH/DELETE, ничего не пишет ни в YDB, ни куда-либо ещё,
// своего хранилища не имеет. Выключили таймер — системы как будто не касались.
//
// Без хранилища: каждый запуск берёт заявки, созданные за прошлую целую минуту
// [T−60 с, T), где T — время срабатывания таймера, округлённое до минуты.
// Соседние запуски смотрят на разные минуты, поэтому одна заявка — один пуш.
//
// Переменные окружения функции:
//   ORDERS_URL        — адрес основной функции (как BASE_URL в js/api.js)
//   API_KEY           — ключ X-Api-Key (тот же, что вводится в дашборде)
//   VAPID_PUBLIC      — публичный VAPID-ключ (его же вставить в настройках дашборда)
//   VAPID_PRIVATE     — приватный VAPID-ключ (никому не показывать)
//   VAPID_SUBJECT     — mailto:ваша@почта
//   PUSH_SUBSCRIPTION — подписка из настроек дашборда (JSON целиком)
const webpush = require('web-push');

const MINUTE = 60 * 1000;

function triggerTime(event) {
  const t = Date.parse(event?.messages?.[0]?.event_metadata?.created_at || '');
  return Number.isNaN(t) ? Date.now() : t;
}

async function fetchOrders() {
  const res = await fetch(`${process.env.ORDERS_URL}?r=orders`, {
    method: 'GET',
    headers: { 'X-Api-Key': process.env.API_KEY },
  });
  if (!res.ok) throw new Error(`orders ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

module.exports.handler = async (event) => {
  const end = Math.floor(triggerTime(event) / MINUTE) * MINUTE;
  const start = end - MINUTE;

  const orders = await fetchOrders();
  const fresh = orders.filter((o) => {
    const t = Date.parse(o.created_at || '');
    return t >= start && t < end;
  });
  if (!fresh.length) return { statusCode: 200, body: 'нет новых' };

  webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);
  const subscription = JSON.parse(process.env.PUSH_SUBSCRIPTION);

  for (const o of fresh) {
    const type = String(o.type || 'Заявка').slice(0, 60);
    const payload = JSON.stringify({
      title: 'Новая заявка',
      body: type, // только тип — без имени, телефона и ника
      tag: `order-${o.id}`,
    });
    try {
      await webpush.sendNotification(subscription, payload, { TTL: 3600 });
    } catch (e) {
      // 404/410 — подписка устарела: включите пуши в дашборде заново и обновите PUSH_SUBSCRIPTION.
      console.error('push', e.statusCode || '', e.body || e.message);
    }
  }
  return { statusCode: 200, body: `отправлено: ${fresh.length}` };
};
