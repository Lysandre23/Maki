import { VIEW_W, VIEW_H } from '../config.js';

export const input = {
  keys: new Set(),
  pressed: new Set(), // one-shot keys, cleared each tick
  mx: VIEW_W / 2,     // mouse, in view cells
  my: VIEW_H / 2,
  down: [false, false, false],
  clicks: [],         // mouse presses since last tick: { b, shift, ctrl }
};

const BLOCK = new Set([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'f3', 'tab']);

export function initInput(el) {
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    input.keys.add(k);
    if (!e.repeat) input.pressed.add(k);
    if (BLOCK.has(k)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => input.keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => { input.keys.clear(); input.down.fill(false); });

  const pos = (e) => {
    const r = el.getBoundingClientRect();
    input.mx = ((e.clientX - r.left) * VIEW_W) / r.width;
    input.my = ((e.clientY - r.top) * VIEW_H) / r.height;
  };
  window.addEventListener('mousemove', pos);
  el.addEventListener('mousedown', (e) => {
    pos(e);
    input.down[e.button] = true;
    input.clicks.push({ b: e.button, shift: e.shiftKey, ctrl: e.ctrlKey });
  });
  window.addEventListener('mouseup', (e) => { input.down[e.button] = false; });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
