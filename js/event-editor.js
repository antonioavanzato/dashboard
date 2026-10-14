// Окно создания/правки события. Поля и значения по умолчанию — как AddTaskSheet
// в приложении: тип «Сайт», статус «Ожидает», дата — выбранный день и текущее время.
// Сеть здесь не трогается: готовое событие уходит в onSave.
import { normalizeTelegram } from './planner.js';

const TYPES = [['project', 'Сайт'], ['shooting', 'Съёмка'], ['meeting', 'Обучение']];
const STATUSES = [
  ['pending', 'Ожидает'],
  ['confirmed', 'Подтверждена'],
  ['completed', 'Завершена'],
  ['cancelled', 'Отменена'],
];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const pad = (n) => String(n).padStart(2, '0');
const dateValue = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeValue = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function field(labelText, control) {
  const wrap = element('label', 'ed-field');
  wrap.append(element('span', 'ed-label', labelText), control);
  return wrap;
}

function input(type, value, placeholder) {
  const node = element('input', 'ed-input');
  node.type = type;
  node.value = value ?? '';
  if (placeholder) node.placeholder = placeholder;
  return node;
}

function segments(options, value, onChange) {
  const wrap = element('div', 'ed-seg');
  const buttons = options.map(([id, label]) => {
    const b = element('button', 'ed-seg-btn', label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(id === value));
    b.addEventListener('click', () => {
      for (const other of buttons) other.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-pressed', 'true');
      onChange(id);
    });
    return b;
  });
  wrap.append(...buttons);
  return wrap;
}

export function parseAmount(text) {
  const n = Number(String(text).replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * @param {object|null} existing — нормализованное событие или null для нового
 * @param {Date} day — выбранный день (для нового)
 * @param {(event, isNew) => Promise<void>} onSave — бросает ошибку с текстом для пользователя
 */
export function openEditor(existing, day, onSave) {
  const isNew = !existing;
  const now = new Date();
  const start = existing
    ? existing.date
    : new Date(day.getFullYear(), day.getMonth(), day.getDate(), now.getHours(), now.getMinutes());

  const state = {
    type: existing?.type || 'project',
    status: existing?.status || 'pending',
  };

  const overlay = element('div', 'ed-overlay');
  const sheet = element('form', 'ed-sheet');
  sheet.noValidate = true;
  overlay.append(sheet);

  const title = element('h2', 'ed-title', isNew ? 'Новое событие' : 'Изменить событие');

  const taskInput = input('text', existing?.task || '', 'Название или имя клиента');
  const dateInput = input('date', dateValue(start));
  const timeInput = input('time', timeValue(start));
  const prepInput = input('text', existing?.prepayment ? String(existing.prepayment) : '', '0');
  prepInput.inputMode = 'decimal';
  const finalInput = input('text', existing?.total ? String(existing.total) : '', '0');
  finalInput.inputMode = 'decimal';
  const phoneInput = input('tel', existing?.phone || '', '+7 000 000 00 00');
  const tgInput = input('text', existing?.telegram || '', '@username');
  const locationInput = input('text', existing?.location || '');
  const techInput = input('text', (existing?.tech || []).join(', '), 'через запятую');
  const wfolioInput = input('url', existing?.wfolio || '', 'https://');
  const notesInput = element('textarea', 'ed-input ed-notes');
  notesInput.rows = 3;
  notesInput.value = existing?.notes || '';

  // Поля зависят от типа — как в приложении.
  const locationField = field('Локация', locationInput);
  const techField = field('Техника', techInput);
  const wfolioField = field('Ссылка wfolio', wfolioInput);
  function applyType() {
    const label = locationField.querySelector('.ed-label');
    label.textContent = state.type === 'project' ? 'Домен сайта'
      : state.type === 'meeting' ? 'Локация / Платформа' : 'Локация';
    techField.hidden = state.type !== 'shooting';
    wfolioField.hidden = state.type !== 'shooting';
  }

  const error = element('p', 'ed-error');
  error.hidden = true;

  const cancel = element('button', 'button', 'Отмена');
  cancel.type = 'button';
  const save = element('button', 'button button--primary', 'Сохранить');
  save.type = 'submit';
  const actions = element('div', 'ed-actions');
  actions.append(cancel, save);

  const when = element('div', 'ed-row');
  when.append(field('Дата', dateInput), field('Время', timeInput));
  const money = element('div', 'ed-row');
  money.append(field('Предоплата, ₽', prepInput), field('Финал, ₽', finalInput));

  sheet.append(
    title,
    field('Тип', segments(TYPES, state.type, (v) => { state.type = v; applyType(); })),
    field('Название', taskInput),
    when,
    field('Статус', segments(STATUSES, state.status, (v) => { state.status = v; })),
    money,
    field('Телефон', phoneInput),
    field('Telegram', tgInput),
    locationField,
    techField,
    field('Заметки', notesInput),
    wfolioField,
    error,
    actions,
  );
  applyType();

  function close() {
    overlay.remove();
    document.body.classList.remove('ed-open');
  }
  cancel.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  sheet.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;

    const task = taskInput.value.trim();
    if (!task) {
      error.textContent = 'Введите название';
      error.hidden = false;
      taskInput.focus();
      return;
    }
    const [y, m, d] = dateInput.value.split('-').map(Number);
    const [hh, mm] = (timeInput.value || '00:00').split(':').map(Number);
    if (!y || !m || !d) {
      error.textContent = 'Укажите дату';
      error.hidden = false;
      return;
    }

    // Берём исходное событие целиком и меняем только поля формы —
    // так не теряется ничего, чего в форме нет (например, priority).
    const event = {
      ...(existing || {
        id: crypto.randomUUID().toUpperCase(),
        priority: 'medium',
      }),
      task,
      type: state.type,
      status: state.status,
      date: new Date(y, m - 1, d, hh || 0, mm || 0),
      prepayment: parseAmount(prepInput.value),
      total: parseAmount(finalInput.value),
      phone: phoneInput.value.trim(),
      telegram: normalizeTelegram(tgInput.value),
      location: locationInput.value.trim(),
      notes: notesInput.value.trim(),
      // Поля, скрытые для этого типа, не стираем — оставляем как были.
      tech: state.type === 'shooting'
        ? techInput.value.split(',').map((t) => t.trim()).filter(Boolean)
        : (existing?.tech || []),
      wfolio: state.type === 'shooting' ? wfolioInput.value.trim() : (existing?.wfolio || ''),
    };

    save.disabled = true;
    cancel.disabled = true;
    save.textContent = 'Сохраняю…';
    try {
      await onSave(event, isNew);
      close();
    } catch (err) {
      error.textContent = err.message || 'Не удалось сохранить';
      error.hidden = false;
      save.disabled = false;
      cancel.disabled = false;
      save.textContent = 'Сохранить';
    }
  });

  document.body.classList.add('ed-open');
  // Фокус не ставим: на iPhone клавиатура сразу закрывала бы половину окна.
  document.body.append(overlay);
}
