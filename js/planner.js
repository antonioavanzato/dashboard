// Планер: просмотр, создание и правка событий. Удаления в PWA нет намеренно.
// Данные живут в памяти вкладки, на диск не пишутся.
// Поля и подписи повторяют приложение: EventsSyncService.applyEvents,
// WorkEventTypeColor, ShootingStatus, TaskDetailView.

const TYPE_COLORS = {
  shooting: 'rgb(64, 122, 255)',   // Съёмка — синий
  project: 'rgb(92, 173, 255)',    // Сайт — голубой
  meeting: 'rgb(102, 214, 140)',   // Обучение — зелёный
};
const TYPE_ORDER = ['shooting', 'project', 'meeting'];
const TYPE_LABELS = { shooting: 'Съёмка', project: 'Сайт', meeting: 'Обучение' };
const STATUS_LABELS = {
  pending: 'Ожидает',
  confirmed: 'Подтверждена',
  completed: 'Завершена',
  cancelled: 'Отменена',
};
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

let events = [];
let handlers = {};
let selected = startOfDay(new Date());
let month = new Date(selected.getFullYear(), selected.getMonth(), 1);
const expanded = new Set();

// ---------- Данные ----------

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseTech(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

// Приводим ответ облака к виду, как его разбирает приложение.
export function normalizeEvent(raw) {
  const date = parseDate(raw.date);
  if (!raw.id || !date) return null;
  return {
    id: String(raw.id),
    task: raw.task || raw.clientName || 'Без названия',
    type: raw.type || 'project',
    date,
    notes: raw.notes || '',
    location: raw.location || '',
    phone: raw.clientPhone || '',
    telegram: raw.clientTelegram || '',
    prepayment: Number(raw.prepayment) || 0,
    total: Number(raw.totalAmount) || 0,
    status: raw.status || 'pending',
    tech: parseTech(raw.tech),
    wfolio: raw.wfolioUrl || '',
    priority: raw.priority || 'medium',
    updatedAt: raw.updatedAt || '',
  };
}

// Тело запроса — один в один EventsSyncService.body(for:) в приложении.
// Облако перезаписывает событие целиком, поэтому отправляются ВСЕ поля.
export function eventBody(e) {
  return {
    id: e.id,
    task: e.task,
    type: e.type,
    priority: e.priority || 'medium',
    date: e.date.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    notes: e.notes || '',
    location: e.location || '',
    client_name: e.task,
    client_phone: e.phone || '',
    client_telegram: e.telegram || '',
    prepayment: Number(e.prepayment) || 0,
    final_payment: Number(e.total) || 0,
    total_amount: Number(e.total) || 0,
    status: e.status || 'pending',
    tech: Array.isArray(e.tech) ? e.tech : [],
    wfolio_url: e.wfolio || '',
  };
}

// Как normalizeTelegramUsername в приложении.
export function normalizeTelegram(raw) {
  let value = String(raw || '').trim();
  const lower = value.toLowerCase();
  for (const prefix of ['https://t.me/', 'http://t.me/', 't.me/']) {
    if (lower.startsWith(prefix)) {
      value = value.slice(prefix.length);
      break;
    }
  }
  if (value.startsWith('@')) value = value.slice(1);
  return value.replace(/ /g, '');
}

export function findEvent(id) {
  return events.find((e) => e.id === id) || null;
}

export function setEvents(list) {
  events = list
    .map(normalizeEvent)
    .filter(Boolean)
    .sort((a, b) => a.date - b.date);
}

export function allEvents() {
  return events;
}

export function eventsCount() {
  return events.length;
}

function eventsOn(day) {
  return events.filter((e) => sameDay(e.date, day));
}

// ---------- Разметка ----------

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatMoney(value) {
  return `${new Intl.NumberFormat('ru-RU').format(Math.round(value))} ₽`;
}

function formatTime(date) {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatDayTitle(date) {
  const day = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(date);
  const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'long' }).format(date);
  return `${day}, ${weekday}`;
}

