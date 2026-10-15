// Главная дашборда: часы в одну строку и виджеты.
// Виджеты — из реестра WIDGETS ниже; какие показывать и в каком порядке, выбирается
// долгим тапом по любому виджету (или «Виджеты» внизу главной). Выбор хранится на устройстве.
// Мини-виджеты (1×1) встают по три в ряд; нажатие раскрывает выжимку под рядом,
// повторное нажатие открывает раздел. Сеть здесь не трогается: данные приходят из main.js.
import { activeOrders } from './store.js';
import {
  courseSwitch, studentsLoaded, summary, recentStudents, lastSeenText, isOnline, progressBar,
} from './students.js';

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const sameDay = (a, b) => a.getFullYear() === b.getFullYear()
  && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const time = (d) => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(d);
const shortDay = (d) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(d).replace('.', '');
const typeColor = (type) => getComputedStyle(document.documentElement).getPropertyValue(`--type-${type}`) || '#7cf0c5';

// Часы: узлы создаются один раз, дальше меняется только текст.
// Если пересоздавать двоеточие каждую секунду, его анимация мигания
// перезапускается раньше, чем успевает потускнеть.
const clockParts = (() => {
  const hours = el('span');
  const sep = el('span', 'sep', ':');
  const minutes = el('span');
  $('clock').replaceChildren(hours, sep, minutes);
  return { hours, minutes };
})();

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function tick() {
  const d = new Date();
  const h = d.getHours();
  setText(clockParts.hours, pad(h));
  setText(clockParts.minutes, pad(d.getMinutes()));
  setText($('date'), new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' }).format(d));
  setText($('greeting'), h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер');
}

// ---------- Состояние ----------

let data = { orders: [], events: null };
let onPickCourse = () => {};
let navigate = () => {};
let selected = null; // id раскрытого мини-виджета
let readyTimer = null;

export function setHomeNavigate(fn) { navigate = fn; }

// ---------- Строки выжимок ----------

function peekRow(color, when, text) {
  const row = el('div', 'next-row');
  const dot = el('i');
  if (color) row.style.setProperty('--type', color);
  else dot.className = 'is-dim';
  row.append(dot);
  if (when) row.append(el('span', 'mono next-when', when));
  row.append(el('span', 'next-title', text));
  return row;
}

const note = (text) => el('p', 'sub', text);

function eventRows(list, now, withDay) {
  return list.map((e) => peekRow(typeColor(e.type),
    withDay && !sameDay(e.date, now) ? `${shortDay(e.date)} · ${time(e.date)}` : time(e.date), e.task));
}

// ---------- Реестр виджетов ----------
// kind: 'mini' — плитка 1×1 с цифрой и выжимкой; 'wide' — на всю ширину.
// Новый инструмент = новая запись здесь (и в DEFAULT_LAYOUT, если показывать сразу).

const WIDGETS = {
  orders: {
    title: 'Заявки',
    kind: 'mini',
    go: 'orders',
    mini() {
      const active = activeOrders(data.orders);
      const fresh = active.filter((o) => o.status === 'new').length;
      return { num: fresh, sub: `${plural(fresh, 'новая', 'новые', 'новых')} · акт. ${active.length}`, alert: fresh > 0 };
    },
    peek() {
      const active = activeOrders(data.orders);
      const fresh = active.filter((o) => o.status === 'new')
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      const list = (fresh.length ? fresh : active).slice(0, 3);
      if (!list.length) return [note('Активных заявок нет')];
      return [
        ...list.map((o) => peekRow(o.status === 'new' ? 'rgb(224, 90, 80)' : null, o.date || '',
          [o.name || 'Без имени', o.type].filter(Boolean).join(' · '))),
        note(fresh.length ? `Новых: ${fresh.length}` : 'Новых нет — показаны активные'),
      ];
    },
  },
  today: {
    title: 'Сегодня',
    kind: 'mini',
    go: 'planner',
    mini() {
      if (!data.events) return { num: '—', sub: 'загрузка…' };
      const n = data.events.filter((e) => sameDay(e.date, new Date())).length;
      return { num: n, sub: plural(n, 'событие', 'события', 'событий') };
    },
    peek() {
      if (!data.events) return [note('Загрузка…')];
      const now = new Date();
      const today = data.events.filter((e) => sameDay(e.date, now));
      return today.length ? eventRows(today, now, false) : [note('Сегодня свободно')];
    },
  },
  students: {
    title: 'Ученики',
    kind: 'mini',
    go: 'students',
    mini() {
      if (!studentsLoaded()) return { num: '—', sub: 'загрузка…' };
      const s = summary();
      return { num: s.active, sub: `онлайн ${s.online} · ${s.avg}%`, live: s.online > 0 };
    },
    peek() {
      const nodes = [courseSwitch(onPickCourse, 'tabs st-switch')];
      if (!studentsLoaded()) return [...nodes, note('Загрузка…')];
      const recent = recentStudents();
      if (!recent.length) return [...nodes, note('Пока никто не заходил')];
      for (const st of recent) {
        const row = el('div', 'next-row st-row');
        const dot = el('span', 'st-dot');
        dot.dataset.online = String(isOnline(st));
        row.append(dot, el('span', 'next-title', st.name || st.id), progressBar(st.progress),
          el('span', 'mono next-when', lastSeenText(st)));
        nodes.push(row);
      }
      return nodes;
    },
  },
  next: {
    title: 'Ближайшее',
    kind: 'wide',
    go: 'planner',
    body() {
      if (!data.events) return [note('Загрузка…')];
      const now = new Date();
      const upcoming = data.events.filter((e) => e.date >= now && e.status !== 'cancelled').slice(0, 3);
      return upcoming.length ? eventRows(upcoming, now, true) : [note('Впереди пусто')];
    },
  },
  year: {
    title: 'Год — полоска',
    kind: 'wide',
    body() {
      const { y, day, days, pct } = yearInfo();
      const head = el('div', 'row w-year-head');
      head.append(el('span', 'label', `Год ${y}`), el('span', 'mono sub', `${day + 1} / ${days} · ${pct}%`));
      const bar = el('div', 'w-year-bar');
      const fill = el('i');
      fill.style.width = `${pct}%`;
      bar.append(fill);
      return [head, bar];
    },
  },
  yearDots: {
    title: 'Год — точками',
    kind: 'wide',
    body() {
      const { y, day, days, pct } = yearInfo();
      const head = el('div', 'row');
      head.append(el('span', 'label', `Год ${y}`), el('span', 'mono sub', `${day + 1} / ${days} · ${pct}%`));
      const dots = el('div', 'dots');
      for (let i = 0; i < days; i += 1) dots.append(el('i', i < day ? 'past' : i === day ? 'now' : ''));
      return [head, dots];
    },
  },
};

function yearInfo() {
  const d = new Date();
  const y = d.getFullYear();
  const start = new Date(y, 0, 1);
  const days = Math.round((new Date(y + 1, 0, 1) - start) / 864e5);
  const day = Math.floor((d - start) / 864e5);
  return { y, day, days, pct: Math.round(((day + 1) / days) * 100) };
}

// ---------- Выбор виджетов (на устройстве) ----------

const LAYOUT_KEY = 'hub.home.widgets';
const DEFAULT_LAYOUT = [
  { id: 'orders', on: true },
  { id: 'today', on: true },
  { id: 'students', on: true },
  { id: 'next', on: true },
  { id: 'year', on: true },
  { id: 'yearDots', on: false },
];

function loadLayout() {
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '[]');
  } catch {
    saved = [];
  }
  if (!Array.isArray(saved)) saved = [];
  const list = saved.filter((w) => w && WIDGETS[w.id]).map((w) => ({ id: w.id, on: Boolean(w.on) }));
  // Виджеты, которых не было в сохранённом выборе (новые), дописываются в конец.
  for (const def of DEFAULT_LAYOUT) {
    if (!list.some((w) => w.id === def.id)) list.push({ ...def });
  }
  return list;
}

