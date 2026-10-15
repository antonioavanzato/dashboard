// Ученики курсов — один в один с приложением:
//   список   — CourseManagementView.swift (сводка, «Давно не заходили», поиск, фильтры, сортировка,
//              карточки, долгий тап = контекстное меню);
//   карточка — StudentProgressDetailView.swift (прогресс, DaVinci, действия, модули, сведения, заметки, удаление).
// Данные — тот же GET ?r=students&course=…, что CourseCloudClient.fetchStudents; разбор — как makeStudent.
// Окна и меню — student-actions.js. Данные живут только в памяти вкладки.
import {
  openStudentMenu, openNotesEditor, confirmResetPassword, confirmBlock, confirmDelete, toast, copyText,
} from './student-actions.js';

export const COURSES = [
  { id: 'avanzato', label: 'Модульное', title: 'Модульное обучение', totalLessons: 13 },
  { id: 'davinci', label: 'DaVinci', title: 'DaVinci Resolve', totalLessons: 11 },
];

const ADMIN = 'antonioavanzato@gmail.com';
const ONLINE_MS = 180 * 1000; // как CourseStudent.isOnline

// Названия модулей курса avanzato — как CourseStyle.avanzatoModules (modules[0…8]).
const AVANZATO_MODULES = [
  'Отбор и сортировка', 'Логика обработки', 'Проявка RAW', 'Базовый цвет', 'Маски',
  'Ретушь Photoshop', 'Пластика', 'Финальный стиль', 'Бонусные модули',
];

// Фильтры и сортировки — StudentFilter / StudentSort.
const FILTERS = [['all', 'Все'], ['online', 'Онлайн'], ['active', 'Активные'], ['blocked', 'Заблок.']];
const SORTS = [['recent', 'Недавно заходили'], ['progress', 'По прогрессу'], ['newest', 'Новые сначала'], ['name', 'По имени']];

const data = { avanzato: null, davinci: null }; // null — ещё не загружено
let course = 'avanzato';
let openedId = null;      // открытая карточка ученика
let searchText = '';
let activeFilter = 'all';
let sortMode = 'recent';
let handlers = null;      // { setActive, setDavinci, remove, resetPassword, saveNotes, add } из main.js
let rootNode = null;
let readyTimer = null;
let pickCourse = () => {};

export function setStudentHandlers(h) { handlers = h; }
export const isAdminEmail = (email) => email === ADMIN;
export const studentExists = (email, id = course) => (data[id] || []).some((s) => s.id === email);
export const courseTitle = (id = course) => COURSES.find((c) => c.id === id).title;

export const currentCourse = () => course;
// Смена курса сбрасывает поиск и фильтр — как onChange(of: selectedCourse) в приложении.
export function setCourse(id) { course = id; openedId = null; searchText = ''; activeFilter = 'all'; }
export const studentsLoaded = (id = course) => data[id] !== null;
export function resetStudents() { data.avanzato = null; data.davinci = null; openedId = null; }

// ---------- Разбор ----------

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
  const full = checkboxes.length >= 24;
  return {
    id: String(row.email || '').toLowerCase(),
    // null — имени нет вовсе, '' — пустое (как String? в приложении: важно для сортировки «По имени»).
    name: typeof row.name === 'string' ? row.name : null,
    active: row.active !== false,
    createdAt: parseDate(row.createdAt) || new Date(),
    lastSeen: parseDate(row.lastSeen),
    currentModule: typeof row.currentModule === 'number' ? row.currentModule : null,
    notes: row.notes || '',
    davinciModule: row.davinciModule === true,
    davinciChecksDone: full ? checkboxes.slice(20, 24).filter((c) => c === true).length : 0,
    davinciChecksTotal: 4,
    modules,
    completed,
    total: totalLessons,
    progress: modules.length ? Math.max(byModules, byLessons) : byLessons,
  };
}

