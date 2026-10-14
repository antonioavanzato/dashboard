// Рендер из состояния в DOM. Сети здесь нет: действия уходят в обработчики.
import { STATUSES, labelForStatus } from './status.js';
import {
  filterOrders,
  groupByDate,
  countsByStatus,
  subtitleText,
  activeOrders,
  archivedOrders,
  isArchived,
  parseOrderDate,
} from './store.js';

const el = (id) => document.getElementById(id);

export function showAuthScreen() {
  el('auth-screen').hidden = false;
  el('lock-screen').hidden = true;
  el('list-screen').hidden = true;
  el('tabbar').hidden = true;
}

export function showListScreen() {
  el('auth-screen').hidden = true;
  el('lock-screen').hidden = true;
  el('list-screen').hidden = false;
  el('tabbar').hidden = false;
}

export function showLockScreen() {
  el('auth-screen').hidden = true;
  el('lock-screen').hidden = false;
  el('list-screen').hidden = true;
  el('tabbar').hidden = true;
}

export function setAuthError(text) {
  const node = el('auth-error');
  node.textContent = text || '';
  node.hidden = !text;
}

// Индикатор связи с Yandex Cloud: зелёная точка — ответ получен,
// серая — облако недоступно.
export function setConnection(online) {
  const node = el('conn');
  const text = online ? 'Есть связь с облаком' : 'Нет связи с облаком';
  node.dataset.online = String(online);
  node.title = text;
  node.querySelector('.visually-hidden').textContent = text;
}

export function setBanner(text) {
  const node = el('banner');
  node.textContent = text || '';
  node.hidden = !text;
}

// Иконки фильтров — статические SVG, соответствуют SF Symbols из приложения.
const ICONS = {
  all: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  new: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  contacted: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>',
};

function iconNode(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  // Разметка здесь постоянная, пользовательских данных в ней нет.
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

// Кнопка фильтра. Как в приложении: у невыбранной видны иконка и счётчик,
// подпись раскрывается только у активной — поэтому все пять умещаются в строку.
function filterButton({ label, icon, count, isSelected, onClick }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'filter';
  button.setAttribute('aria-pressed', String(isSelected));
  button.setAttribute('aria-label', label);
  button.append(iconNode(icon));

  if (isSelected) {
    const text = document.createElement('span');
    text.className = 'filter-label';
    text.textContent = label;
    button.append(text);
  }

  if (count > 0) {
    const badge = document.createElement('span');
    badge.className = 'filter-count';
    badge.textContent = String(count);
    button.append(badge);
  }

  button.addEventListener('click', onClick);
  return button;
}

// Подпись активного фильтра ужимается по размеру, а не обрезается многоточием.
// Повторяет minimumScaleFactor(0.75) из BookingRequestsScreen.swift.
function fitFilterLabel(label) {
  const BASE = 12;
  const MIN = Math.round(BASE * 0.75); // 9 px
  label.style.fontSize = `${BASE}px`;
  for (let size = BASE; size > MIN && label.scrollWidth > label.clientWidth; size -= 1) {
    label.style.fontSize = `${size - 1}px`;
  }
}

const FILTER_ICONS = { new: 'new', contacted: 'contacted' };

export function renderFilters(all, state, onSelect) {
  const container = el('filters');
  container.replaceChildren();
  const counts = countsByStatus(all);

  container.append(
    filterButton({
      label: 'Все',
      icon: 'all',
      count: activeOrders(all).length,
      isSelected: !state.archive && state.statusId === null,
      onClick: () => onSelect({ archive: false, statusId: null }),
    })
  );

  // В фильтрах только рабочие статусы: завершённые и отказы живут в архиве.
  for (const status of STATUSES) {
    if (status.id === 'completed' || status.id === 'cancelled') continue;
    const isSelected = !state.archive && state.statusId === status.id;
    container.append(
      filterButton({
        label: status.label,
        icon: FILTER_ICONS[status.id],
        count: counts[status.id] || 0,
        isSelected,
        // Повторное нажатие снимает фильтр — как в приложении.
        onClick: () =>
          onSelect({ archive: false, statusId: isSelected ? null : status.id }),
      })
    );
  }

  container.append(
    filterButton({
      label: 'Архив',
      icon: 'archive',
      count: archivedOrders(all).length,
      isSelected: state.archive,
      onClick: () => onSelect({ archive: !state.archive, statusId: null }),
    })
  );

  // Размеры доступны только после вставки в документ.
  const activeLabel = container.querySelector('.filter[aria-pressed="true"] .filter-label');
  if (activeLabel) fitFilterLabel(activeLabel);
}


// ---------------------------------------------------------------------------
// Карточка заявки. Оформление повторяет RequestCard из
// HUB/CreatorHub/Features/Bookings/BookingRequestsScreen.swift.
// ---------------------------------------------------------------------------

const CARD_ICONS = {
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  graduation: '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/>',
  presets: '<rect x="7" y="3" width="14" height="14" rx="2"/><path d="M3 7v12a2 2 0 0 0 2 2h12"/>',
  star: '<path d="m12 3 2.7 5.6 6.3.9-4.5 4.4 1 6.1-5.5-2.9-5.5 2.9 1-6.1L3 9.5l6.3-.9z"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  telegram: '<path d="M21 3 2 10.5l6 2.5L21 3zM8 13v6l3.5-3.5L21 3"/>',
  trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6"/>',
  check: '<path d="m5 13 4 4L19 7"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
};

function svgIcon(name, className) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  // Разметка постоянная, пользовательских данных в ней нет.
  svg.innerHTML = CARD_ICONS[name] || '';
  return svg;
}

