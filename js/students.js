// Ученики курсов. Список — тот же GET ?r=students&course=…, что CourseCloudClient.fetchStudents.
// Управление — долгий тап по ученику (как контекстное меню в приложении), окна в student-actions.js.
// Разбор прогресса повторяет CourseCloudClient.makeStudent / parseProgress.
// Данные живут только в памяти вкладки.
import { openStudentMenu } from './student-actions.js';

export const COURSES = [
  { id: 'avanzato', label: 'Модульное', title: 'Модульное обучение', totalLessons: 13 },
  { id: 'davinci', label: 'DaVinci', title: 'DaVinci Resolve', totalLessons: 11 },
];

const ADMIN = 'antonioavanzato@gmail.com';
const ONLINE_MS = 180 * 1000; // как CourseStudent.isOnline

const data = { avanzato: null, davinci: null }; // null — ещё не загружено
let course = 'avanzato';
let expanded = null;
let handlers = null; // { setActive, setDavinci, remove, resetPassword, saveNotes } из main.js

export function setStudentHandlers(h) { handlers = h; }
export const isAdminEmail = (email) => email === ADMIN;
export const studentExists = (email, id = course) => (data[id] || []).some((s) => s.id === email);
export const courseTitle = (id = course) => COURSES.find((c) => c.id === id).title;

export const currentCourse = () => course;
export function setCourse(id) { course = id; expanded = null; }
export const studentsLoaded = (id = course) => data[id] !== null;
export function resetStudents() { data.avanzato = null; data.davinci = null; expanded = null; }