function telegramHref(value) {
  const handle = String(value)
    .trim()
    .replace(/^@/, '')
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/^t\.me\//, '')
    .replace(/[/?].*$/, '');
  return `https://t.me/${handle}`;
}

function link(label, href) {
  const a = element('a', 'button', label);
  a.href = href;
  a.rel = 'noopener';
  if (href.startsWith('http')) a.target = '_blank';
  return a;
}

function detailRow(label, value) {
  const row = element('div', 'ev-row');
  row.append(element('span', 'ev-row-label', label), element('span', 'ev-row-value', value));
  return row;
}

function eventCard(event, { showDate } = {}) {
  const card = element('article', 'ev-card');
  card.dataset.status = event.status;
  card.style.setProperty('--type', TYPE_COLORS[event.type] || TYPE_COLORS.meeting);

  const head = element('button', 'ev-head');
  head.type = 'button';
  head.setAttribute('aria-expanded', String(expanded.has(event.id)));

  const time = element('span', 'ev-time', showDate
    ? `${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(event.date).replace('.', '')} · ${formatTime(event.date)}`
    : formatTime(event.date));
  const title = element('span', 'ev-title', event.task);
  const meta = element('span', 'ev-meta',
    [TYPE_LABELS[event.type] || 'Проект', STATUS_LABELS[event.status] || 'Неизвестно'].join(' · '));
  const text = element('span', 'ev-text');
  text.append(title, meta);
  head.append(element('span', 'ev-dot'), time, text);
  head.addEventListener('click', () => {
    if (expanded.has(event.id)) expanded.delete(event.id);
    else expanded.add(event.id);
    renderPlanner();
  });
  card.append(head);

  if (expanded.has(event.id)) {
    const body = element('div', 'ev-body');
    if (event.location) body.append(detailRow('Локация', event.location));
    if (event.phone) body.append(detailRow('Телефон', event.phone));
    if (event.telegram) body.append(detailRow('Telegram', event.telegram));
    if (event.total > 0 || event.prepayment > 0) {
      // Подписи как в TaskDetailView: «Финальный платёж» и «Итого» = предоплата + финал.
      if (event.prepayment > 0) body.append(detailRow('Предоплата', formatMoney(event.prepayment)));
      if (event.total > 0) body.append(detailRow('Финал', formatMoney(event.total)));
      body.append(detailRow('Итого', formatMoney(event.prepayment + event.total)));
    }
    if (event.tech.length) body.append(detailRow('Техника', event.tech.join(', ')));
    if (event.notes) {
      const notes = element('p', 'ev-notes', event.notes);
      body.append(notes);
    }

    const actions = element('div', 'ev-actions');
    const digits = event.phone.replace(/[^\d+]/g, '');
    if (digits) actions.append(link('Позвонить', `tel:${digits}`));
    if (event.telegram) actions.append(link('Telegram', telegramHref(event.telegram)));
    if (/^https?:\/\//.test(event.wfolio)) actions.append(link('Wfolio', event.wfolio));
    if (handlers.onEdit) {
      const edit = element('button', 'button button--primary', 'Изменить');
      edit.type = 'button';
      edit.addEventListener('click', () => handlers.onEdit(event.id));
      actions.append(edit);
    }
    if (actions.childElementCount) body.append(actions);

    card.append(body);
  }
  return card;
}

function renderCalendar(root) {
  const nav = element('div', 'cal-nav');
  const prev = element('button', 'icon-button', '‹');
  prev.type = 'button';
  prev.setAttribute('aria-label', 'Предыдущий месяц');
  prev.addEventListener('click', () => {
    month = new Date(month.getFullYear(), month.getMonth() - 1, 1);
    renderPlanner();
  });
  const next = element('button', 'icon-button', '›');
  next.type = 'button';
  next.setAttribute('aria-label', 'Следующий месяц');
  next.addEventListener('click', () => {
    month = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    renderPlanner();
  });
  const label = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' })
    .format(month).replace(' г.', '');
  const title = element('button', 'cal-title', label.charAt(0).toUpperCase() + label.slice(1));
  title.type = 'button';
  title.title = 'К сегодняшнему дню';
  title.addEventListener('click', () => {
    selected = startOfDay(new Date());
    month = new Date(selected.getFullYear(), selected.getMonth(), 1);
    renderPlanner();
  });
  nav.append(prev, title, next);
  root.append(nav);

  const grid = element('div', 'cal-grid');
  for (const wd of WEEKDAYS) grid.append(element('span', 'cal-wd', wd));

  const offset = (month.getDay() + 6) % 7; // понедельник — первый
  for (let i = 0; i < offset; i += 1) grid.append(element('span', 'cal-empty'));

  const today = startOfDay(new Date());
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  for (let d = 1; d <= days; d += 1) {
    const day = new Date(month.getFullYear(), month.getMonth(), d);
    const cell = element('button', 'cal-day');
    cell.type = 'button';
    if (sameDay(day, today)) cell.classList.add('is-today');
    if (sameDay(day, selected)) cell.setAttribute('aria-pressed', 'true');
    cell.append(element('span', 'cal-num', String(d)));

    const types = new Set(eventsOn(day).map((e) => e.type));
    const dots = element('span', 'cal-dots');
    const ordered = [...TYPE_ORDER.filter((t) => types.has(t)), ...[...types].filter((t) => !TYPE_ORDER.includes(t))];
    for (const type of ordered.slice(0, 3)) {
      const dot = element('span', 'cal-dot');
      dot.style.background = TYPE_COLORS[type] || TYPE_COLORS.meeting;
      dots.append(dot);
    }
    if (handlers.hasTasks && handlers.hasTasks(day)) dots.append(element('span', 'cal-dot cal-dot--task'));
    cell.append(dots);
    cell.addEventListener('click', () => {
      selected = day;
      renderPlanner();
    });
    grid.append(cell);
  }
  root.append(grid);
}

export function setPlannerHandlers(next) {
  handlers = next || {};
}

export function selectedDay() {
  return selected;
}

let createActions = [];

/** Что можно создать на выбранный день — для кнопки «+». */
export function getCreateActions() {
  return createActions;
}

export function renderPlanner() {
  const root = document.getElementById('planner');
  root.replaceChildren();
  renderCalendar(root);

  // Один день — одна лента: события и задачи вместе, по времени.
  const tasks = handlers.dayTasks ? handlers.dayTasks(selected) : { add: null, items: [], notice: null };
  const dayHead = element('div', 'day-head');
  dayHead.append(element('h2', 'group-title', formatDayTitle(selected)));
  // Создание — через кнопку «+» рядом с доком (main.js берёт действия отсюда).
  createActions = [];
  if (tasks.add) createActions.push({ label: 'Задача', run: () => tasks.add.click() });
  if (handlers.onCreate) {
    const day = selected;
    createActions.push({ label: 'Событие', run: () => handlers.onCreate(day) });
  }
  root.append(dayHead);

  const feed = element('div', 'day-feed');
  const items = [
    ...eventsOn(selected).map((e) => ({ date: e.date, node: eventCard(e) })),
    ...tasks.items,
  ].sort((a, b) => a.date - b.date);
  if (items.length) for (const item of items) feed.append(item.node);
  else if (!tasks.notice) feed.append(element('p', 'empty empty--small', 'В этот день ничего нет'));
  if (tasks.notice) feed.append(tasks.notice);
  root.append(feed);
}

export function resetPlanner() {
  events = [];
  expanded.clear();
  selected = startOfDay(new Date());
  month = new Date(selected.getFullYear(), selected.getMonth(), 1);
  const root = document.getElementById('planner');
  if (root) root.replaceChildren();
}