// Иконка типа заявки — как typeIcon в SDBookingRequest.
function typeIconName(type) {
  if (type.includes('Съёмка')) return 'camera';
  if (type.includes('Обучение')) return 'graduation';
  if (type.includes('Пресеты')) return 'presets';
  return 'star';
}

const isPresets = (order) => (order.type || '').includes('Пресеты');
const hasValue = (value) => Boolean(value) && value !== '—';

// «9 сен, 14:30» — как formatDate в RequestCard.
function formatCreatedAt(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(date).replace(' г.', '');
}

// «9 сентября, вторник» — как formattedDate в SDBookingRequest.
function formatShootDate(value) {
  const date = parseOrderDate(value);
  if (!date) return hasValue(value) ? value : '';
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

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Круглая кнопка второстепенного действия — iconButton из приложения.
function roundButton(icon, label, onClick, extraClass) {
  const button = element('button', `round-button${extraClass ? ' ' + extraClass : ''}`);
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.append(svgIcon(icon));
  button.addEventListener('click', onClick);
  return button;
}

// Кнопка-пилюля главного действия — pillButton из приложения.
function pillLink(icon, label, href) {
  const link = element('a', 'pill-button pill-button--prominent');
  link.href = href;
  link.rel = 'noopener';
  link.append(svgIcon(icon), element('span', null, label));
  return link;
}

function contactRow(icon, value) {
  const row = element('div', 'contact-row');
  row.append(svgIcon(icon), element('span', null, value));
  return row;
}

// Путь заявки: от новой до завершённой. «Отказ» — выход из пути,
// поэтому стоит отдельной кнопкой. Повторяет FlowStatusPicker.
const FLOW = ['new', 'contacted', 'completed'];

function statusFlow(order, onStatusChange) {
  const wrap = element('div', 'flow');
  const track = element('div', 'flow-track');
  const currentIndex = FLOW.indexOf(order.status);

  FLOW.forEach((statusId, index) => {
    const reached = currentIndex >= index && order.status !== 'cancelled';
    const step = element('button', 'flow-step');
    step.type = 'button';
    step.dataset.reached = String(reached);
    step.dataset.current = String(order.status === statusId);
    step.setAttribute('aria-label', labelForStatus(statusId));

    const mark = element('span', 'flow-mark');
    if (reached) mark.append(svgIcon('check'));
    step.append(mark, element('span', 'flow-caption', labelForStatus(statusId)));
    step.addEventListener('click', () => onStatusChange(order.id, statusId));
    track.append(step);

    if (index < FLOW.length - 1) {
      const line = element('span', 'flow-line');
      line.dataset.reached = String(currentIndex > index && order.status !== 'cancelled');
      track.append(line);
    }
  });

  track.dataset.cancelled = String(order.status === 'cancelled');
  wrap.append(track);

  const cancel = element('button', 'flow-cancel');
  cancel.type = 'button';
  cancel.dataset.active = String(order.status === 'cancelled');
  cancel.textContent = order.status === 'cancelled' ? 'Отказ' : 'Отметить отказ';
  cancel.addEventListener('click', () => onStatusChange(order.id, 'cancelled'));
  wrap.append(cancel);

  return wrap;
}

function card(order, handlers) {
  const archived = isArchived(order);
  const node = element('article', 'card');
  node.dataset.status = order.status;
  node.dataset.archived = String(archived);

  node.append(element('span', 'card-accent'));
  const body = element('div', 'card-body');
  node.append(body);

  // --- Верхняя строка: тип, статус, когда пришла ---
  const top = element('div', 'card-top');
  const type = element('span', 'chip-type');
  type.append(svgIcon(typeIconName(order.type || '')), element('span', null, order.type || 'Заявка'));
  top.append(type);

  const badge = element('span', 'status-badge');
  badge.append(element('span', 'status-dot'), element('span', null, labelForStatus(order.status)));
  top.append(badge);

  const created = formatCreatedAt(order.created_at);
  if (created) top.append(element('span', 'card-created', created));
  body.append(top);

  // --- Имя, место и дата, шеврон ---
  const main = element('div', 'card-main');
  const headline = element('div', 'card-headline');
  headline.append(element('h2', 'card-name', order.name || 'Без имени'));

  const meta = element('p', 'card-meta');
  const place = isPresets(order) ? order.tg : order.city;
  if (hasValue(place)) {
    const part = element('span', 'meta-part');
    part.append(svgIcon(isPresets(order) ? 'telegram' : 'pin'), element('span', null, place));
    meta.append(part);
  }
  const shootDate = formatShootDate(order.date);
  if (shootDate) {
    if (meta.childNodes.length) meta.append(element('span', 'meta-dot', '•'));
    const part = element('span', 'meta-part');
    part.append(svgIcon('calendar'), element('span', null, shootDate));
    meta.append(part);
  }
  if (meta.childNodes.length) headline.append(meta);
  main.append(headline);

  const chevron = element('button', 'chevron');
  chevron.type = 'button';
  chevron.setAttribute('aria-label', 'Подробнее');
  chevron.setAttribute('aria-expanded', 'false');
  chevron.append(svgIcon('chevron'));
  main.append(chevron);
  body.append(main);

  // --- Раскрывающаяся часть ---
  const details = element('div', 'card-details');
  details.hidden = true;

  const contacts = element('div', 'contacts');
  if (!isPresets(order) && hasValue(order.phone)) contacts.append(contactRow('phone', order.phone));
  if (hasValue(order.tg)) contacts.append(contactRow('telegram', order.tg));
  if (contacts.childNodes.length) details.append(contacts);

  if (hasValue(order.msg)) {
    const section = element('div', 'card-section');
    section.append(element('span', 'section-label', 'Сообщение'),
                   element('p', 'card-message', order.msg));
    details.append(section);
  }

  const statusSection = element('div', 'card-section');
  statusSection.append(element('span', 'section-label', 'Статус'),
                       statusFlow(order, handlers.onStatusChange));
  details.append(statusSection);
  body.append(details);

  chevron.addEventListener('click', () => {
    const open = details.hidden;
    details.hidden = !open;
    chevron.setAttribute('aria-expanded', String(open));
    node.dataset.expanded = String(open);
  });

  // --- Действия ---
  const actions = element('div', 'card-actions');
  if (hasValue(order.phone) && !isPresets(order)) {
    actions.append(pillLink('phone', 'Позвонить', `tel:${order.phone.replace(/\s/g, '')}`));
  }
  if (hasValue(order.tg)) {
    const tg = element('a', 'round-button');
    tg.href = telegramHref(order.tg);
    tg.rel = 'noopener';
    tg.title = 'Telegram';
    tg.setAttribute('aria-label', 'Telegram');
    tg.append(svgIcon('telegram'));
    actions.append(tg);
  }
  actions.append(element('span', 'actions-spacer'));
  actions.append(roundButton('trash', 'Удалить', () => handlers.onDelete(order.id), 'round-button--danger'));
  body.append(actions);

  return node;
}

// Какие заявки уже показывались. Анимация въезда — только у новых,
// чтобы список не дёргался при обычной перерисовке.
let shownIds = new Set();

export function resetShownOrders() {
  shownIds = new Set();
}

export function renderList(all, state, handlers) {
  el('subtitle').textContent = subtitleText(all);

  const container = el('list');
  container.replaceChildren();

  const visible = filterOrders(all, state);
  if (visible.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Заявок нет';
    container.append(empty);
    return;
  }

  for (const group of groupByDate(visible, new Date())) {
    const title = document.createElement('h3');
    title.className = 'group-title';
    title.textContent = group.title;
    container.append(title);
    for (const order of group.items) {
      const node = card(order, handlers);
      if (!shownIds.has(order.id)) node.classList.add('card--enter');
      container.append(node);
    }
  }

  shownIds = new Set(visible.map((order) => order.id));
}

// Обновление потягиванием вниз. Кнопки «Обновить» нет: жест заменил её.
// Вместо подписи — круговая стрелка: доворачивается вслед за пальцем,
// раскручивается, пока идёт обновление.
export function enablePullToRefresh(onRefresh) {
  const indicator = el('pull');
  const THRESHOLD = 70;      // сколько нужно протянуть, чтобы обновить
  const MAX_PULL = 110;      // дальше индикатор не растёт
  const SLOP = 8;            // на этом расстоянии решаем, куда ведут палец

  const arrow = svgIcon('refresh');
  indicator.replaceChildren(arrow);
  indicator.setAttribute('role', 'status');

  let startY = null;
  let startX = 0;
  let distance = 0;
  let axis = null;           // null — ещё не решили, 'y' — наш жест, 'x' — чужой
  let refreshing = false;

  const atTop = () => (window.scrollY || document.documentElement.scrollTop) === 0;

  function reset() {
    startY = null;
    distance = 0;
    axis = null;
    indicator.hidden = true;
    indicator.style.height = '';
    indicator.dataset.ready = 'false';
    indicator.dataset.spinning = 'false';
    arrow.style.transform = '';
    arrow.style.opacity = '';
  }

  document.addEventListener('touchstart', (event) => {
    // Лента статусов прокручивается вбок — там жест обновления не нужен.
    if (event.target.closest?.('#filters')) {
      startY = null;
      return;
    }
    if (refreshing || event.touches.length !== 1 || !atTop()) {
      startY = null;
      return;
    }
    startY = event.touches[0].clientY;
    startX = event.touches[0].clientX;
    distance = 0;
    axis = null;
  }, { passive: true });

  document.addEventListener('touchmove', (event) => {
    if (startY === null || axis === 'x') return;

    const dy = event.touches[0].clientY - startY;
    const dx = event.touches[0].clientX - startX;

    // Направление определяем один раз, по первому заметному движению.
    if (axis === null) {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      axis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
      if (axis === 'x') {
        indicator.hidden = true;
        return;
      }
    }

    distance = dy;
    if (distance <= 0) {
      indicator.hidden = true;
      return;
    }
    // Гасим родной отскок страницы, иначе жест конфликтует с прокруткой.
    event.preventDefault();

    const progress = Math.min(distance / THRESHOLD, 1);
    const ready = distance >= THRESHOLD;

    indicator.hidden = false;
    indicator.style.height = `${Math.min(distance, MAX_PULL)}px`;
    indicator.dataset.ready = String(ready);
    indicator.setAttribute('aria-label', ready ? 'Отпустите для обновления' : 'Потяните вниз');
    arrow.style.opacity = String(0.35 + progress * 0.65);
    arrow.style.transform = `rotate(${Math.round(distance * 2.6)}deg)`;
  }, { passive: false });

  document.addEventListener('touchend', async () => {
    if (startY === null) return;
    if (axis !== 'y' || distance < THRESHOLD) {
      reset();
      return;
    }
    refreshing = true;
    startY = null;
    indicator.style.height = `${THRESHOLD}px`;
    indicator.setAttribute('aria-label', 'Обновление');
    // Снимаем ручной поворот, иначе он спорит с анимацией вращения.
    arrow.style.transform = '';
    arrow.style.opacity = '1';
    indicator.dataset.spinning = 'true';
    try {
      await onRefresh();
    } finally {
      refreshing = false;
      reset();
    }
  });
}
