// Листы (правка, настройки) закрываются свайпом вниз, как в iOS.
// Закрытие идёт тем же путём, что и тап по фону: клик по самому overlay —
// так каждое окно само убирает своё состояние.

function attach(overlay) {
  const sheet = overlay.querySelector('.ed-sheet');
  if (!sheet || sheet.dataset.swipe) return;
  sheet.dataset.swipe = '1';

  let startY = null;
  let startT = 0;
  let dy = 0;
  let dragging = false;

  sheet.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    // Тянуть можно только когда содержимое листа прокручено к началу.
    if (sheet.scrollTop > 0) { startY = null; return; }
    startY = e.touches[0].clientY;
    startT = Date.now();
    dy = 0;
    dragging = false;
  }, { passive: true });

  sheet.addEventListener('touchmove', (e) => {
    if (startY === null) return;
    dy = e.touches[0].clientY - startY;
    if (!dragging) {
      if (dy < 6) { if (dy < -6) startY = null; return; }
      if (e.target.closest('input, textarea, select') && document.activeElement === e.target) { startY = null; return; }
      dragging = true;
      sheet.style.transition = 'none';
      sheet.style.animation = 'none';
    }
    e.preventDefault();
    const y = Math.max(0, dy);
    sheet.style.transform = `translateY(${y}px)`;
    overlay.style.backgroundColor = `rgba(0, 0, 0, ${Math.max(0, 0.45 - y / 900)})`;
  }, { passive: false });

  sheet.addEventListener('touchend', () => {
    if (!dragging) { startY = null; return; }
    const fast = dy > 40 && dy / Math.max(1, Date.now() - startT) > 0.5;
    const close = dy > 120 || fast;
    sheet.style.transition = 'transform .35s cubic-bezier(.2, .9, .25, 1)';
    if (close) {
      sheet.style.transform = 'translateY(110%)';
      overlay.style.transition = 'background-color .3s';
      overlay.style.backgroundColor = 'rgba(0, 0, 0, 0)';
      setTimeout(() => overlay.dispatchEvent(new MouseEvent('click', { bubbles: true })), 260);
    } else {
      sheet.style.transform = '';
      overlay.style.backgroundColor = '';
    }
    startY = null;
    dragging = false;
  });
}

new MutationObserver((records) => {
  for (const r of records) {
    for (const node of r.addedNodes) {
      if (node.nodeType === 1 && node.classList.contains('ed-overlay')) attach(node);
    }
  }
}).observe(document.body, { childList: true });
