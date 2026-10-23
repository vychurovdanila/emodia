/**
 * Проверка матрицы психологов: тап по портрету открывает сетку 3 × 4,
 * выбор психолога закрывает матрицу и возвращает чат с ним.
 * Запуск: node .probe/check-psych-matrix.mjs <baseUrl>
 */
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173/';
const PORT = process.env.CDP_PORT ?? '9333';
const OUT = path.join(process.cwd(), '.probe', 'shots10');
fs.mkdirSync(OUT, { recursive: true });

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = list.find((t) => t.type === 'page');
if (!target) throw new Error('нет page-таргета');

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve);
  ws.addEventListener('error', reject);
});

let seq = 0;
const pending = new Map();
const consoleLines = [];
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleLines.push('exception: ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text));
  }
  if (msg.method === 'Log.entryAdded') consoleLines.push(`${msg.params.entry.level}: ${msg.params.entry.text}`);
});

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

const trySend = async (method, params) => {
  try {
    return await send(method, params);
  } catch {
    return null;
  }
};

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return result.result.value;
};

const shot = async (name) => {
  const result = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(result.data, 'base64'));
};


const STATE = `(() => {
  const matrix = document.querySelector('.psychologist-matrix');
  const cells = Array.from(document.querySelectorAll('.psychologist-matrix__cell')).map((cell) => {
    const img = cell.querySelector('img');
    const style = getComputedStyle(cell);
    return {
      id: cell.getAttribute('data-psychologist-id'),
      row: style.gridRowStart,
      col: style.gridColumnStart,
      active: cell.classList.contains('psychologist-matrix__cell--active'),
      loaded: img ? img.complete && img.naturalWidth > 0 : false,
      label: cell.getAttribute('aria-label'),
    };
  });
  const avatar = document.querySelector('.psychologist-avatar');
  const bubble = document.querySelector('.chat-bubble--emotion');
  const matrixAvatar = document.querySelector('.psychologist-matrix__avatar');
  const firstCell = document.querySelector('.psychologist-matrix__cell');
  const cellRect = firstCell ? firstCell.getBoundingClientRect() : null;
  return JSON.stringify({
    matrixOpen: Boolean(matrix),
    matrixHeight: matrix ? Math.round(matrix.getBoundingClientRect().height) : null,
    cell: cellRect ? Math.round(cellRect.width) + 'x' + Math.round(cellRect.height) : null,
    mask: matrixAvatar ? getComputedStyle(matrixAvatar).maskImage : null,
    cellsCount: cells.length,
    cells,
    chatWidget: Boolean(document.querySelector('.chat-container')),
    input: Boolean(document.querySelector('.chat-input-wrapper')),
    portrait: avatar ? avatar.alt : null,
    greeting: bubble ? (bubble.textContent || '').trim().slice(0, 60) : null,
  });
})()`;

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await trySend('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844,
});
await trySend('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, left: 0, right: 0, bottom: 34 } });
await trySend('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

await send('Page.navigate', { url: BASE });
await sleep(3000);
await evaluate(
  `localStorage.setItem('emodia:onboarding:home','1');localStorage.setItem('emodia:onboarding:focusShown','1');localStorage.setItem('emodia:onboarding:holdShown','1');'seeded'`,
);
await send('Page.reload', { ignoreCache: false });
await sleep(6000);

await evaluate(`document.querySelector('[data-icon="dialog"]')?.click(), 'clicked'`);
await sleep(1200);

/** Свайп по портрету: должен листать психолога, а не открывать матрицу. */
const swipe = async (fromX, toX) => {
  const y = 300;
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y }] });
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: (fromX + toX) / 2, y }] });
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: toX, y }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(600);
};

await swipe(300, 100);
const afterSwipe = JSON.parse(await evaluate(STATE));
console.log('── СВАЙП ВЛЕВО (портрет) ──');
console.log(`портрет: ${afterSwipe.portrait}, матрица: ${afterSwipe.matrixOpen} (ожидаем: Лина, false)`);
await swipe(100, 300);
const afterSwipeBack = JSON.parse(await evaluate(STATE));
console.log(`свайп обратно → портрет: ${afterSwipeBack.portrait}, матрица: ${afterSwipeBack.matrixOpen} (ожидаем: Вера, false)`);

console.log('\n── ДО ТАПА (портрет + чат) ──');
console.log(await evaluate(STATE));

// Тап по портрету → матрица.
await evaluate(`document.querySelector('.psychologist-portrait-area').click(), 'tap'`);
await sleep(800);
const opened = JSON.parse(await evaluate(STATE));
console.log('\n── ПОСЛЕ ТАПА (матрица) ──');
console.log(`матрица: ${opened.matrixOpen}, ячеек: ${opened.cellsCount}, чат-виджет: ${opened.chatWidget}, поле ввода: ${opened.input}`);
console.log(`высота матрицы: ${opened.matrixHeight}px, ячейка: ${opened.cell}`);
console.log(`mask: ${opened.mask}`);
console.log(`активная ячейка: ${opened.cells.filter((c) => c.active).map((c) => c.id).join(', ')}`);
opened.cells.forEach((c) => {
  console.log(`  ${String(c.id).padEnd(8)} row=${c.row} col=${c.col} active=${c.active ? 'да ' : 'нет'} portrait=${c.loaded ? 'OK' : 'FAIL'}  ${c.label}`);
});
await shot('0-matrix.png');

// Выбор другого психолога → матрица исчезает, чат с ним.
await evaluate(`document.querySelector('[data-psychologist-id="mark"]').click(), 'select'`);
await sleep(900);
const selected = JSON.parse(await evaluate(STATE));
console.log('\n── ПОСЛЕ ВЫБОРА МАРКА ──');
console.log(
  `матрица: ${selected.matrixOpen}, чат-виджет: ${selected.chatWidget}, поле ввода: ${selected.input}, ` +
    `портрет: ${selected.portrait}, приветствие: ${selected.greeting}`,
);
await shot('1-selected.png');

// Повторное открытие: текущий психолог (Марк) стоит на своём месте.
await evaluate(`document.querySelector('.psychologist-portrait-area').click(), 'tap'`);
await sleep(800);
const reopened = JSON.parse(await evaluate(STATE));
const active = reopened.cells.filter((c) => c.active);
console.log('\n── МАТРИЦА СНОВА, ТЕКУЩИЙ ПСИХОЛОГ ──');
console.log(`активная ячейка: ${active.map((c) => `${c.id} (row=${c.row}, col=${c.col})`).join(', ')}`);
await shot('2-matrix-active-mark.png');

console.log('\n── КОНСОЛЬ ──');
console.log(consoleLines.length ? consoleLines.join('\n') : 'пусто');
ws.close();
