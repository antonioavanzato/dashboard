// Точечные сводки в духе «года точками» на главной.
// Только показывают данные, которые уже загружены, — сеть здесь не трогается.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const DAY_MS = 864e5;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayLabel = (d) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', weekday: 'short' }).format(d).replace('.', '');

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/**
 * Заявки за 30 дней: точка = день, ярче = больше заявок, красная = среди них есть новая.
 * Нажатие на точку — подпись «день · N заявок» под полосой.
 */
export function renderOrderDots(container, orders) {
  if (!container) return;
  const today = startOfDay(new Date());
  const days = Array.from({ length: 30 }, (_, i) => ({ date: new Date(today - (29 - i) * DAY_MS), count: 0, fresh: false }));
  for (const o of orders) {
    const d = new Date(o.created_at);
    if (Number.isNaN(d.getTime())) continue;
    const idx = 29 - Math.round((today - startOfDay(d)) / DAY_MS);
    if (idx < 0 || idx > 29) continue;
    days[idx].count += 1;
    if (o.status === 'new') days[idx].fresh = true;
  }
  const total = days.reduce((s, d) => s + d.count, 0);
  const keep = container.dataset.picked;

  const head = el('div', 'dots-head');
  head.append(el('span', 'label', 'Заявки · 30 дней'), el('span', 'mono sub', String(total)));
  const grid = el('div', 'dots dots--strip');
  const caption = el('p', 'dots-caption');
  const show = (i) => {
    const d = days[i];
    caption.textContent = `${dayLabel(d.date)} · ${d.count ? `${d.count} ${plural(d.count, 'заявка', 'заявки', 'заявок')}` : 'заявок нет'}`;
    grid.querySelectorAll('i').forEach((n, k) => n.classList.toggle('is-picked', k === i));
    container.dataset.picked = String(i);
  };
  days.forEach((d, i) => {
    const dot = el('i');
    if (d.fresh) dot.className = 'is-new';
    else if (d.count >= 2) dot.className = 'past';
    else if (d.count === 1) dot.className = 'is-one';
    if (i === 29) dot.classList.add('is-today');
    dot.addEventListener('click', () => show(i));
    grid.append(dot);
  });
  container.replaceChildren(head, grid, caption);
  show(keep !== undefined ? Number(keep) : 29);
}
