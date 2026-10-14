// Вход по Face ID (passkey + расширение WebAuthn PRF).
// Ключ доступа шифруется секретом, который отдаёт только passkey после Face ID.
// В открытом виде ключ на устройстве не хранится — только в памяти вкладки.
// Сервер и облако не меняются: им по-прежнему уходит обычный ключ доступа.

const STORE = 'hub.lock.v1';
const PENDING = 'hub.lock.pending';
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function read() {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function hasLock() {
  return Boolean(read());
}

export function clearLock() {
  forgetPending();
  try {
    localStorage.removeItem(STORE);
  } catch {
    // нечего стирать
  }
}

export function lockSupported() {
  return Boolean(window.PublicKeyCredential && navigator.credentials && crypto.subtle);
}

async function aesKey(prfOutput) {
  const base = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('hub-pwa-lock'), info: enc.encode('api-key') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// Face ID → секрет PRF для этого passkey.
async function prfSecret(credId, salt) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: credId }],
      userVerification: 'required',
      timeout: 60000,
      extensions: { prf: { eval: { first: salt } } },
    },
  });
  const out = assertion?.getClientExtensionResults?.().prf?.results?.first;
  if (!out) throw new Error('Это устройство не поддерживает вход по Face ID для сайтов.');
  return out;
}

/** Включение: создаёт passkey и шифрует им ключ доступа. */
export async function enableLock(apiKey) {
  if (!lockSupported()) throw new Error('Это устройство не поддерживает вход по Face ID для сайтов.');
  const salt = crypto.getRandomValues(new Uint8Array(32));

  // Если прошлая попытка создала ключ входа, но не дошла до конца
  // (Face ID отменён) — берём его же, а не создаём ещё один.
  let pending = null;
  try {
    pending = localStorage.getItem(PENDING);
  } catch {
    // нет доступа к хранилищу — просто создадим новый
  }
  const credId = pending ? unb64(pending) : await createPasskey();

  // Секрет берём отдельным подтверждением — так надёжнее на iPhone.
  let secret;
  try {
    secret = await prfSecret(credId, salt);
  } catch (e) {
    // Запомненный ключ входа могли удалить в «Паролях» — следующая попытка создаст новый.
    if (pending) forgetPending();
    throw e;
  }
  const key = await aesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(apiKey));

  // Проверяем, что расшифровка работает, ДО того как убрать открытый ключ.
  const check = dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data));
  if (check !== apiKey) throw new Error('Проверка шифрования не прошла. Ничего не изменено.');

  localStorage.setItem(STORE, JSON.stringify({
    credId: b64(credId), salt: b64(salt), iv: b64(iv), data: b64(data),
  }));
  forgetPending();
}

function forgetPending() {
  try {
    localStorage.removeItem(PENDING);
  } catch {
    // не страшно
  }
}

async function createPasskey() {
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'HUB' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'HUB', displayName: 'HUB — заявки и планер' },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'required',
        userVerification: 'required',
      },
      timeout: 60000,
      extensions: { prf: {} },
    },
  });
  if (!cred) throw new Error('Не удалось создать ключ входа.');
  const id = new Uint8Array(cred.rawId);
  try {
    localStorage.setItem(PENDING, b64(id));
  } catch {
    // не страшно: в худшем случае при повторе создастся новый
  }
  return id;
}

/** Разблокировка по Face ID: возвращает ключ доступа. */
export async function unlock() {
  const lock = read();
  if (!lock) throw new Error('Вход по Face ID не настроен.');
  const secret = await prfSecret(unb64(lock.credId), unb64(lock.salt));
  const key = await aesKey(secret);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(lock.iv) }, key, unb64(lock.data),
    );
    return dec.decode(plain);
  } catch {
    throw new Error('Не удалось расшифровать ключ. Войдите ключом вручную.');
  }
}
