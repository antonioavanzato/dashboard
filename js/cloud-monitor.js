// Cloud Monitor — один в один с приложением (Features/CloudMonitor):
// CloudMonitorConfig / CloudMonitorService / CloudMonitorSheet / ProjectTileCard.
// Бэкенд тот же (API Gateway monitoring), он уже разрешает запросы с antonioavanzato.github.io.
// Живёт только виджетами на главной — без иконки в доке.
//
// Как в приложении: опрос раз в 300 с и только пока главная на экране; токен — в памяти;
// пароль сохраняется на устройстве (в приложении — Keychain), «Выйти» его стирает.

const API_BASE = 'https://d5dv3oi96qbceipsi7c5.kocrdvxt.apigw.yandexcloud.net';
const ENDPOINTS = { login: '/auth/login', session: '/auth/session', logout: '/auth/logout', metrics: '/metrics' };
export const CM_PROJECTS = [
  { key: 'avanzato', name: 'Avanzato' },
  { key: 'alga', name: 'ALGA' },
];
export const CM_REFRESH_MS = 300000; // 5 минут — как refreshInterval; не менять (квота)
const FREE_TIER_CALLS = 1000000;
const WARM_WARN_MIN = 15;
const PASSWORD_KEY = 'hub.cm.password';

// ---------- Состояние ----------

const state = {
  phase: 'idle',        // idle | checking | locked | ready
  projects: [],
  generatedAt: null,
  banner: null,
  bannerKind: 'error',  // error | warn
  stale: false,
  offline: false,
  loginError: null,
  loggingIn: false,
  loading: false,
  lastLoad: 0,
};
let token = null;
let expiresAt = 0;
let onChange = () => {};

export const cmState = () => state;
export function setCloudMonitorListener(fn) { onChange = fn; }
const changed = () => onChange();

function savedPassword() {
  try { return localStorage.getItem(PASSWORD_KEY) || null; } catch { return null; }
}
function savePassword(p) {
  try { localStorage.setItem(PASSWORD_KEY, p); } catch { /* не запомнится */ }
}
function deletePassword() {
  try { localStorage.removeItem(PASSWORD_KEY); } catch { /* нечего стирать */ }
}

// ---------- Транспорт ----------

class HttpError extends Error {
  constructor(status) { super(`HTTP ${status}`); this.status = status; }
}

async function call(path, { method = 'GET', body, auth } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = `Bearer ${auth}`;
  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include', // refresh-cookie cm_rt (Safari может её не принять — тогда войдём паролем)
    cache: 'no-store',
  });
  if (!res.ok) throw new HttpError(res.status);
  return res;
}

async function accept(res) {
  const data = await res.json();
  if (!data || !data.token) throw new Error('Пустой ответ авторизации');
  token = data.token;
  // Обновляемся за 30 секунд до истечения — как в приложении.
  expiresAt = Date.now() + ((Number(data.expiresIn) || 900) - 30) * 1000;
}

async function performLogin(password) {
  await accept(await call(ENDPOINTS.login, { method: 'POST', body: { password } }));
}

async function restoreSession() {
  try {
    await accept(await call(ENDPOINTS.session, { method: 'POST' }));
    return true;
  } catch {
    return false;
  }
}

async function validToken() {
  if (token && Date.now() < expiresAt) return token;
  token = null;
  return (await restoreSession()) ? token : null;
}

// ---------- Жизненный цикл ----------

/** Главная на экране: поднимаем сессию (молча) и грузим, если данные старше интервала. */
export async function cmBegin() {
  if (state.phase === 'idle') {
    state.phase = 'checking';
    changed();
    if (await restoreSession()) {
      state.phase = 'ready';
    } else {
      const saved = savedPassword();
      if (saved) {
        try {
          await performLogin(saved);
          state.phase = 'ready';
        } catch (e) {
          // Пароль устарел — просим заново, чтобы не зациклиться (сеть — не повод стирать).
          if (e instanceof HttpError && (e.status === 401 || e.status === 403)) deletePassword();
          state.phase = 'locked';
        }
      } else {
        state.phase = 'locked';
      }
    }
    changed();
  }
  if (state.phase === 'ready' && Date.now() - state.lastLoad >= CM_REFRESH_MS) await cmLoad();
}

export async function cmLogin(password) {
  if (state.loggingIn || !password) return;
  state.loggingIn = true;
  state.loginError = null;
  changed();
  try {
    await performLogin(password);
    savePassword(password);
    state.phase = 'ready';
    state.loggingIn = false;
    changed();
    await cmLoad();
  } catch (e) {
    state.loginError = e instanceof HttpError && e.status === 401 ? 'Неверный пароль' : 'Не удалось войти. Проверь соединение';
    state.loggingIn = false;
    changed();
  }
}