let layout = loadLayout();

function saveLayout() {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // не страшно: выбор просто не запомнится
  }
}

// ---------- Отрисовка ----------

function attachLongPress(node, onLong) {
  let timer = null;
  let start = [0, 0];
  let fired = false;
  const cancel = () => { clearTimeout(timer); timer = null; };
  node.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    fired = false;
    start = [e.clientX, e.clientY];
    timer = setTimeout(() => {
      fired = true;
      if (navigator.vibrate) navigator.vibrate(10);
      onLong();
    }, 550);
  });
  node.addEventListener('pointermove', (e) => {
    if (timer && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 10) cancel();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => node.addEventListener(t, cancel));
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!fired) onLong();
  });
  // Возвращает «был ли долгий тап» и сбрасывает флаг — чтобы клик после него не срабатывал.
  return () => { const was = fired; fired = false; return was; };
}

function miniTile(id) {
  const w = WIDGETS[id];
  const m = w.mini();
  const tile = el('button', 'tile w-mini');
  tile.type = 'button';
  tile.setAttribute('aria-pressed', String(selected === id));
  if (m.alert) tile.dataset.alert = 'true';
  if (m.live) tile.dataset.live = 'true';
  tile.append(el('span', 'label', w.title), el('b', 'big mono', String(m.num)), el('span', 'sub', m.sub));
  const wasLong = attachLongPress(tile, openWidgetEditor);
  tile.addEventListener('click', () => {
    if (wasLong()) return;
    if (selected === id) {
      navigate(w.go);
      return;
    }
    selected = id;
    render();
  });
  return tile;
}

