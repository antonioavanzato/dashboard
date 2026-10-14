import { listOrders, listEvents, saveEvent, setOrderStatus, deleteOrder, UnauthorizedError } from './api.js';
import {
  setEvents, eventsCount, allEvents, getCreateActions, renderPlanner, resetPlanner, setPlannerHandlers, findEvent, eventBody,
} from './planner.js';
import { openEditor } from './event-editor.js';
import { startTasks, hasTasksOn } from './tasks.js';
import { dayTasks } from './tasks-view.js';
import { openSettings, refreshSettings } from './settings.js';
import { loadKey, saveKey, clearKey, verifyKey, setMemoryKey, removeStoredKey } from './auth.js';
import { hasLock, clearLock, unlock, enableLock } from './lock.js';
import { renderHome } from './home.js';
import './sheet-swipe.js';
import {
  showAuthScreen,
  showListScreen,
  showLockScreen,
  setAuthError,
  setBanner,
  setConnection,
  renderFilters,
  renderList,
  resetShownOrders,
  enablePullToRefresh,
} from './ui.js';

// Тот же интервал, что у приложения: BookingRequestsSyncService.pollInterval.
const POLL_INTERVAL_MS = 20000;
// Планер — как EventsSyncService.pollInterval в приложении.
const PLANNER_POLL_INTERVAL_MS = 60000;
const VIEW_KEY = 'hub.pwa.view';

// Заявки живут только здесь, в памяти вкладки. На диск не попадают.
let orders = [];
let filterState = { archive: false, statusId: null };
let pollTimer = null;
let view = loadView();
let plannerLoaded = false;
let lastEventsJson = '';

function loadView() {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    return ['home', 'orders', 'planner'].includes(saved) ? saved : 'home';
  } catch {
    return 'home';
  }
}

function eventsLabel(n) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} событие`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} события`;
  return `${n} событий`;
}

function applyView() {
  const isPlanner = view === 'planner';
  const isHome = view === 'home';
  document.getElementById('view-home').hidden = !isHome;
  document.getElementById('view-orders').hidden = view !== 'orders';
  document.getElementById('view-planner').hidden = !isPlanner;
  document.getElementById('tab-home').setAttribute('aria-pressed', String(isHome));
  document.getElementById('tab-orders').setAttribute('aria-pressed', String(view === 'orders'));
  document.getElementById('tab-planner').setAttribute('aria-pressed', String(isPlanner));
  document.getElementById('list-screen').dataset.view = view;
  document.getElementById('fab-wrap').hidden = !isPlanner;
  closeFab();
  document.getElementById('title').textContent = isPlanner ? 'Планер' : 'Заявки';
  if (isHome) {
    renderHome({ orders, events: plannerLoaded ? allEvents() : null });
  } else if (isPlanner) {
    // Firebase подгружается только когда открыт Планер.
    startTasks(onTasksChanged);
    document.getElementById('subtitle').textContent = plannerLoaded ? eventsLabel(eventsCount()) : 'Загрузка…';
    renderPlanner();
  } else {
    render();
  }
}

function switchView(next) {
  if (view === next) return;
  view = next;
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Не страшно: вид просто не запомнится.
  }
  setBanner(null);
  applyView();
  startPolling();
}

function render() {
  renderFilters(orders, filterState, (next) => {
    filterState = next;
    render();
  });
  renderList(orders, filterState, { onStatusChange, onDelete });
}

function logout() {
  stopPolling();
  clearKey();
  clearLock(); // выход стирает и вход по Face ID — для следующего входа нужен ключ
  orders = [];
  filterState = { archive: false, statusId: null };
  plannerLoaded = false;
  lastEventsJson = '';
  resetPlanner();
  setBanner(null);
  setConnection(false);
  resetShownOrders();
  showAuthScreen();
}

function handleError(error) {
  if (error instanceof UnauthorizedError) {
    logout();
    setAuthError('Ключ недействителен');
    return true;
  }
  return false;
}

// Планер: только GET events — тот же запрос, что делает приложение при опросе.
async function pollPlanner() {
  const key = loadKey();
  if (!key) return;
  try {
    const fresh = await listEvents(key);
    setConnection(true);
    setBanner(null);
    // Перерисовываем только при изменениях: иначе раз в минуту стиралось бы
    // то, что набирается в форме входа задач.
    const json = JSON.stringify(fresh);
    const changed = json !== lastEventsJson || !plannerLoaded;
    lastEventsJson = json;
    setEvents(fresh);
    plannerLoaded = true;
    if (changed && (view === 'planner' || view === 'home')) applyView();
  } catch (error) {
    setConnection(false);
    if (handleError(error)) return;
    setBanner('Нет связи. Показаны последние загруженные события.');
  }
}

