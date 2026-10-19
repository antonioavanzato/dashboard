// Web Push о новых заявках — приёмная сторона.
// Отправляет отдельная функция-пушер (pusher/ в этом репозитории): её будит GAS
// сразу после Telegram, и она шлёт обезличенный пуш через Apple.
// hub-api, YDB, формы сайтов и CreatorHub об этом не знают и не меняются.
// Подписка этого устройства копируется в настройки пушера (переменная PUSH_SUBSCRIPTION).

const KEY_STORAGE = 'push-vapid-public';

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function savedPublicKey() {
  try {
    return localStorage.getItem(KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

function toBytes(base64url) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** Включить пуши на этом устройстве; вернуть подписку строкой JSON. */
export async function enablePush(publicKey) {
  const key = publicKey.trim();
  if (!key) throw new Error('Вставьте публичный VAPID-ключ пушера');
  // На iPhone разрешение можно спросить только по нажатию и только в приложении с экрана «Домой».
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Уведомления запрещены — разрешите их в настройках iPhone');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub) await sub.unsubscribe(); // ключ мог смениться — подписываемся заново
  sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(key) });
  try {
    localStorage.setItem(KEY_STORAGE, key);
  } catch {
    // Не страшно: ключ придётся вставить ещё раз.
  }
  return JSON.stringify(sub);
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (sub) await sub.unsubscribe();
}