export function setStudents(courseId, rows) {
  const info = COURSES.find((c) => c.id === courseId);
  data[courseId] = rows.map((r) => normalize(r, info.totalLessons));
}

// ---------- Вычисления (как в CourseManagementView) ----------

export const isOnline = (s, now = Date.now()) => Boolean(s.lastSeen) && Math.abs(now - s.lastSeen) < ONLINE_MS;
const all = (id = course) => data[id] || [];
const pupils = (id = course) => all(id).filter((s) => s.id !== ADMIN); // studentsOnly

export function summary(id = course) {
  const list = pupils(id);
  return {
    total: list.length,
    active: list.filter((s) => s.active).length,
    online: list.filter((s) => isOnline(s)).length,
    // averageProgress / completedCount — по всем ученикам без автора, как в приложении.
    avg: list.length ? Math.floor((list.reduce((sum, s) => sum + s.progress, 0) / list.length) * 100) : 0,
    finished: list.filter((s) => s.progress >= 1).length,
  };
}

// Давно не заходили: доступ открыт, курс не пройден, не заходил 7+ дней или ни разу.
function needsAttention() {
  const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
  return pupils().filter((s) => s.active && s.progress < 1 && (!s.lastSeen || s.lastSeen < cutoff));
}

function countFor(filter) {
  const list = all();
  if (filter === 'online') return list.filter((s) => isOnline(s)).length;
  if (filter === 'active') return list.filter((s) => s.active).length;
  if (filter === 'blocked') return list.filter((s) => !s.active).length;
  return list.length;
}

function filteredStudents() {
  const q = searchText.trim().toLowerCase();
  const list = all().filter((s) => {
    const matchesSearch = !q || s.id.includes(q) || (s.name || '').toLowerCase().includes(q);
    const matchesFilter = activeFilter === 'online' ? isOnline(s)
      : activeFilter === 'active' ? s.active
        : activeFilter === 'blocked' ? !s.active : true;
    return matchesSearch && matchesFilter;
  });
  return list.sort((a, b) => {
    // Аккаунт автора всегда сверху.
    if (a.id === ADMIN) return -1;
    if (b.id === ADMIN) return 1;
    if (sortMode === 'progress') return b.progress - a.progress;
    if (sortMode === 'newest') return b.createdAt - a.createdAt;
    if (sortMode === 'name') return (a.name ?? a.id).localeCompare(b.name ?? b.id, 'ru', { sensitivity: 'base' });
    return (b.lastSeen || 0) - (a.lastSeen || 0);
  });
}

// Последние заходившие — для виджета на главной.
export function recentStudents(id = course, limit = 3) {
  return pupils(id).filter((s) => s.lastSeen).sort((a, b) => b.lastSeen - a.lastSeen).slice(0, limit);
}

const moduleTitle = (i) => (course === 'avanzato' && AVANZATO_MODULES[i] ? AVANZATO_MODULES[i] : `Модуль ${i}`);
const moduleNumber = (i) => (course === 'avanzato' && i === 8 ? '★' : String(i).padStart(2, '0'));
const displayName = (s) => s.name || 'Без имени';

function plural(n, one, few, many) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

