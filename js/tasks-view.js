// Блок «Задачи» под выбранным днём Планера: вход в Firebase, список, отметки.
import {
  tasksState, tasksOn, setCompleted, updateTask, createTask, findTask,
} from './tasks.js';
import { openTaskEditor } from './task-editor.js';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const time = (d) => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(d);
const PRIORITY_DOT = { high: 'rgb(224, 90, 80)', medium: 'rgba(255,255,255,0.7)', low: 'rgb(76, 191, 115)' };

function showError(text) {
  const banner = document.getElementById('banner');
  banner.textContent = text;
  banner.hidden = false;
}

function taskRow(task) {
  const row = element('div', 'tk-row');
  if (task.completed) row.classList.add('is-done');

  const check = element('button', 'tk-check');
  check.type = 'button';
  check.setAttribute('aria-pressed', String(task.completed));
  check.setAttribute('aria-label', task.completed ? 'Снять отметку' : 'Выполнено');
  check.addEventListener('click', async () => {
    check.disabled = true;
    try {
      await setCompleted(task, !task.completed);
    } catch (err) {
      showError(err.message || 'Не удалось сохранить отметку');
      check.disabled = false;
    }
  });

  const body = element('button', 'tk-body');
  body.type = 'button';
  const title = element('span', 'tk-title', task.task || 'Без названия');
  const meta = element('span', 'tk-meta', [time(task.date), task.location, task.contactName].filter(Boolean).join(' · '));
  body.append(title, meta);
  body.addEventListener('click', () => {
    const fresh = findTask(task.id) || task;
    openTaskEditor(fresh, fresh.date, (fields) => updateTask(fresh, fields));
  });

  const dot = element('span', 'tk-prio');
  dot.style.background = PRIORITY_DOT[task.priority] || PRIORITY_DOT.medium;

  row.append(check, body, dot);
  return row;
}

export function renderTasksSection(root, day, onOpenSettings) {
  const head = element('div', 'day-head');
  head.append(element('h2', 'group-title', 'Задачи'));
  const { state, error } = tasksState();

  if (state === 'ready') {
    const add = element('button', 'button', '+ Задача');
    add.type = 'button';
    add.addEventListener('click', () => openTaskEditor(null, day, (fields) => createTask(fields)));
    head.append(add);
  }
  root.append(head);

  if (state === 'idle' || state === 'loading') {
    root.append(element('p', 'empty empty--small', 'Загрузка задач…'));
    return;
  }
  if (state === 'error') {
    root.append(element('p', 'empty empty--small', error));
    return;
  }
  if (state === 'signed-out') {
    const box = element('div', 'tk-login');
    box.append(element('p', 'tk-hint', 'Чтобы видеть задачи, войдите в аккаунт в настройках.'));
    const open = element('button', 'button', 'Открыть настройки');
    open.type = 'button';
    open.addEventListener('click', () => onOpenSettings());
    box.append(open);
    root.append(box);
    return;
  }

  const list = tasksOn(day);
  if (list.length) for (const t of list) root.append(taskRow(t));
  else root.append(element('p', 'empty empty--small', 'Задач на этот день нет'));
}