function wideTile(id) {
  const w = WIDGETS[id];
  const tile = el('article', 'tile wide w-wide');
  if (id === 'next') {
    const head = el('div', 'row');
    head.append(el('span', 'label', w.title), el('span', 'sub', 'планер'));
    const list = el('div', 'next');
    list.append(...w.body());
    tile.append(head, list);
  } else {
    tile.append(...w.body());
  }
  if (w.go) tile.dataset.go = w.go;
  const wasLong = attachLongPress(tile, openWidgetEditor);
  tile.addEventListener('click', () => {
    if (wasLong()) return;
    if (w.go) navigate(w.go);
  });
  return tile;
}

function peekPanel(id) {
  const panel = el('div', 'tile wide w-peek');
  const head = el('div', 'row');
  const open = el('button', 'w-open', 'Открыть ›');
  open.type = 'button';
  open.addEventListener('click', () => navigate(WIDGETS[id].go));
  head.append(el('span', 'label', WIDGETS[id].title), open);
  const body = el('div', 'next');
  body.append(...WIDGETS[id].peek());
  panel.append(head, body);
  return panel;
}

function render() {
  const root = $('homeWidgets');
  if (!root) return;
  const visible = layout.filter((w) => w.on).map((w) => w.id);
  if (selected && !visible.includes(selected)) selected = null;

  root.replaceChildren();
  let grid = null;
  let gridHasSelected = false;
  const flushGrid = () => {
    if (!grid) return;
    root.append(grid);
    if (gridHasSelected) root.append(peekPanel(selected));
    grid = null;
    gridHasSelected = false;
  };
  for (const id of visible) {
    if (WIDGETS[id].kind === 'mini') {
      if (!grid) grid = el('div', 'w-grid');
      grid.append(miniTile(id));
      if (id === selected) gridHasSelected = true;
    } else {
      flushGrid();
      root.append(wideTile(id));
    }
  }
  flushGrid();
  // Анимация появления — только при первом показе главной. Дальше (нажатие на виджет,
  // новые данные при опросе) плитки перерисовываются без «выезда» и размытия.
  // Отметка ставится, когда главная реально видна и анимация (до ~0.9 с) доиграла.
  if (!root.dataset.ready && !readyTimer && root.offsetParent !== null) {
    readyTimer = setTimeout(() => { root.dataset.ready = 'true'; }, 900);
  }

  const edit = el('button', 'w-edit', 'Виджеты');
  edit.type = 'button';
  edit.addEventListener('click', openWidgetEditor);
  root.append(edit);
}