export async function cmLogout() {
  token = null;
  expiresAt = 0;
  deletePassword();
  Object.assign(state, { projects: [], generatedAt: null, banner: null, phase: 'locked', lastLoad: 0 });
  changed();
  try { await call(ENDPOINTS.logout, { method: 'POST' }); } catch { /* всё равно выходим */ }
}

export async function cmLoad() {
  if (state.loading || state.phase !== 'ready') return;
  state.loading = true;
  try {
    await fetchMetrics(true);
  } finally {
    state.loading = false;
    changed();
  }
}

async function fetchMetrics(retryAfterRelogin) {
  const t = await validToken();
  if (!t) {
    const saved = savedPassword();
    if (retryAfterRelogin && saved) {
      try {
        await performLogin(saved);
        return fetchMetrics(false);
      } catch { /* ниже — просим пароль */ }
    }
    state.phase = 'locked';
    return;
  }
  try {
    const data = await (await call(ENDPOINTS.metrics, { auth: t })).json();
    state.projects = Array.isArray(data.projects) ? data.projects : [];
    state.generatedAt = data.generatedAt ? new Date(data.generatedAt) : new Date();
    Object.assign(state, { banner: null, stale: false, offline: false, lastLoad: Date.now() });
  } catch (e) {
    if (e instanceof HttpError && (e.status === 401 || e.status === 403)) {
      token = null;
      expiresAt = 0;
      state.phase = 'locked';
    } else if (!navigator.onLine) {
      Object.assign(state, { offline: true, stale: true, bannerKind: 'warn', banner: 'Офлайн — показаны последние данные' });
    } else {
      Object.assign(state, { stale: true, bannerKind: 'error', banner: `Не удалось обновить данные (${e.message})` });
    }
  }
}

// ---------- Производные значения (как CloudMonitorProject) ----------

export const cmProject = (key) => state.projects.find((p) => p.key === key) || null;
const effectiveLimit = (p) => p.limit ?? FREE_TIER_CALLS;
const usedPercent = (p) => (effectiveLimit(p) > 0 ? ((p.calls ?? 0) / effectiveLimit(p)) * 100 : 0);
function computePercent(p) {
  if (p.computeGbHours == null) return null;
  const limit = p.computeLimitGbHours ?? 10;
  return limit > 0 ? (p.computeGbHours / limit) * 100 : null;
}
const worstPercent = (p) => Math.max(usedPercent(p), computePercent(p) ?? 0);
const isApproximate = (p) => p.calibration == null && p.callsRaw != null;
function minutesSinceLastCall(p) {
  const d = p.lastInvocationAt ? new Date(p.lastInvocationAt) : null;
  return d && !Number.isNaN(d.getTime()) ? (Date.now() - d) / 60000 : null;
}
export const statusWord = (pct) => (pct >= 90 ? 'Предел' : pct >= 70 ? 'Внимание' : 'Норма');
export const levelClass = (pct) => (pct >= 90 ? 'is-err' : pct >= 70 ? 'is-warn' : '');

const nf = new Intl.NumberFormat('ru-RU');
const num = (v) => nf.format(v);
function agoText(m) {
  if (m == null) return 'нет данных';
  if (m < 1) return 'только что';
  if (m < 60) return `${Math.round(m)} мин назад`;
  if (m < 1440) return `${Math.round(m / 60)} ч назад`;
  return `${Math.round(m / 1440)} дн назад`;
}
const fixed1 = (v) => v.toFixed(1);

// ---------- Мини-виджет (ProjectTileCard) ----------

/** Данные для мини-виджета главной: крупно худший показатель, под ним второй. */
export function cmMini(key) {
  if (state.phase === 'locked') return { num: '—', sub: 'нужен вход' };
  if (state.phase !== 'ready' || (!state.generatedAt && !state.projects.length)) return { num: '—', sub: 'загрузка…' };
  const p = cmProject(key);
  if (!p) return { num: '—', sub: 'нет данных', dim: true };
  if (p.error) return { num: '—', sub: 'ошибка', dim: true, err: true };
  const calls = usedPercent(p);
  const compute = computePercent(p);
  const computeLeads = (compute ?? 0) > calls;
  const lead = computeLeads ? compute : calls;
  const second = computeLeads ? calls : compute;
  const secondText = second == null ? '' : ` · ${computeLeads ? 'выз.' : 'выч.'} ${fixed1(second)}%`;
  return {
    num: `${fixed1(lead)}%`,
    sub: `${statusWord(worstPercent(p))}${secondText}`,
    level: levelClass(lead),
    dim: state.stale,
  };
}

