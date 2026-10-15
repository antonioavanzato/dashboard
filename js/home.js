// Главная дашборда: часы, сводка по заявкам и планеру, год точками.
// Сеть здесь не трогается: данные приходят из main.js.
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

function tick() {
  const d = new Date();
  const h = d.getHours();
  $('clock').innerHTML = `${pad(h)}<span class="sep">:</span>${pad(d.getMinutes())}`;
  $('date').textContent = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
  $('greeting').textContent = h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
}

function renderYear() {
  const d = new Date();
  const y = d.getFullYear();
  const start = new Date(y, 0, 1);
  const days = Math.round((new Date(y + 1, 0, 1) - start) / 864e5);
  const day = Math.floor((d - start) / 864e5);
  $('yearNum').textContent = y;
  $('yearPct').textContent = `${day + 1} / ${days} · ${Math.round(((day + 1) / days) * 100)}%`;
  const dots = $('yearDots');
  dots.replaceChildren();
  for (let i = 0; i < days; i += 1) {
    const dot = document.createElement('i');
    if (i < day) dot.className = 'past';
    else if (i === day) dot.className = 'now';
    dots.append(dot);
  }
}

const time = (d) => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(d);
const shortDay = (d) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(d).replace('.', '');

export function renderHome({ orders, events }) {
  const active = activeOrders(orders);
  const fresh = active.filter((o) => o.status === 'new').length;
  $('homeNew').textContent = String(fresh);
  $('homeOrders').textContent = `${plural(fresh, 'новая', 'новые', 'новых')} · активных ${active.length}`;

  const next = $('homeNext');
  next.replaceChildren();
  if (!events) {
    $('homeToday').textContent = '—';
    $('homeTodaySub').textContent = 'загрузка…';
    next.append(Object.assign(document.createElement('p'), { className: 'sub', textContent: 'Загрузка…' }));
    return;
  }
  const now = new Date();
  const today = events.filter((e) => sameDay(e.date, now));
  $('homeToday').textContent = String(today.length);
  $('homeTodaySub').textContent = plural(today.length, 'событие', 'события', 'событий');

  const upcoming = events.filter((e) => e.date >= now && e.status !== 'cancelled').slice(0, 3);
  if (!upcoming.length) {
    next.append(Object.assign(document.createElement('p'), { className: 'sub', textContent: 'Впереди пусто' }));
    return;
  }
  for (const e of upcoming) {
    const row = document.createElement('div');
    row.className = 'next-row';
    row.style.setProperty('--type', getComputedStyle(document.documentElement).getPropertyValue(`--type-${e.type}`) || '#7cf0c5');
    const when = document.createElement('span');
    when.className = 'mono next-when';
    when.textContent = sameDay(e.date, now) ? time(e.date) : `${shortDay(e.date)} · ${time(e.date)}`;
    const title = document.createElement('span');
    title.className = 'next-title';
    title.textContent = e.task;
    row.append(document.createElement('i'), when, title);
    next.append(row);
  }
}

// Плитка «Ученики»: переключатель курса прямо на плитке, главная цифра —
// активные ученики, ниже последние заходившие с прогрессом. Нажатие на плитку — в раздел.
export function renderStudentsTile(onPickCourse) {
  $('homeStudentsSwitch').replaceChildren(courseSwitch(onPickCourse, 'tabs st-switch'));
  const list = $('homeStudentsList');
  list.replaceChildren();
  if (!studentsLoaded()) {
    $('homeStudentsNum').textContent = '—';
    $('homeStudentsSub').textContent = 'загрузка…';
    return;
  }
  const s = summary();
  $('homeStudentsNum').textContent = String(s.active);
  $('homeStudentsSub').textContent = `${plural(s.active, 'активный', 'активных', 'активных')}`
    + ` · онлайн ${s.online} · прогресс ${s.avg}%`;
  const recent = recentStudents();
  if (!recent.length) {
    list.append(Object.assign(document.createElement('p'), { className: 'sub', textContent: 'Пока никто не заходил' }));
    return;
  }
  for (const st of recent) {
    const row = document.createElement('div');
    row.className = 'next-row st-row';
    const dot = document.createElement('span');
    dot.className = 'st-dot';
    dot.dataset.online = String(isOnline(st));
    const title = document.createElement('span');
    title.className = 'next-title';
    title.textContent = st.name || st.id;
    const when = document.createElement('span');
    when.className = 'mono next-when';
    when.textContent = lastSeenText(st);
    row.append(dot, title, progressBar(st.progress), when);
    list.append(row);
  }
}

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

// Подсветка карточек под курсором (Mac).
addEventListener('pointermove', (e) => {
  const tile = e.target.closest?.('.tile');
  if (!tile) return;
  const r = tile.getBoundingClientRect();
  tile.style.setProperty('--mx', `${e.clientX - r.left}px`);
  tile.style.setProperty('--my', `${e.clientY - r.top}px`);
});

tick();
setInterval(tick, 1000);
renderYear();
// Первая установка подсветки — без анимации, чтобы она не «прилетала» при запуске.
requestAnimationFrame(() => {
  const glow = $('tabbar').querySelector('.dock-glow');
  glow.style.transition = 'none';
  moveGlow();
  requestAnimationFrame(() => { glow.style.transition = ''; });
});
