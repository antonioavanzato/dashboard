// Управление учениками: меню долгого тапа и окна (заметка, новый пароль, новый ученик).
// Повторяет CourseManagementView / StudentProgressDetailView из приложения.
// Сеть здесь не трогается: каждое действие уходит в обработчики из main.js.

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, className = 'button') {
  const b = element('button', className, text);
  b.type = 'button';
  return b;
}

// Лист снизу — та же разметка, что у окна события (закрытие свайпом из sheet-swipe.js).
function sheet(title) {
  const overlay = element('div', 'ed-overlay');
  const body = element('div', 'ed-sheet');
  body.append(element('h2', 'ed-title', title));
  overlay.append(body);
  const close = () => {
    overlay.remove();
    document.body.classList.remove('ed-open');
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const open = () => {
    document.body.classList.add('ed-open');
    document.body.append(overlay);
  };
  return { body, close, open };
}

let toastTimer = null;
export function toast(text, isError = false) {
  let node = document.getElementById('st-toast');
  if (!node) {
    node = element('div', 'st-toast');
    node.id = 'st-toast';
    node.setAttribute('role', 'status');
    document.body.append(node);
  }
  node.textContent = text;
  node.dataset.error = String(isError);
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 2200);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function credentialsText(email, password, courseTitle) {
  return `Доступ к курсу «${courseTitle}»\nЛогин: ${email}\nПароль: ${password}`;
}

// Выполнить действие: ошибка — тостом, успех — тостом.
async function run(buttons, action, okText, errText) {
  buttons.forEach((b) => { b.disabled = true; });
  try {
    await action();
    if (okText) toast(okText);
    return true;
  } catch (error) {
    toast(error?.name === 'UnauthorizedError' ? 'Ключ недействителен' : errText, true);
    return false;
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
}

/**
 * Меню долгого тапа — как contextActions(for:) в CourseManagementView:
 * скопировать email, модуль DaVinci (только «Модульное обучение»), блокировка, удаление.
 * ctx: { student, course, courseTitle, isAdmin, handlers }
 */
export function openStudentMenu(ctx) {
  const { student: s, course, isAdmin } = ctx;
  const { body, close, open } = sheet(s.name || s.id);
  body.append(element('p', 'st-menu-sub', s.id));
  const list = element('div', 'st-menu');
  const item = (text, onClick, danger = false) => {
    const b = button(text, `st-menu-item${danger ? ' is-danger' : ''}`);
    b.addEventListener('click', () => { close(); onClick(); });
    list.append(b);
  };
  item('Скопировать email', async () => toast(await copyText(s.id) ? 'Email скопирован' : 'Не удалось скопировать'));
  if (course === 'avanzato') {
    item(s.davinciModule ? 'Закрыть модуль DaVinci' : 'Открыть модуль DaVinci', () => {
      const next = !s.davinciModule;
      run([], () => ctx.handlers.setDavinci(s.id, next),
        next ? 'Модуль DaVinci открыт' : 'Модуль DaVinci закрыт', 'Не удалось изменить доступ к DaVinci');
    });
  }
  if (!isAdmin) {
    item(s.active ? 'Заблокировать' : 'Разблокировать', () => confirmBlock(ctx, s.name || s.id));
    item('Удалить', () => confirmDelete(ctx, `Ученик ${s.name || s.id}`), true);
  }
  const cancel = button('Отмена', 'button st-menu-cancel');
  cancel.addEventListener('click', close);
  body.append(list, cancel);
  open();
}

// Блокировка — с подтверждением; разблокировка — сразу (как в приложении).
export async function confirmBlock(ctx, who) {
  const s = ctx.student;
  if (s.active && !confirm(`Заблокировать доступ?\n\n${who} не сможет войти в курс. Прогресс сохранится, доступ можно вернуть в любой момент.`)) return;
  await run([], () => ctx.handlers.setActive(s.id, !s.active),
    s.active ? 'Доступ заблокирован' : 'Доступ открыт', 'Не удалось изменить доступ');
}

// who: «Ученик Имя» из списка или «Имя» из карточки — тексты как в двух экранах приложения.
export async function confirmDelete(ctx, who, after) {
  if (!confirm(`Удалить ученика?\n\n${who} и весь его прогресс будут удалены. Это действие нельзя отменить.`)) return;
  const ok = await run([], () => ctx.handlers.remove(ctx.student.id), 'Ученик удалён', 'Не удалось удалить ученика');
  if (ok && after) after();
}

export function confirmResetPassword(ctx) {
  if (!confirm('Выдать новый пароль?\n\nСтарый пароль перестанет работать, ученик выйдет из курса на всех устройствах. Прогресс сохранится.')) return;
  resetPassword(ctx);
}

export function openNotesEditor(ctx) {
  const { student: s, handlers } = ctx;
  const { body, close, open } = sheet('Заметки');
  const area = element('textarea', 'ed-input ed-notes');
  area.value = s.notes || '';
  area.rows = 6;
  area.placeholder = 'Заметка об ученике';
  const actions = element('div', 'ed-actions');
  const cancel = button('Отмена');
  const save = button('Сохранить', 'button button--primary');
  cancel.addEventListener('click', close);
  save.addEventListener('click', async () => {
    const ok = await run([save, cancel], () => handlers.saveNotes(s.id, area.value), 'Заметка сохранена', 'Не удалось сохранить заметку');
    if (ok) close();
  });
  actions.append(cancel, save);
  body.append(area, actions);
  open();
}

async function resetPassword(ctx) {
  const { student: s, handlers } = ctx;
  let password = '';
  const ok = await run([], async () => { password = await handlers.resetPassword(s.id); }, null, 'Не удалось сбросить пароль');
  if (!ok) return;
  if (!password) { toast('Пароль сброшен'); return; }
  showCredentials('Новый пароль готов', 'Старый пароль больше не работает', s.id, password, ctx.courseTitle);
}

function showCredentials(title, subtitle, email, password, courseTitle) {
  const { body, close, open } = sheet(title);
  body.append(element('p', 'st-menu-sub', subtitle));
  const card = element('div', 'st-creds');
  card.append(element('span', 'ed-label', 'Логин'), element('b', 'mono', email),
    element('span', 'ed-label', 'Пароль'), element('b', 'mono', password));
  const text = credentialsText(email, password, courseTitle);
  const actions = element('div', 'ed-actions');
  const done = button('Готово');
  done.addEventListener('click', close);
  actions.append(done);
  if (navigator.share) {
    const share = button('Отправить');
    share.addEventListener('click', () => navigator.share({ text }).catch(() => {}));
    actions.append(share);
  }
  const copyBtn = button('Скопировать', 'button button--primary');
  copyBtn.addEventListener('click', async () => {
    toast(await copyText(text) ? 'Логин и пароль скопированы' : 'Не удалось скопировать');
  });
  actions.append(copyBtn);
  body.append(card, actions);
  open();
}

const EMAIL_RE = /^[A-Z0-9a-z._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,64}$/;
const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function generatePassword() {
  const bytes = crypto.getRandomValues(new Uint32Array(10));
  return Array.from(bytes, (n) => PASSWORD_CHARS[n % PASSWORD_CHARS.length]).join('');
}

/**
 * Новый ученик. ctx: { courseTitle, exists(email), create({email,name,password}) }
 */
export function openAddStudent(ctx) {
  const { body, close, open } = sheet(`Новый ученик · ${ctx.courseTitle}`);
  const field = (label, control) => {
    const wrap = element('label', 'ed-field');
    wrap.append(element('span', 'ed-label', label), control);
    return wrap;
  };
  const input = (type, placeholder) => {
    const node = element('input', 'ed-input');
    node.type = type;
    node.placeholder = placeholder;
    node.setAttribute('autocapitalize', 'off');
    node.autocomplete = 'off';
    node.spellcheck = false;
    return node;
  };
  const name = input('text', 'Имя');
  name.setAttribute('autocapitalize', 'words');
  const email = input('email', 'email@example.com');
  const password = input('text', 'Минимум 6 символов');
  password.classList.add('mono');
  const gen = button('Сгенерировать', 'button st-gen');
  const pwRow = element('div', 'ed-row st-pw-row');
  pwRow.append(field('Пароль', password), gen);

  const hint = element('p', 'st-menu-sub', 'После добавления откроется карточка с логином и паролем — их можно сразу скопировать или отправить ученику.');
  const error = element('p', 'ed-error');
  error.hidden = true;
  const actions = element('div', 'ed-actions');
  const cancel = button('Отмена');
  const add = button('Добавить', 'button button--primary');
  cancel.addEventListener('click', close);
  actions.append(cancel, add);

  function validate() {
    const raw = email.value.trim();
    let msg = '';
    if (raw && !EMAIL_RE.test(raw)) msg = 'Введите корректный email';
    else if (raw && ctx.exists(raw.toLowerCase())) msg = 'Такой ученик уже есть. Чтобы выдать новый пароль, используйте «Выдать новый пароль».';
    else if (password.value && password.value.length < 6) msg = 'Минимум 6 символов';
    error.textContent = msg;
    error.hidden = !msg;
    add.disabled = Boolean(msg) || !EMAIL_RE.test(raw) || password.value.length < 6;
  }
  gen.addEventListener('click', () => { password.value = generatePassword(); validate(); });
  [name, email, password].forEach((n) => n.addEventListener('input', validate));
  validate();

  add.addEventListener('click', async () => {
    const data = { email: email.value.trim().toLowerCase(), name: name.value.trim(), password: password.value };
    add.disabled = true;
    cancel.disabled = true;
    add.textContent = 'Добавляю…';
    try {
      await ctx.create(data);
      close();
      showCredentials('Ученик добавлен', 'Отправьте ему данные для входа', data.email, data.password, ctx.courseTitle);
    } catch (err) {
      add.textContent = 'Добавить';
      cancel.disabled = false;
      validate();
      error.textContent = err?.name === 'StudentExistsError' ? err.message : 'Не удалось добавить ученика. Проверьте связь.';
      error.hidden = false;
    }
  });

  body.append(field('Имя', name), field('Email', email), pwRow, hint, error, actions);
  open();
}
