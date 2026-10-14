// Окно создания/правки личной задачи. Поля — как личная задача в AddTaskSheet.
// Сеть здесь не трогается: результат уходит в onSave.
import { PRIORITIES } from './tasks.js';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const pad = (n) => String(n).padStart(2, '0');

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

export function openTaskEditor(existing, day, onSave) {
  const isNew = !existing;
  const now = new Date();
  const start = existing
    ? existing.date
    : new Date(day.getFullYear(), day.getMonth(), day.getDate(), now.getHours(), now.getMinutes());
  let priority = existing?.priority || 'medium';

  const overlay = element('div', 'ed-overlay');
  const sheet = element('form', 'ed-sheet');
  sheet.noValidate = true;
  overlay.append(sheet);

  const taskInput = input('text', existing?.task || '', 'Что сделать');
  const dateInput = input('date', `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`);
  const timeInput = input('time', `${pad(start.getHours())}:${pad(start.getMinutes())}`);
  const notesInput = element('textarea', 'ed-input ed-notes');
  notesInput.rows = 3;
  notesInput.value = existing?.notes || '';
  const locationInput = input('text', existing?.location || '');
  const linkInput = input('url', existing?.link || '', 'https://');
  const contactInput = input('text', existing?.contactName || '');
  const phoneInput = input('tel', existing?.contactPhone || '', '+7 000 000 00 00');

  const seg = element('div', 'ed-seg');
  const segButtons = PRIORITIES.map(([id, label]) => {
    const b = element('button', 'ed-seg-btn', label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(id === priority));
    b.addEventListener('click', () => {
      for (const o of segButtons) o.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-pressed', 'true');
      priority = id;
    });
    return b;
  });
  seg.append(...segButtons);

  const when = element('div', 'ed-row');
  when.append(field('Дата', dateInput), field('Время', timeInput));
  const contact = element('div', 'ed-row');
  contact.append(field('Контакт', contactInput), field('Телефон', phoneInput));

  const error = element('p', 'ed-error');
  error.hidden = true;
  const cancel = element('button', 'button', 'Отмена');
  cancel.type = 'button';
  const save = element('button', 'button button--primary', 'Сохранить');
  save.type = 'submit';
  const actions = element('div', 'ed-actions');
  actions.append(cancel, save);

  sheet.append(
    element('h2', 'ed-title', isNew ? 'Новая задача' : 'Изменить задачу'),
    field('Задача', taskInput),
    when,
    field('Приоритет', seg),
    field('Заметки', notesInput),
    field('Место', locationInput),
    field('Ссылка', linkInput),
    contact,
    error,
    actions,
  );

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
    const [y, m, d] = dateInput.value.split('-').map(Number);
    const [hh, mm] = (timeInput.value || '00:00').split(':').map(Number);
    if (!task || !y) {
      error.textContent = !task ? 'Введите задачу' : 'Укажите дату';
      error.hidden = false;
      return;
    }
    const fields = {
      task,
      date: new Date(y, m - 1, d, hh || 0, mm || 0),
      priority,
      notes: notesInput.value.trim(),
      location: locationInput.value.trim(),
      link: linkInput.value.trim(),
      contactName: contactInput.value.trim(),
      contactPhone: phoneInput.value.trim(),
    };
    save.disabled = true;
    cancel.disabled = true;
    save.textContent = 'Сохраняю…';
    try {
      await onSave(fields, isNew);
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
  document.body.append(overlay);
}