// Сохранение события. Защита от потери данных:
// перед записью перечитываем облако и, если событие успели изменить
// (в приложении или на другом устройстве), ничего не пишем.
async function onSaveEvent(event, isNew) {
  const key = loadKey();
  if (!key) throw new Error('Нужно войти заново');

  let fresh;
  try {
    fresh = await listEvents(key);
  } catch (error) {
    if (handleError(error)) throw new Error('Ключ недействителен');
    throw new Error('Нет связи. Ничего не сохранено, попробуйте ещё раз.');
  }

  const remote = fresh.find((e) => String(e.id) === event.id);
  if (!isNew) {
    const opened = findEvent(event.id);
    if (!remote) {
      setEvents(fresh);
      applyView();
      throw new Error('Это событие удалено в приложении. Ничего не сохранено.');
    }
    if (opened && (remote.updatedAt || '') !== (opened.updatedAt || '')) {
      setEvents(fresh);
      applyView();
      throw new Error('Событие только что изменили в приложении. Ничего не сохранено — закройте окно и откройте событие заново.');
    }
  } else if (remote) {
    throw new Error('Событие с таким id уже есть. Ничего не сохранено.');
  }

  try {
    await saveEvent(key, eventBody(event));
  } catch (error) {
    if (handleError(error)) throw new Error('Ключ недействителен');
    throw new Error('Не удалось сохранить. Проверьте связь и попробуйте ещё раз.');
  }
  await pollPlanner();
}

function onTasksChanged() {
  if (view === 'planner') renderPlanner();
  refreshSettings();
}

function openSettingsSheet() {
  startTasks(onTasksChanged); // чтобы в настройках был виден аккаунт задач
  openSettings({
    onYandexLogout: logout,
    yandex: {
      loggedIn: () => Boolean(loadKey()),
      login: async (key) => {
        try {
          await loginWithKey(key);
        } catch (error) {
          if (error.message === 'Ключ недействителен') throw error;
          throw new Error('Нет связи. Проверьте интернет и попробуйте снова.');
        }
      },
    },
    faceId: {
      enabled: hasLock,
      // Включение: шифруем ключ passkey'ем и только после проверки убираем открытый ключ.
      enable: async () => {
        const key = loadKey();
        if (!key) throw new Error('Сначала войдите ключом.');
        await enableLock(key);
        setMemoryKey(key);
        removeStoredKey();
      },
      // Выключение: возвращаем ключ на устройство как раньше.
      disable: () => {
        const key = loadKey();
        if (key) saveKey(key);
        clearLock();
      },
    },
  });
}

// Нижняя пилюля прячется при прокрутке вниз и плавно возвращается при прокрутке вверх.
(function autoHideTabbar() {
  const bar = document.getElementById('tabbar');
  let lastY = window.scrollY;
  window.addEventListener('scroll', () => {
    const y = Math.max(0, window.scrollY);
    const delta = y - lastY;
    if (Math.abs(delta) < 6) return; // мелкое дрожание не считаем
    if (y < 40 || delta < 0) bar.classList.remove('is-hidden');
    else bar.classList.add('is-hidden');
    lastY = y;
  }, { passive: true });
})();

setPlannerHandlers({
  onEdit: (id) => {
    const event = findEvent(id);
    if (event) openEditor(event, event.date, onSaveEvent);
  },
  onCreate: (day) => openEditor(null, day, onSaveEvent),
  hasTasks: (day) => hasTasksOn(day),
  dayTasks: (day) => dayTasks(day, openSettingsSheet),
});

async function poll() {
  if (view === 'planner') return pollPlanner();
  // Главной нужны и заявки, и события.
  if (view === 'home') pollPlanner();
  const key = loadKey();
  if (!key) return;
  try {
    // Статуса «Забронировано» больше нет: старые такие заявки
    // показываем как «Связались», чтобы они остались в работе.
    const fresh = (await listOrders(key)).map((o) =>
      o.status === 'booked' ? { ...o, status: 'contacted' } : o
    );
    setConnection(true);
    setBanner(null);
    // Перерисовываем только при реальных изменениях: иначе список моргал бы
    // анимацией каждые 20 секунд на каждом опросе.
    const changed = JSON.stringify(fresh) !== JSON.stringify(orders);
    orders = fresh;
    if (changed) {
      if (view === 'home') applyView();
      else render();
    }
  } catch (error) {
    setConnection(false);
    if (handleError(error)) return;
    setBanner('Нет связи. Показаны последние загруженные заявки.');
  }
}

