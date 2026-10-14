// Окно «Настройки»: все входы в одном месте.
// - Заявки и Планер — ключ Yandex Cloud на этом устройстве;
// - Задачи — аккаунт Firebase (тот же email, что в приложении).
// Выход только стирает вход на этом устройстве, данные в облаках не трогает.
import { tasksState, signIn, signOutTasks } from './tasks.js';

let overlay = null;
let content = null;
let handlers = {};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function section(title, ...children) {
  const box = element('section', 'st-section');
  box.append(element('h3', 'st-title', title), ...children);
  return box;
}

function firebaseBlock() {
  const { state, email, error } = tasksState();
  if (state === 'ready') {
    const row = element('div', 'st-row');
    row.append(element('span', 'st-value', email));
    const out = element('button', 'button', 'Выйти');
    out.type = 'button';
    out.addEventListener('click', async () => {
      if (!confirm('Выйти из аккаунта задач на этом устройстве? Сами задачи не пострадают.')) return;
      await signOutTasks();
    });
    row.append(out);
    return [row];
  }
  if (state === 'signed-out') {
    const form = element('form', 'tk-login');
    form.noValidate = true;
    const mail = element('input', 'ed-input');
    mail.type = 'email';
    mail.placeholder = 'Email';
    mail.autocomplete = 'username';
    const pass = element('input', 'ed-input');
    pass.type = 'password';
    pass.placeholder = 'Пароль';
    pass.autocomplete = 'current-password';
    const err = element('p', 'ed-error');
    err.hidden = true;
    const submit = element('button', 'button button--primary', 'Войти');
    submit.type = 'submit';
    form.append(mail, pass, err, submit);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!mail.value.trim() || !pass.value) return;
      submit.disabled = true;
      err.hidden = true;
      try {
        await signIn(mail.value.trim(), pass.value);
      } catch (x) {
        err.textContent = x.message;
        err.hidden = false;
        submit.disabled = false;
      }
    });
    return [element('p', 'st-hint', 'Тот же email и пароль, что в приложении.'), form];
  }
  return [element('p', 'st-hint', state === 'error' ? error : 'Загрузка…')];
}

function render() {
  if (!content) return;
  content.replaceChildren();

  // Ключа ещё нет — вводим его прямо здесь.
  if (handlers.yandex && !handlers.yandex.loggedIn()) {
    const form = element('form', 'tk-login');
    form.noValidate = true;
    const keyInput = element('input', 'ed-input');
    keyInput.type = 'password';
    keyInput.placeholder = 'Ключ доступа';
    keyInput.autocomplete = 'off';
    const kErr = element('p', 'ed-error');
    kErr.hidden = true;
    const kSubmit = element('button', 'button button--primary', 'Войти');
    kSubmit.type = 'submit';
    form.append(keyInput, kErr, kSubmit);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const key = keyInput.value.trim();
      if (!key) return;
      kSubmit.disabled = true;
      kErr.hidden = true;
      try {
        await handlers.yandex.login(key);
        render();
      } catch (x) {
        kErr.textContent = x.message;
        kErr.hidden = false;
        kSubmit.disabled = false;
      }
    });
    content.append(
      section('Заявки и Планер', element('p', 'st-hint', 'Ключ доступа Yandex Cloud. Хранится только на этом устройстве.'), form),
      section('Задачи', ...firebaseBlock()),
    );
    return;
  }

  const yRow = element('div', 'st-row');
  const locked = handlers.faceId?.enabled?.();
  yRow.append(element('span', 'st-value', locked
    ? 'Ключ доступа хранится зашифрованным, открывается по Face ID'
    : 'Ключ доступа сохранён на этом устройстве'));
  const yOut = element('button', 'button', 'Выйти');
  yOut.type = 'button';
  yOut.addEventListener('click', () => {
    if (!confirm('Выйти из заявок и планера на этом устройстве? Данные в облаке не пострадают. Для входа понадобится ключ.')) return;
    close();
    handlers.onYandexLogout?.();
  });
  yRow.append(yOut);

  const faceBlock = [];
  if (handlers.faceId) {
    const on = handlers.faceId.enabled();
    const row = element('div', 'st-row');
    row.append(element('span', 'st-value', on ? 'Включён' : 'Выключен'));
    const btn = element('button', on ? 'button' : 'button button--primary', on ? 'Выключить' : 'Включить');
    btn.type = 'button';
    const err = element('p', 'ed-error');
    err.hidden = true;
    btn.addEventListener('click', async () => {
      err.hidden = true;
      if (on) {
        if (!confirm('Выключить вход по Face ID? Ключ снова будет храниться на устройстве как раньше.')) return;
        handlers.faceId.disable();
        render();
        return;
      }
      btn.disabled = true;
      try {
        await handlers.faceId.enable();
        render();
      } catch (e) {
        err.textContent = e?.name === 'NotAllowedError' ? 'Face ID отменён — ничего не изменено' : (e.message || 'Не удалось включить');
        err.hidden = false;
        btn.disabled = false;
      }
    });
    row.append(btn);
    faceBlock.push(row, element('p', 'st-hint',
      'Ключ доступа шифруется и открывается только по Face ID. Если что-то пойдёт не так — всегда можно войти ключом вручную.'), err);
  }

  content.append(
    section('Заявки и Планер', yRow),
    ...(faceBlock.length ? [section('Вход по Face ID', ...faceBlock)] : []),
    section('Задачи', ...firebaseBlock()),
    section('Уведомления',
      element('p', 'st-hint', 'Уведомления о новых заявках приходят в Telegram — их настройка не в этом приложении.')),
  );
}

export function openSettings(next) {
  handlers = next || {};
  if (overlay) return;
  overlay = element('div', 'ed-overlay');
  const sheet = element('div', 'ed-sheet');
  const head = element('div', 'st-head');
  head.append(element('h2', 'ed-title', 'Настройки'));
  const done = element('button', 'button', 'Готово');
  done.type = 'button';
  done.addEventListener('click', close);
  head.append(done);
  content = element('div', 'st-content');
  sheet.append(head, content);
  overlay.append(sheet);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.classList.add('ed-open');
  document.body.append(overlay);
  render();
}

/** Перерисовать, если окно открыто (например, после входа в Firebase). */
export function refreshSettings() {
  render();
}

function close() {
  overlay?.remove();
  overlay = null;
  content = null;
  document.body.classList.remove('ed-open');
}