function parseDate(value) {
  if (typeof value !== 'string' || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function progressObject(row) {
  if (row.progress && typeof row.progress === 'object') return row.progress;
  if (typeof row.progress === 'string') {
    try { return JSON.parse(row.progress) || {}; } catch { return {}; }
  }
  return {};
}

function normalize(row, totalLessons) {
  const p = progressObject(row);
  const modules = (Array.isArray(p.modules) ? p.modules : []).map((m) => Boolean(m && m.completed));
  const checkboxes = Array.isArray(p.checkboxes) ? p.checkboxes : [];
  const fromChecks = checkboxes.filter((c) => c === true).length;
  const fromModules = modules.filter(Boolean).length;
  const completed = Math.min(Math.max(fromChecks, fromModules), totalLessons);
  const byLessons = totalLessons > 0 ? completed / totalLessons : 0;
  const byModules = modules.length ? fromModules / modules.length : 0;
  const davinciChecks = checkboxes.length >= 24 ? checkboxes.slice(20, 24).filter((c) => c === true).length : 0;
  return {
    id: String(row.email || '').toLowerCase(),
    name: row.name || '',
    active: row.active !== false,
    createdAt: parseDate(row.createdAt),
    lastSeen: parseDate(row.lastSeen),
    currentModule: typeof row.currentModule === 'number' ? row.currentModule : null,
    notes: row.notes || '',
    davinciModule: row.davinciModule === true,
    davinciChecks,
    modules,
    completed,
    total: totalLessons,
    progress: modules.length ? Math.max(byModules, byLessons) : byLessons,
  };
}

// Сортировка как в приложении: админ первым, дальше — новые сверху.
export function setStudents(courseId, rows) {
  const info = COURSES.find((c) => c.id === courseId);
  const list = rows.map((r) => normalize(r, info.totalLessons));
  list.sort((a, b) => {
    if (a.id === ADMIN) return -1;
    if (b.id === ADMIN) return 1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
  data[courseId] = list;
}

const isOnline = (s, now = Date.now()) => Boolean(s.lastSeen) && Math.abs(now - s.lastSeen) < ONLINE_MS;
const pupils = (id) => (data[id] || []).filter((s) => s.id !== ADMIN);

export function summary(id = course) {
  const list = pupils(id);
  const active = list.filter((s) => s.active);
  return {
    total: list.length,
    active: active.length,
    online: list.filter((s) => isOnline(s)).length,
    avg: active.length ? Math.round((active.reduce((sum, s) => sum + s.progress, 0) / active.length) * 100) : 0,
    finished: active.filter((s) => s.progress >= 1).length,
  };
}

// Последние заходившие — для плитки на главной.
export function recentStudents(id = course, limit = 3) {
  return pupils(id)
    .filter((s) => s.lastSeen)
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, limit);
}

const rtf = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' });
export function lastSeenText(s) {
  if (!s.lastSeen) return 'не заходил';
  if (isOnline(s)) return 'онлайн';
  let v = Math.round((s.lastSeen - Date.now()) / 1000);
  const steps = [[60, 'second'], [60, 'minute'], [24, 'hour'], [30, 'day'], [12, 'month'], [Infinity, 'year']];
  for (const [size, unit] of steps) {
    if (Math.abs(v) < size) return rtf.format(v, unit);
    v = Math.round(v / size);
  }
  return '';
}
export { isOnline };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function progressBar(value) {
  const bar = el('span', 'st-bar');
  const fill = el('i');
  fill.style.width = `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
  bar.append(fill);
  return bar;
}

export function courseSwitch(onPick, className = 'tabs') {
  const nav = el('nav', className);
  for (const c of COURSES) {
    const b = el('button', 'tab', c.label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(c.id === course));
    b.addEventListener('click', (e) => { e.stopPropagation(); onPick(c.id); });
    nav.append(b);
  }
  return nav;
}

const fmtDate = (d) => (d ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(d) : '—');

function detailRow(label, value) {
  const row = el('div', 'ev-row');
  row.append(el('span', 'ev-row-label', label), el('span', 'ev-row-value', value));
  return row;
}

function studentCard(s, rerender) {
  const card = el('article', 'ev-card st-card');
  if (!s.active) card.classList.add('is-inactive');
  const head = el('button', 'ev-head st-head');
  head.type = 'button';
  head.setAttribute('aria-expanded', String(expanded === s.id));

  const dot = el('span', 'st-dot');
  dot.dataset.online = String(isOnline(s));
  const text = el('span', 'ev-text');
  text.append(el('span', 'ev-title', s.name || s.id));
  const meta = [lastSeenText(s)];
  if (!s.active) meta.push('доступ закрыт');
  if (s.id === ADMIN) meta.push('админ');
  text.append(el('span', 'ev-meta', meta.join(' · ')));
  const right = el('span', 'st-right');
  right.append(el('span', 'mono st-count', `${s.completed}/${s.total}`), progressBar(s.progress));
  head.append(dot, text, right);
  // Долгий тап (iPhone) или правый клик (Mac) — меню действий, обычный тап — подробности.
  let pressTimer = null;
  let longPressed = false;
  let startPoint = null;
  const openMenu = () => {
    if (!handlers) return;
    openStudentMenu({ student: s, course, courseTitle: courseTitle(), isAdmin: s.id === ADMIN, handlers });
  };
  const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; card.classList.remove('is-pressing'); };
  head.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    longPressed = false;
    startPoint = [e.clientX, e.clientY];
    card.classList.add('is-pressing');
    pressTimer = setTimeout(() => {
      longPressed = true;
      cancelPress();
      if (navigator.vibrate) navigator.vibrate(10);
      openMenu();
    }, 500);
  });
  head.addEventListener('pointermove', (e) => {
    if (pressTimer && startPoint && Math.hypot(e.clientX - startPoint[0], e.clientY - startPoint[1]) > 10) cancelPress();
  });
  head.addEventListener('pointerup', cancelPress);
  head.addEventListener('pointercancel', cancelPress);
  head.addEventListener('pointerleave', cancelPress);
  head.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (longPressed) return;
    cancelPress();
    openMenu();
  });
  head.addEventListener('click', () => {
    if (longPressed) { longPressed = false; return; }
    expanded = expanded === s.id ? null : s.id;
    rerender();
  });
  card.append(head);

  if (expanded === s.id) {
    const body = el('div', 'ev-body');
    body.append(detailRow('Email', s.id));
    body.append(detailRow('Прогресс', `${Math.round(s.progress * 100)}% · уроков ${s.completed} из ${s.total}`));
    if (s.modules.length) {
      const mods = el('span', 'st-mods');
      s.modules.forEach((done, i) => {
        const m = el('i', done ? 'done' : '');
        m.title = `Модуль ${i + 1}${done ? ' — пройден' : ''}`;
        mods.append(m);
      });
      const row = el('div', 'ev-row');
      row.append(el('span', 'ev-row-label', 'Модули'), mods);
      body.append(row);
    }
    if (s.currentModule !== null) body.append(detailRow('Сейчас', `модуль ${s.currentModule + 1}`));
    if (course === 'avanzato') {
      body.append(detailRow('DaVinci', s.davinciModule ? `открыт · ${s.davinciChecks}/4` : 'не открыт'));
    }
    body.append(detailRow('Доступ', s.active ? 'открыт' : 'закрыт'));
    body.append(detailRow('Добавлен', fmtDate(s.createdAt)));
    if (s.notes) body.append(el('p', 'ev-notes', s.notes));
    card.append(body);
  }
  return card;
}

// Экран «Ученики»: переключатель курса, сводка, список. Без единой кнопки записи.
export function renderStudents(root, onPickCourse) {
  const rerender = () => renderStudents(root, onPickCourse);
  root.replaceChildren(courseSwitch(onPickCourse));
  if (!studentsLoaded()) {
    root.append(el('p', 'empty', 'Загрузка…'));
    return;
  }
  const list = data[course];
  if (!list.length) {
    root.append(el('p', 'empty', 'Учеников пока нет'));
    return;
  }
  const s = summary();
  const stats = el('div', 'st-stats');
  for (const [num, label] of [[s.active, 'активных'], [s.online, 'онлайн'], [`${s.avg}%`, 'средний прогресс'], [s.finished, 'прошли курс']]) {
    const box = el('div', 'st-stat');
    box.append(el('b', 'mono', String(num)), el('span', 'sub', label));
    stats.append(box);
  }
  root.append(stats);
  const wrap = el('div', 'st-list');
  for (const st of list) wrap.append(studentCard(st, rerender));
  root.append(wrap);
}

export function studentsSubtitle() {
  const info = COURSES.find((c) => c.id === course);
  if (!studentsLoaded()) return 'Загрузка…';
  return `${info.title} · ${summary().active} активных`;
}
