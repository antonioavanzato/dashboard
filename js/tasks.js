// Личные задачи (Firebase, коллекция personal_tasks) внутри Планера.
// Повторяет приложение: AppViewModel.updateTasksFromFirebase и
// FirebaseSyncService.syncPersonalTaskToFirebase.
//
// Безопасность данных:
// - доступ только после входа тем же email/паролем, что в приложении;
//   правила Firestore отдают документы только их владельцу (userId == uid);
// - удаления нет; правка меняет ТОЛЬКО поля формы (update), остальное в документе
//   остаётся как было; перед правкой в транзакции сверяется updatedAt —
//   если задачу успели изменить в приложении, ничего не пишется;
// - задачи держатся только в памяти вкладки (без офлайн-кэша Firestore).

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

// Веб-ключ Firebase не секретный: доступ к данным решают правила Firestore.
const CONFIG = {
  apiKey: 'AIzaSyBqoJ1oksjTHhTIldZlemnKgac1tbgEqAg',
  authDomain: 'creatorhub-9cc1f.firebaseapp.com',
  projectId: 'creatorhub-9cc1f',
};

export const PRIORITIES = [
  ['high', 'Высокий'],
  ['medium', 'Средний'],
  ['low', 'Низкий'],
];

let fb = null;          // загруженные модули SDK
let auth = null;
let db = null;
let user = null;
let tasks = [];
let unsubscribe = null;
let state = 'idle';     // idle | loading | signed-out | ready | error
let lastError = '';
let onChange = () => {};

async function loadSdk() {
  if (fb) return fb;
  const [app, authMod, store] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  fb = { app, auth: authMod, store };
  return fb;
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Как разбирает приложение (new SDPersonalTask + applyExtraTaskFields).
export function normalizeTask(id, data) {
  return {
    id,
    task: data.task || '',
    date: toDate(data.date) || new Date(),
    duration: Number.isInteger(data.duration) ? data.duration : 30,
    completed: Boolean(data.completed),
    notes: data.notes || '',
    priority: data.priority || 'medium',
    location: data.location || '',
    link: data.link || '',
    contactName: data.contactName || '',
    contactPhone: data.contactPhone || '',
    updatedAtMs: toDate(data.updatedAt)?.getTime() || 0,
  };
}

export function tasksState() {
  return { state, error: lastError, email: user?.email || '' };
}

const sameDay = (a, b) => a.getFullYear() === b.getFullYear()
  && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function tasksOn(day) {
  return tasks.filter((t) => sameDay(t.date, day)).sort((a, b) => a.date - b.date);
}

export function hasTasksOn(day) {
  return tasks.some((t) => sameDay(t.date, day));
}

export function findTask(id) {
  return tasks.find((t) => t.id === id) || null;
}

function set(next, error = '') {
  state = next;
  lastError = error;
  onChange();
}

function listen() {
  stopListening();
  const { collection, query, where, onSnapshot } = fb.store;
  const q = query(collection(db, 'personal_tasks'), where('userId', '==', user.uid));
  unsubscribe = onSnapshot(q, (snap) => {
    tasks = snap.docs.map((d) => normalizeTask(d.id, d.data()));
    set('ready');
  }, () => set('error', 'Не удалось загрузить задачи'));
}

function stopListening() {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
}

/** Запуск: подгружает SDK и восстанавливает вход, если он уже был. */
export async function startTasks(changed) {
  onChange = changed || (() => {});
  if (state !== 'idle') { onChange(); return; }
  set('loading');
  try {
    await loadSdk();
    const app = fb.app.initializeApp(CONFIG, 'hub-pwa');
    auth = fb.auth.getAuth(app);
    // Без офлайн-кэша: задачи не сохраняются на диск устройства.
    db = fb.store.initializeFirestore(app, { localCache: fb.store.memoryLocalCache() });
    fb.auth.onAuthStateChanged(auth, (u) => {
      user = u;
      if (u) {
        set('loading');
        listen();
      } else {
        stopListening();
        tasks = [];
        set('signed-out');
      }
    });
  } catch {
    state = 'idle';
    set('error', 'Не удалось подключиться к Firebase. Проверьте интернет.');
    state = 'idle';
  }
}

export async function signIn(email, password) {
  try {
    await fb.auth.signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    const code = e?.code || '';
    if (code.includes('invalid') || code.includes('wrong-password') || code.includes('user-not-found')) {
      throw new Error('Неверный email или пароль');
    }
    if (code.includes('too-many-requests')) throw new Error('Слишком много попыток. Подождите немного.');
    if (code.includes('api-key') || code.includes('referer') || code.includes('requests-from')) {
      throw new Error('Firebase не пускает вход с сайта — нужен веб-ключ.');
    }
    throw new Error('Не удалось войти. Проверьте интернет.');
  }
}

export async function signOutTasks() {
  if (auth) await fb.auth.signOut(auth);
}

/** Отметка «выполнено» — только поля completed и updatedAt. */
export async function setCompleted(task, completed) {
  await guardedUpdate(task, { completed });
}

/** Правка: только поля формы, с проверкой, что задачу не меняли параллельно. */
export async function updateTask(task, fields) {
  await guardedUpdate(task, fields);
}

async function guardedUpdate(task, fields) {
  const { doc, runTransaction, Timestamp } = fb.store;
  const ref = doc(db, 'personal_tasks', task.id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Задача удалена в приложении. Ничего не сохранено.');
    const remote = toDate(snap.data().updatedAt)?.getTime() || 0;
    if (remote !== task.updatedAtMs) {
      throw new Error('Задачу только что изменили в приложении. Ничего не сохранено — откройте её заново.');
    }
    const data = { ...fields, updatedAt: Timestamp.fromDate(new Date()) };
    if (data.date instanceof Date) data.date = Timestamp.fromDate(data.date);
    tx.update(ref, data);
  });
}

/** Новая задача — тот же набор полей, что syncPersonalTaskToFirebase. */
export async function createTask(fields) {
  const { doc, setDoc, getDoc, Timestamp } = fb.store;
  const id = crypto.randomUUID().toUpperCase();
  const ref = doc(db, 'personal_tasks', id);
  if ((await getDoc(ref)).exists()) throw new Error('Не удалось создать задачу, попробуйте ещё раз.');
  const now = Timestamp.fromDate(new Date());
  await setDoc(ref, {
    userId: user.uid,
    task: fields.task,
    date: Timestamp.fromDate(fields.date),
    duration: 30,
    completed: false,
    notes: fields.notes || '',
    priority: fields.priority || 'medium',
    location: fields.location || '',
    link: fields.link || '',
    contactName: fields.contactName || '',
    contactPhone: fields.contactPhone || '',
    createdAt: now,
    updatedAt: now,
    syncedFromLocal: true,
  });
}
