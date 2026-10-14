// Чистая логика списка заявок: ни сети, ни DOM.
// Повторяет filteredRequests из BookingRequestsScreen.swift.
import { ARCHIVE_STATUS_IDS } from './status.js';

export function isArchived(order) {
  return ARCHIVE_STATUS_IDS.includes(order.status);
}

export function activeOrders(all) {
  return all.filter((o) => !isArchived(o));
}

export function archivedOrders(all) {
  return all.filter(isArchived);
}

export function filterOrders(all, { archive, statusId }) {
  if (archive) return archivedOrders(all);
  const active = activeOrders(all);
  return statusId ? active.filter((o) => o.status === statusId) : active;
}

export function countsByStatus(all) {
  const counts = {};
  for (const order of activeOrders(all)) {
    counts[order.status] = (counts[order.status] || 0) + 1;
  }
  return counts;
}

export function subtitleText(all) {
  const active = activeOrders(all);
  const newCount = active.filter((o) => o.status === 'new').length;
  return newCount > 0
    ? `Активных: ${active.length} · Новых: ${newCount}`
    : `Активных: ${active.length}`;
}

// Дата приходит строкой "DD.MM.YYYY". Разбор повторяет
// SDBookingRequest.dateObject, включая однозначные день и месяц.
export function parseOrderDate(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match.map(Number);
  const date = new Date(year, month - 1, day);
  // Отсекаем несуществующие даты вроде 31.02: конструктор их переносит.
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

const BUCKET_ORDER = ['overdue', 'today', 'tomorrow', 'thisWeek', 'later', 'noDate'];

export const BUCKET_TITLES = {
  overdue: 'Прошедшие',
  today: 'Сегодня',
  tomorrow: 'Завтра',
  thisWeek: 'На этой неделе',
  later: 'Позже',
  noDate: 'Без даты',
};

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Порядок проверок повторяет bucket(for:) из BookingRequestsScreen.swift.
export function bucketFor(date, now) {
  if (!date) return 'noDate';
  const today = startOfDay(now);
  const target = startOfDay(date);
  const days = Math.round((target - today) / DAY_MS);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 0) return 'overdue';
  return days <= 7 ? 'thisWeek' : 'later';
}

export function groupByDate(orders, now) {
  const groups = new Map();
  for (const order of orders) {
    const bucket = bucketFor(parseOrderDate(order.date), now);
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket).push(order);
  }
  return BUCKET_ORDER.filter((bucket) => groups.has(bucket)).map((bucket) => ({
    bucket,
    title: BUCKET_TITLES[bucket],
    items: groups.get(bucket).sort((a, b) => {
      const da = parseOrderDate(a.date);
      const db = parseOrderDate(b.date);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da - db;
    }),
  }));
}