export function renderHome({ orders, events }) {
  data = { orders, events };
  render();
}

export function renderStudentsTile(pick) {
  onPickCourse = pick;
  render();
}

// ---------- Окно «Виджеты главной» ----------

function openWidgetEditor() {
  if (document.querySelector('.w-editor')) return;
  const overlay = el('div', 'ed-overlay w-editor');
  const sheet = el('div', 'ed-sheet');
  sheet.append(el('h2', 'ed-title', 'Виджеты главной'),
    el('p', 'st-menu-sub', 'Включайте и переставляйте. Мини-виджеты встают по три в ряд.'));
  const list = el('div', 'st-menu');
  const apply = () => { saveLayout(); draw(); render(); };
  function draw() {
    list.replaceChildren();
    layout.forEach((w, i) => {
      const row = el('div', 'w-ed-row');
      const toggle = el('button', 'w-ed-toggle');
      toggle.type = 'button';
      toggle.setAttribute('aria-pressed', String(w.on));
      toggle.setAttribute('aria-label', w.on ? 'Скрыть' : 'Показать');
      toggle.addEventListener('click', () => { w.on = !w.on; apply(); });
      const name = el('span', 'w-ed-name', WIDGETS[w.id].title);
      name.append(el('span', 'sub', WIDGETS[w.id].kind === 'mini' ? ' · мини' : ' · широкий'));
      const up = el('button', 'w-ed-move', '↑');
      up.type = 'button';
      up.setAttribute('aria-label', 'Выше');
      up.disabled = i === 0;
      up.addEventListener('click', () => { [layout[i - 1], layout[i]] = [layout[i], layout[i - 1]]; apply(); });
      const down = el('button', 'w-ed-move', '↓');
      down.type = 'button';
      down.setAttribute('aria-label', 'Ниже');
      down.disabled = i === layout.length - 1;
      down.addEventListener('click', () => { [layout[i + 1], layout[i]] = [layout[i], layout[i + 1]]; apply(); });
      row.append(toggle, name, up, down);
      list.append(row);
    });
  }
  const actions = el('div', 'ed-actions');
  const reset = el('button', 'button', 'Как было');
  reset.type = 'button';
  reset.addEventListener('click', () => { layout = DEFAULT_LAYOUT.map((w) => ({ ...w })); apply(); });
  const done = el('button', 'button button--primary', 'Готово');
  done.type = 'button';
  const close = () => { overlay.remove(); document.body.classList.remove('ed-open'); };
  done.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  actions.append(reset, done);
  draw();
  sheet.append(list, actions);
  overlay.append(sheet);
  document.body.classList.add('ed-open');
  document.body.append(overlay);
}

// ---------- Док и подсветка ----------

// Подсветка в доке «перетекает» к активной кнопке.
function moveGlow() {
  const dock = $('tabbar');
  const glow = dock.querySelector('.dock-glow');
  const active = dock.querySelector('.tabbar-btn[aria-pressed="true"]');
  if (!active || dock.hidden) return;
  const vertical = matchMedia('(min-width: 900px)').matches;
  glow.style.transform = vertical
    ? `translateY(${active.offsetTop - 6}px)`
    : `translateX(${active.offsetLeft - 6}px)`;
}

new MutationObserver(moveGlow).observe($('tabbar'), { subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'hidden'] });
addEventListener('resize', moveGlow);

tick();
setInterval(tick, 1000);
render();
// Первая установка подсветки — без анимации, чтобы она не «прилетала» при запуске.
requestAnimationFrame(() => {
  const glow = $('tabbar').querySelector('.dock-glow');
  glow.style.transition = 'none';
  moveGlow();
  requestAnimationFrame(() => { glow.style.transition = ''; });
});
