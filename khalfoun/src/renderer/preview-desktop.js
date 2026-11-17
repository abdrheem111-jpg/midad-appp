// Browser preview only: two pretend app windows that can be dragged by their
// title bar, so walking on windows can be tried (and tested) without Windows.
// Reports the windows top-most first, like the real Windows helper does.

const DEFAULTS = [
  { id: 'notes', title: 'المفكرة', x: 140, y: 250, w: 460, h: 300, body: 'ملاحظات الدرس: الكسور والأعداد العشرية' },
  { id: 'browser', title: 'المتصفح', x: 640, y: 380, w: 520, h: 280, body: 'www.google.com' },
];

export function createPreviewDesktop(parent, onChange) {
  const wins = DEFAULTS.map((w) => ({ ...w }));
  let order = wins.map((w) => w.id).reverse(); // top-most first
  let enabled = true;
  const els = new Map();

  const report = () => {
    if (!enabled) return;
    onChange(order.map((id) => wins.find((w) => w.id === id)).map(({ id, x, y, w, h }) => ({ id, x, y, w, h })));
  };

  const restack = () => {
    order.forEach((id, i) => { els.get(id).style.zIndex = String(3 - Math.min(i, 2)); });
  };

  for (const w of wins) {
    const el = document.createElement('div');
    el.className = 'fake-window';
    el.dataset.id = w.id;
    const bar = document.createElement('div');
    bar.className = 'fake-bar';
    bar.textContent = w.title;
    const body = document.createElement('div');
    body.className = 'fake-body';
    body.textContent = w.body;
    el.append(bar, body);
    parent.prepend(el);
    els.set(w.id, el);
    const place = () => {
      el.style.transform = `translate(${w.x}px, ${w.y}px)`;
      el.style.width = `${w.w}px`;
      el.style.height = `${w.h}px`;
    };
    place();
    let drag = null;
    el.addEventListener('pointerdown', () => {
      order = [w.id, ...order.filter((id) => id !== w.id)];
      restack();
      report();
    });
    bar.addEventListener('pointerdown', (e) => {
      bar.setPointerCapture(e.pointerId);
      drag = { dx: e.clientX - w.x, dy: e.clientY - w.y };
    });
    bar.addEventListener('pointermove', (e) => {
      if (!drag) return;
      w.x = Math.round(e.clientX - drag.dx);
      w.y = Math.max(0, Math.round(e.clientY - drag.dy));
      place();
      report();
    });
    const end = () => { drag = null; };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
  }
  restack();
  report();

  return {
    setEnabled(on) {
      enabled = on;
      for (const el of els.values()) el.hidden = !on;
      if (on) report(); else onChange([]);
    },
    /** Test helper: move a window instantly. */
    move(id, x, y) {
      const w = wins.find((v) => v.id === id);
      if (!w) return;
      w.x = x; w.y = y;
      els.get(id).style.transform = `translate(${x}px, ${y}px)`;
      report();
    },
    close(id) {
      const el = els.get(id);
      if (el) el.hidden = true;
      order = order.filter((v) => v !== id);
      report();
    },
    get windows() { return order.map((id) => ({ ...wins.find((w) => w.id === id) })); },
  };
}
