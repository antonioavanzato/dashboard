// Сеть. Роуты и заголовок повторяют BookingRequestsSyncService.swift:
// маршрут передаётся query-параметром ?r=, ключ — заголовком X-Api-Key.
const BASE_URL = 'https://functions.yandexcloud.net/d4e2uuvutkn0qcqevb9j';

export class UnauthorizedError extends Error {
  constructor() {
    super('Ключ недействителен');
    this.name = 'UnauthorizedError';
  }
}

export class StudentExistsError extends Error {
  constructor() {
    super('Такой ученик уже есть. Чтобы выдать новый пароль, используйте «Новый пароль».');
    this.name = 'StudentExistsError';
  }
}

async function request(key, route, { method = 'GET', body, query = {} } = {}) {
  let url = `${BASE_URL}?r=${encodeURIComponent(route)}`;
  for (const [name, value] of Object.entries(query)) url += `&${name}=${encodeURIComponent(value)}`;
  const options = {
    method,
    headers: { 'X-Api-Key': key },
  };
  if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error('Нет связи с сервером');
  }
  if (response.status === 401) throw new UnauthorizedError();
  // 409 на добавление ученика: сервер не трогает существующего (иначе обнулился бы прогресс).
  if (response.status === 409 && method === 'POST' && route === 'students') throw new StudentExistsError();
  if (!response.ok) throw new Error(`Сервер ответил ${response.status}`);
  return response;
}

export async function listOrders(key) {
  const response = await request(key, 'orders');
  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error('Сервер вернул неожиданный ответ');
  }
  return Array.isArray(data) ? data : [];
}

export async function setOrderStatus(key, id, statusId) {
  await request(key, `orders/${id}`, { method: 'PATCH', body: { status: statusId } });
}

export async function deleteOrder(key, id) {
  await request(key, `orders/${id}`, { method: 'DELETE' });
}

// Планер — тот же маршрут, что опрашивает приложение (EventsSyncService.poll).
export async function listEvents(key) {
  const response = await request(key, 'events');
  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error('Сервер вернул неожиданный ответ');
  }
  return Array.isArray(data) ? data : [];
}

// Создание/правка события — тот же POST, что EventsSyncService.upsert в приложении.
// Облако делает полный UPSERT, поэтому тело всегда собирается целиком (planner.js).
export async function saveEvent(key, body) {
  await request(key, 'events', { method: 'POST', body });
}

// Ученики курса — тот же GET, что CourseCloudClient.fetchStudents в приложении
// (course: "avanzato" | "davinci").
export async function listStudents(key, course) {
  const response = await request(key, 'students', { query: { course } });
  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error('Сервер вернул неожиданный ответ');
  }
  return Array.isArray(data) ? data : [];
}

// Управление учениками — один в один с CourseCloudClient в приложении.
// Каждый PATCH меняет ровно одно поле; прогресс ученика эти запросы не трогают.
const studentRoute = (email) => `students/${String(email).toLowerCase()}`;

export async function patchStudent(key, course, email, body) {
  return request(key, studentRoute(email), { method: 'PATCH', body, query: { course } });
}

export async function createStudent(key, course, { email, name, password }) {
  await request(key, 'students', { method: 'POST', body: { email, name: name || '', password }, query: { course } });
}

export async function deleteStudent(key, course, email) {
  await request(key, studentRoute(email), { method: 'DELETE', query: { course } });
}

// Новый пароль генерирует сервер и возвращает его в ответе.
export async function resetStudentPassword(key, course, email) {
  const response = await patchStudent(key, course, email, { reset_password: true });
  try {
    const data = await response.json();
    return (data && data.password) || '';
  } catch {
    return '';
  }
}