function startPolling() {
  stopPolling();
  poll();
  pollTimer = setInterval(poll, view === 'planner' ? PLANNER_POLL_INTERVAL_MS : POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function onStatusChange(id, statusId) {
  const key = loadKey();
  if (!key) return;
  const order = orders.find((o) => o.id === id);
  if (!order) return;

  const previous = order.status;
  order.status = statusId; // применяем сразу
  render();

  try {
    await setOrderStatus(key, id, statusId);
  } catch (error) {
    order.status = previous; // откат
    render();
    if (handleError(error)) return;
    setBanner('Не удалось сменить статус. Попробуйте ещё раз.');
  }
}

async function onDelete(id) {
  const key = loadKey();
  if (!key) return;
  if (!confirm('Удалить заявку?')) return;

  const previous = orders;
  orders = orders.filter((o) => o.id !== id);
  render();

  try {
    await deleteOrder(key, id);
  } catch (error) {
    orders = previous; // откат
    render();
    if (handleError(error)) return;
    setBanner('Не удалось удалить заявку. Попробуйте ещё раз.');
  }
}

// Вход по ключу — общий для экрана входа и окна «Настройки».
async function loginWithKey(key) {
  if (!(await verifyKey(key))) throw new Error('Ключ недействителен');
  saveKey(key);
  clearLock(); // вошли новым ключом вручную — старый Face ID-вход больше не нужен
  showListScreen();
  applyView();
  startPolling();
}

async function onAuthSubmit(event) {
  event.preventDefault();
  const input = document.getElementById('auth-key');
  const submit = document.getElementById('auth-submit');
  const key = input.value.trim();
  if (!key) return;

  submit.disabled = true;
  setAuthError(null);
  try {
    await loginWithKey(key);
    input.value = '';
  } catch (error) {
    setAuthError(error.message === 'Ключ недействителен'
      ? error.message : 'Нет связи. Проверьте интернет и попробуйте снова.');
  } finally {
    submit.disabled = false;
  }
}

document.getElementById('auth-form').addEventListener('submit', onAuthSubmit);
document.getElementById('settings').addEventListener('click', openSettingsSheet);
// Кнопка «+» у дока: задача или событие на выбранный день.
const fab = document.getElementById('fab');
const fabMenu = document.getElementById('fab-menu');
function closeFab() {
  fabMenu.hidden = true;
  fab.setAttribute('aria-expanded', 'false');
}
fab.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!fabMenu.hidden) return closeFab();
  const actions = getCreateActions();
  if (actions.length === 1) return actions[0].run();
  fabMenu.replaceChildren(...actions.map((a) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fab-item';
    b.textContent = a.label;
    b.addEventListener('click', () => { closeFab(); a.run(); });
    return b;
  }));
  fabMenu.hidden = false;
  fab.setAttribute('aria-expanded', 'true');
});
document.addEventListener('click', (e) => { if (!e.target.closest('#fab-wrap')) closeFab(); });

document.getElementById('tab-home').addEventListener('click', () => switchView('home'));
document.getElementById('tab-orders').addEventListener('click', () => switchView('orders'));
document.getElementById('tab-planner').addEventListener('click', () => switchView('planner'));
document.getElementById('tab-settings').addEventListener('click', openSettingsSheet);
document.querySelectorAll('#view-home [data-go]').forEach((tile) => {
  tile.addEventListener('click', () => switchView(tile.dataset.go));
});
document.getElementById('auth-settings').addEventListener('click', openSettingsSheet);
enablePullToRefresh(poll);

// В фоне не опрашиваем: бережём бесплатный лимит Cloud Function.
document.addEventListener('visibilitychange', () => {
  if (document.getElementById('list-screen').hidden) return;
  if (document.hidden) stopPolling();
  else startPolling();
});

// Face ID при открытии запускается сам. Кнопки показываются только если
// он отменён или не сработал (повторить / войти ключом вручную).
async function tryUnlock() {
  const actions = document.getElementById('lock-actions');
  const error = document.getElementById('lock-error');
  const status = document.getElementById('lock-status');
  actions.hidden = true;
  error.hidden = true;
  status.hidden = false;
  try {
    setMemoryKey(await unlock());
    showListScreen();
    applyView();
    startPolling();
  } catch (e) {
    status.hidden = true;
    error.textContent = e?.name === 'NotAllowedError' ? 'Face ID отменён' : (e.message || 'Не удалось войти');
    error.hidden = false;
    actions.hidden = false;
  }
}
document.getElementById('lock-unlock').addEventListener('click', tryUnlock);
document.getElementById('lock-manual').addEventListener('click', () => {
  setAuthError(null);
  showAuthScreen();
});

if (loadKey()) {
  showListScreen();
  applyView();
  startPolling();
} else if (hasLock()) {
  showLockScreen();
  tryUnlock();
} else {
  showAuthScreen();
}

if ('serviceWorker' in navigator) {
  // updateViaCache: 'none' — сам файл sw.js никогда не берётся из кэша браузера,
  // иначе обновление обработчика может не доехать до устройства неделями.
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});

  // Когда новый обработчик перехватывает управление, перезагружаем страницу
  // один раз, чтобы показать свежую версию без ручного закрытия.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}