// formattedLastSeen: «Никогда» или относительное время, как RelativeDateTimeFormatter (.full).
const rtf = new Intl.RelativeTimeFormat('ru', { numeric: 'always' });
export function lastSeenText(s) {
  if (!s.lastSeen) return 'Никогда';
  let v = Math.round((s.lastSeen - Date.now()) / 1000);
  const steps = [[60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month'], [Infinity, 'year']];
  for (const [size, unit] of steps) {
    if (Math.abs(v) < size) return rtf.format(v, unit);
    v = Math.round(v / size);
  }
  return '';
}

// ---------- Мелкие элементы ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, className) {
  const b = el('button', className, text);
  b.type = 'button';
  return b;
}

export function progressBar(value) {
  const bar = el('span', 'st-bar');
  const fill = el('i');
  fill.style.width = `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
  bar.append(fill);
  return bar;
}

// Кольцо прогресса (ProgressRing): SVG, без свечений.
function ring(value, size, label, caption) {
  const wrap = el('span', 'st-ring');
  wrap.style.setProperty('--size', `${size}px`);
  const r = 15.9;
  const pct = Math.min(1, Math.max(0, value)) * 100;
  wrap.innerHTML = `<svg viewBox="0 0 36 36" aria-hidden="true"><circle class="bg" cx="18" cy="18" r="${r}"/>`
    + (pct > 0 ? `<circle class="fg" cx="18" cy="18" r="${r}" stroke-dasharray="${pct.toFixed(1)} 100"/>` : '') + '</svg>';
  const text = el('span', 'st-ring-text');
  text.append(el('b', 'mono', label ?? `${Math.round(pct)}%`));
  if (caption) text.append(el('small', null, caption));
  wrap.append(text);
  wrap.setAttribute('aria-label', `Прогресс ${Math.round(pct)} процентов`);
  return wrap;
}

function seal(size) {
  const node = el('span', 'st-seal', '✓');
  node.style.setProperty('--size', `${size}px`);
  return node;
}

function avatar(s, size) {
  const node = el('span', 'st-avatar');
  node.style.setProperty('--size', `${size}px`);
  if (s.id === ADMIN) node.classList.add('is-admin');
  if (!s.active) node.classList.add('is-blocked');
  node.append(el('span', null, (s.name || s.id).slice(0, 1).toUpperCase()));
  if (isOnline(s)) node.append(el('i', 'st-avatar-dot'));
  return node;
}

function badge(text, kind) {
  return el('span', `st-badge st-badge--${kind}`, text);
}

export function courseSwitch(onPick, className = 'tabs', full = false) {
  const nav = el('nav', className);
  for (const c of COURSES) {
    const b = button(full ? c.title : c.label, 'tab');
    b.setAttribute('aria-pressed', String(c.id === course));
    b.addEventListener('click', (e) => { e.stopPropagation(); onPick(c.id); });
    nav.append(b);
  }
  return nav;
}

// Долгий тап (iPhone) или правый клик (Mac) → меню; обычный тап → onTap.
function pressable(node, onTap, onLong) {
  let timer = null;
  let long = false;
  let start = [0, 0];
  const cancel = () => { clearTimeout(timer); timer = null; node.classList.remove('is-pressing'); };
  node.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    long = false;
    start = [e.clientX, e.clientY];
    node.classList.add('is-pressing');
    timer = setTimeout(() => {
      long = true;
      cancel();
      if (navigator.vibrate) navigator.vibrate(10);
      onLong();
    }, 500);
  });
  node.addEventListener('pointermove', (e) => {
    if (timer && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 10) cancel();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => node.addEventListener(t, cancel));
  node.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!long) { cancel(); onLong(); } });
  node.addEventListener('click', () => { if (long) { long = false; return; } onTap(); });
}

function ctx(s) {
  return { student: s, course, courseTitle: courseTitle(), isAdmin: s.id === ADMIN, handlers };
}

function rerender() { if (rootNode) renderStudents(rootNode, pickCourse); }

function openStudent(id) {
  openedId = id;
  rerender();
  window.scrollTo(0, 0);
}

// ---------- Список (CourseManagementView.adminDashboard) ----------

// Сводка — мини-виджеты, как на главной. Цифры те же, что в overviewCard приложения;
// нажатие — быстрый фильтр/сортировка (повторное нажатие снимает).
function miniStat(label, num, sub, pressed, onTap, live) {
  const t = button('', 'tile w-mini st-mini');
  t.setAttribute('aria-pressed', String(pressed));
  if (live) t.dataset.live = 'true';
  t.append(el('span', 'label', label), el('b', 'big mono', String(num)), el('span', 'sub', sub));
  t.addEventListener('click', onTap);
  return t;
}

function overviewCard() {
  const s = summary();
  const grid = el('div', 'w-grid st-overview-grid');
  grid.append(
    miniStat('Ученики', s.total, plural(s.total, 'ученик', 'ученика', 'учеников'), activeFilter === 'all' && sortMode === 'recent',
      () => { activeFilter = 'all'; sortMode = 'recent'; rerender(); }),
    miniStat('Онлайн', s.online, 'учеников онлайн', activeFilter === 'online',
      () => { activeFilter = activeFilter === 'online' ? 'all' : 'online'; rerender(); }, s.online > 0),
    miniStat('В среднем', `${s.avg}%`, `прошли курс: ${s.finished}`, sortMode === 'progress',
      () => { sortMode = sortMode === 'progress' ? 'recent' : 'progress'; rerender(); }),
  );
  return grid;
}

function attentionSection(list) {
  const wrap = el('section', 'tile wide w-wide st-attention');
  const head = el('div', 'st-section-head');
  head.append(el('span', 'st-section-title', 'Давно не заходили'), el('span', 'mono st-section-count', String(list.length)));
  const row = el('div', 'st-attention-row');
  for (const s of list.slice(0, 8)) {
    const chip = button('', 'st-attention-chip');
    const text = el('span', 'st-attention-text');
    text.append(el('b', null, s.name || s.id), el('small', null, lastSeenText(s)));
    chip.append(avatar(s, 30), text);
    chip.addEventListener('click', () => openStudent(s.id));
    row.append(chip);
  }
  wrap.append(head, row);
  return wrap;
}

function searchBar() {
  const wrap = el('div', 'st-search');
  const field = el('label', 'st-search-field');
  const input = el('input', 'st-search-input');
  input.type = 'search';
  input.placeholder = 'Имя или email';
  input.value = searchText;
  input.autocomplete = 'off';
  input.setAttribute('autocapitalize', 'off');
  input.spellcheck = false;
  input.addEventListener('input', () => {
    searchText = input.value;
    rerender();
  });
  field.append(input);
  const sort = el('select', 'st-sort');
  sort.setAttribute('aria-label', 'Сортировка');
  for (const [id, label] of SORTS) {
    const o = el('option', null, label);
    o.value = id;
    o.selected = id === sortMode;
    sort.append(o);
  }
  sort.addEventListener('change', () => { sortMode = sort.value; rerender(); });
  const sortWrap = el('span', 'st-sort-wrap');
  sortWrap.append(el('span', 'st-sort-icon', '⇅'), sort);
  wrap.append(field, sortWrap);
  return wrap;
}

function filterChips() {
  const nav = el('nav', 'st-filters');
  for (const [id, label] of FILTERS) {
    const b = button('', 'st-filter');
    b.setAttribute('aria-pressed', String(activeFilter === id));
    b.append(el('span', null, label), el('span', 'mono st-filter-count', String(countFor(id))));
    b.addEventListener('click', () => { activeFilter = id; rerender(); });
    nav.append(b);
  }
  return nav;
}

// Модули точками (вместо кольца): светлая — пройден, мятная — изучает сейчас, тусклая — впереди.
// У «Модульного обучения» 9 модулей; если модулей с сайта нет — точка на урок.
function moduleDots(s) {
  const byModules = course === 'avanzato' || s.modules.length > 0;
  const count = course === 'avanzato' ? AVANZATO_MODULES.length : (s.modules.length || s.total);
  const done = (i) => (byModules ? Boolean(s.modules[i]) : i < s.completed) || s.progress >= 1;
  let current = -1;
  if (s.progress < 1) for (let i = 0; i < count; i += 1) if (!done(i)) { current = i; break; }
  const wrap = el('span', 'st-mdots');
  wrap.setAttribute('aria-label', `Прогресс ${Math.round(s.progress * 100)} процентов`);
  for (let i = 0; i < count; i += 1) wrap.append(el('i', done(i) ? 'is-done' : i === current ? 'is-current' : ''));
  const box = el('span', 'st-mdots-box');
  box.append(wrap, el('span', 'mono st-mdots-pct', s.progress >= 1 ? '✓' : `${Math.round(s.progress * 100)}%`));
  return box;
}

function listCard(s) {
  const card = el('article', 'st-card');
  if (!s.active) card.classList.add('is-blocked');
  const main = el('div', 'st-card-main');
  const top = el('div', 'st-card-top');
  top.append(el('span', 'st-card-name', displayName(s)));
  if (s.id === ADMIN) top.append(badge('АВТОР', 'author'));
  if (!s.active) top.append(badge('БЛОК', 'blocked'));
  if (s.davinciModule) top.append(badge(s.davinciChecksDone > 0 ? `DV ${s.davinciChecksDone}/${s.davinciChecksTotal}` : 'DV', 'dv'));
  const meta = el('div', 'st-card-meta');
  meta.append(isOnline(s) ? el('span', 'is-online', 'онлайн') : el('span', null, lastSeenText(s)));
  if (s.currentModule !== null && s.progress < 1) {
    meta.append(el('span', 'st-dot-sep', '·'), el('span', 'st-card-module', moduleTitle(s.currentModule)));
  }
  main.append(top, el('span', 'st-card-email', s.id), meta);
  card.append(avatar(s, 46), main, moduleDots(s));
  pressable(card, () => openStudent(s.id), () => openStudentMenu(ctx(s)));
  return card;
}

function renderList(root) {
  root.append(courseSwitch(pickCourse, 'tabs st-course-switch', true));
  if (!studentsLoaded()) {
    root.append(el('p', 'empty', 'Загрузка…'));
    return;
  }
  root.append(overviewCard());
  const add = button('＋  Добавить ученика', 'tile wide st-add');
  add.addEventListener('click', () => handlers?.add());
  root.append(add);

  const attention = needsAttention();
  if (attention.length && !searchText) root.append(attentionSection(attention));

  root.append(searchBar(), filterChips());

  const list = filteredStudents();
  if (!list.length) {
    const empty = el('div', 'st-empty');
    empty.append(el('p', null, !searchText && activeFilter === 'all' ? 'Учеников пока нет' : 'Никого не найдено'));
    if (searchText || activeFilter !== 'all') {
      const reset = button('Сбросить поиск и фильтр', 'st-link');
      reset.addEventListener('click', () => { searchText = ''; activeFilter = 'all'; rerender(); });
      empty.append(reset);
    }
    root.append(empty);
    return;
  }
  const wrap = el('div', 'st-list');
  for (const st of list) wrap.append(listCard(st));
  root.append(wrap);
}

// ---------- Карточка ученика (StudentProgressDetailView) ----------

function sectionTitle(text, trailing) {
  const head = el('div', 'st-section-head');
  head.append(el('span', 'st-section-title', text));
  if (trailing) head.append(el('span', 'mono st-section-count', trailing));
  return head;
}

function actionTile(title, subtitle, onClick, kind = '') {
  const b = button('', `tile st-action${kind ? ` st-action--${kind}` : ''}`);
  b.append(el('b', null, title), el('small', null, subtitle));
  b.addEventListener('click', onClick);
  return b;
}

function renderDetail(root, s) {
  const isAdmin = s.id === ADMIN;
  const completedModules = s.modules.filter(Boolean).length;
  const totalModules = course === 'avanzato' ? AVANZATO_MODULES.length : Math.max(s.modules.length, 1);
  const firstOpen = s.modules.findIndex((done) => !done);
  const currentIndex = s.progress >= 1 ? null : (firstOpen >= 0 ? firstOpen : s.currentModule);

  const back = button('‹ Ученики', 'st-back');
  back.addEventListener('click', () => { openedId = null; rerender(); });
  root.append(back);

  // Шапка: аватар, имя, email (тап — скопировать), статусы.
  const hero = el('section', 'st-hero');
  const heroText = el('div', 'st-hero-text');
  const email = button(`${s.id}  ⧉`, 'st-hero-email');
  email.addEventListener('click', async () => toast(await copyText(s.id) ? 'Email скопирован' : 'Не удалось скопировать', false));
  const chips = el('div', 'st-hero-chips');
  chips.append(el('span', `st-chip${s.active ? '' : ' is-danger'}`, s.active ? 'Доступ открыт' : 'Заблокирован'));
  if (isOnline(s)) chips.append(el('span', 'st-chip is-online', 'Онлайн'));
  if (s.davinciModule) chips.append(el('span', 'st-chip', 'DaVinci'));
  heroText.append(el('h2', 'st-hero-name', displayName(s)), email, chips);
  hero.append(avatar(s, 64), heroText);
  root.append(hero);

  // Прогресс — мини-виджеты, как на главной.
  const pg = el('div', 'w-grid st-detail-grid');
  const tileStat = (label, node, sub) => {
    const t = el('div', 'tile w-mini st-mini is-static');
    t.append(el('span', 'label', label), node, el('span', 'sub', sub));
    return t;
  };
  pg.append(
    tileStat(s.progress >= 1 ? 'Курс' : 'Пройдено', el('b', 'big mono', s.progress >= 1 ? '✓' : `${Math.round(s.progress * 100)}%`),
      s.progress >= 1 ? 'пройден' : `уроков ${s.completed} из ${s.total}`),
    tileStat('Модули', el('b', 'big mono', `${completedModules}/${totalModules}`), s.progress >= 1 ? 'курс пройден' : 'пройдено'),
    tileStat('Визит', el('b', `big st-visit${isOnline(s) ? ' is-online' : ''}`, isOnline(s) ? 'сейчас' : (s.lastSeen ? lastSeenText(s).replace(' назад', '') : '—')),
      isOnline(s) ? 'на сайте' : (s.lastSeen ? 'назад' : 'Никогда')),
  );
  root.append(pg);
  if (currentIndex !== null) {
    const cur = el('div', 'tile wide w-wide st-current');
    cur.append(el('span', 'label', 'Сейчас изучает'), el('b', 'is-accent', moduleTitle(currentIndex)));
    root.append(cur);
  }

  // Доп-модуль DaVinci (только «Модульное обучение»).
  if (course === 'avanzato' && s.davinciModule) {
    const done = s.davinciChecksDone;
    const total = Math.max(s.davinciChecksTotal, 1);
    const status = done === 0 ? ['Не начат', ''] : done >= total ? ['Задание выполнено', 'is-online'] : ['В процессе', 'is-accent'];
    const dv = el('section', 'tile wide w-wide st-dv');
    const text = el('div', 'st-progress-facts');
    text.append(el('b', null, 'DaVinci Resolve 21'), el('small', null, `Доп-модуль открыт · чек-лист ${done} из ${total}`),
      el('span', `st-dv-status ${status[1]}`, status[0]));
    dv.append(ring(done / total, 56, `${done}/${total}`), text);
    root.append(dv);
  }

  // Действия.
  const grid = el('section', 'st-actions');
  grid.append(actionTile('Новый пароль', 'Выдать и отправить', () => confirmResetPassword(ctx(s))));
  const mail = actionTile('Написать', 'Письмо на email', () => { location.href = `mailto:${s.id}`; });
  grid.append(mail);
  if (course === 'avanzato') {
    grid.append(actionTile(s.davinciModule ? 'Закрыть DaVinci' : 'Открыть DaVinci',
      s.davinciModule ? 'Модуль сейчас открыт' : 'Платный доп-модуль', async () => {
        const next = !s.davinciModule;
        try {
          await handlers.setDavinci(s.id, next);
          toast(next ? 'Модуль DaVinci открыт' : 'Модуль DaVinci закрыт');
        } catch {
          toast('Не удалось изменить доступ к DaVinci', true);
        }
      }));
  }
  if (!isAdmin) {
    grid.append(actionTile(s.active ? 'Заблокировать' : 'Разблокировать', s.active ? 'Закрыть вход в курс' : 'Вернуть доступ',
      () => confirmBlock(ctx(s), displayName(s)), s.active ? 'danger' : 'online'));
  }
  root.append(grid);

  // По модулям.
  if (s.modules.length) {
    const mods = el('section', 'tile wide w-wide st-mods-tile');
    mods.append(sectionTitle('По модулям', `${completedModules}/${s.modules.length}`));
    const list = el('ol', 'st-timeline');
    s.modules.forEach((done, i) => {
      const item = el('li', `st-step${done ? ' is-done' : ''}${i === currentIndex ? ' is-current' : ''}`);
      const text = el('div');
      text.append(el('b', null, moduleTitle(i)), el('small', null, done ? 'Пройден' : i === currentIndex ? 'Изучает сейчас' : 'Не начат'));
      item.append(el('span', 'st-step-mark', done ? '✓' : moduleNumber(i)), text);
      list.append(item);
    });
    mods.append(list);
    root.append(mods);
  }

  // Сведения.
  const info = el('section', 'tile wide w-wide st-info');
  const infoRow = (label, value) => {
    const r = el('div', 'ev-row');
    r.append(el('span', 'ev-row-label', label), el('span', 'ev-row-value', value));
    return r;
  };
  info.append(
    infoRow('Добавлен', new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(s.createdAt)),
    infoRow('Последний визит', lastSeenText(s)),
    infoRow('Курс', courseTitle()),
  );
  root.append(info);

  // Заметки.
  const notes = el('section', 'tile wide w-wide st-notes');
  notes.append(sectionTitle('Заметки'));
  const notesBtn = button('', 'st-notes-btn');
  if (s.notes) notesBtn.append(el('span', 'st-notes-text', s.notes), el('span', 'st-notes-edit', '✎'));
  else notesBtn.append(el('span', 'st-notes-empty', '+ Добавить заметку — оплата, договорённости, пожелания'));
  notesBtn.addEventListener('click', () => openNotesEditor(ctx(s)));
  notes.append(notesBtn);
  root.append(notes);

  // Удаление.
  if (!isAdmin) {
    const del = button('Удалить ученика', 'st-delete');
    del.addEventListener('click', () => confirmDelete(ctx(s), displayName(s), () => { openedId = null; rerender(); }));
    root.append(del);
  }
}

// ---------- Вход ----------

export function renderStudents(root, onPickCourse) {
  rootNode = root;
  pickCourse = onPickCourse;
  root.classList.add('st-root');
  // Опрос облака перерисовывает раздел каждые 20 с — поле поиска не должно терять фокус и курсор.
  const focused = document.activeElement?.classList?.contains('st-search-input') ? document.activeElement : null;
  const caret = focused ? focused.selectionStart : null;
  root.replaceChildren();
  const opened = openedId && all().find((s) => s.id === openedId);
  if (opened) renderDetail(root, opened);
  else {
    openedId = null;
    renderList(root);
  }
  // Плитки «выезжают» только при первом показе раздела, не при каждой перерисовке
  // (поиск, фильтры, опрос облака) — как на главной.
  if (!root.dataset.ready && !readyTimer && root.offsetParent !== null) {
    readyTimer = setTimeout(() => { root.dataset.ready = 'true'; }, 900);
  }
  if (focused) {
    const input = root.querySelector('.st-search-input');
    if (input) {
      input.focus();
      input.setSelectionRange(caret, caret);
    }
  }
}

export function studentsSubtitle() {
  if (!studentsLoaded()) return 'Загрузка…';
  return courseTitle();
}