// ---------- Выжимка (CloudMonitorSheet.projectCard) ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function bar(title, value, pct, fraction) {
  const wrap = el('div', 'cm-bar');
  const head = el('div', 'cm-bar-head');
  head.append(el('span', null, title), el('span', 'mono', value));
  const track = el('div', 'cm-track');
  const fill = el('i', levelClass(pct));
  fill.style.width = `${Math.max(0.5, Math.min(100, fraction * 100))}%`;
  track.append(fill);
  wrap.append(head, track);
  return wrap;
}

function loginForm() {
  const form = el('form', 'cm-login');
  if (state.loginError) form.append(el('p', 'cm-login-error', state.loginError));
  const input = el('input', 'ed-input');
  input.type = 'password';
  input.placeholder = 'Пароль';
  input.autocomplete = 'current-password';
  const submit = el('button', 'button button--primary', state.loggingIn ? 'Проверяем…' : 'Войти');
  submit.type = 'submit';
  submit.disabled = state.loggingIn;
  form.append(input, submit, el('p', 'sub', 'Пароль сохранится на этом устройстве — дальше вход будет автоматическим'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = input.value;
    input.value = '';
    cmLogin(value);
  });
  return form;
}

const hhmm = (d) => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(d);

/** Узлы выжимки для проекта: вход, ошибка или полная карточка. */
export function cmPeek(key) {
  if (state.phase === 'locked') return [loginForm()];
  if (state.phase !== 'ready') return [el('p', 'sub', 'Загрузка…')];
  const nodes = [];
  if (state.banner) nodes.push(el('p', `cm-banner${state.bannerKind === 'warn' ? ' is-warn' : ''}`, state.banner));
  const p = cmProject(key);
  if (!p || p.error) {
    nodes.push(el('p', `sub${p ? ' is-err' : ''}`, p ? 'ошибка' : 'не подключено'));
  } else {
    const card = el('div', `cm-card${state.stale ? ' is-stale' : ''}`);
    const worst = worstPercent(p);
    const compute = computePercent(p);
    const head = el('div', 'cm-hero');
    const big = el('b', `cm-big mono ${levelClass(worst)}`, fixed1(worst));
    big.append(el('small', null, '%'));
    const pill = el('span', `cm-pill ${levelClass(worst)}`, statusWord(worst));
    head.append(big, pill);
    card.append(head, el('p', 'sub cm-hero-sub',
      `от бесплатного лимита · ${(compute ?? 0) > usedPercent(p) ? 'вычислительное время' : 'вызовы функций'}`));
    card.append(bar('Вызовы', `${num(p.calls ?? 0)} / ${num(effectiveLimit(p))}${isApproximate(p) ? ' ≈' : ''}`,
      usedPercent(p), Math.min(1, Math.max(0, usedPercent(p) / 100))));
    if (compute != null) {
      const limit = num(Math.round(p.computeLimitGbHours ?? 10));
      card.append(bar('Вычисления', `${(p.computeGbHours ?? 0).toFixed(2)} / ${limit} ГБ×ч${p.computeApprox ? ' ≈' : ''}`,
        compute, Math.min(1, Math.max(0, compute / 100))));
    }
    const recent = p.errors24h ?? 0;
    const errSub = recent > 0 ? `за сутки: ${num(recent)}` : ((p.errors30d ?? 0) > 0 ? 'за сутки: нет' : '');
    const mins = minutesSinceLastCall(p);
    const coldSub = p.coldStartPct != null ? `холодных стартов: ${Math.round(p.coldStartPct)}%` : '';
    const foot = el('div', 'cm-foot');
    const item = (mark, value, caption) => {
      const it = el('div', 'cm-foot-item');
      it.append(el('span', 'cm-foot-mark', mark));
      const text = el('div');
      text.append(el('b', null, value), el('small', null, caption));
      it.append(text);
      return it;
    };
    foot.append(
      item('!', num(p.errors30d ?? 0), errSub || 'ошибок за 30 дней'),
      item(mins == null ? '○' : (mins <= WARM_WARN_MIN ? '●' : '○'), agoText(mins), coldSub || 'прогрев'),
    );
    card.append(foot);
    // Каталог — шумная строка, нужна раз в месяц: по нажатию на «Обновлено».
    const meta = el('button', 'cm-meta', state.generatedAt ? `Обновлено ${hhmm(state.generatedAt)}${state.offline ? ' · офлайн' : ''}` : '—');
    meta.type = 'button';
    meta.addEventListener('click', () => { meta.textContent = p.folderId || meta.textContent; });
    card.append(meta);
    nodes.push(card);
  }
  const logout = el('button', 'cm-logout', 'Выйти из Cloud Monitor');
  logout.type = 'button';
  logout.addEventListener('click', () => { if (confirm('Выйти из Cloud Monitor? Пароль на этом устройстве сотрётся.')) cmLogout(); });
  nodes.push(logout);
  return nodes;
}
