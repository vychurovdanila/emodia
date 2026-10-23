/**
 * Проверка анимации перелёта портрета: тап → полёт в ячейку матрицы,
 * выбор → полёт обратно на место психолога.
 * Запуск: node .probe/check-psych-flight.mjs <baseUrl>
 */
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173/';
const PORT = process.env.CDP_PORT ?? '9333';
const OUT = path.join(process.cwd(), '.probe', 'shots11');
fs.mkdirSync(OUT, { recursive: true });

async function main() {
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


/** Состояние перелёта: где сейчас летящий слой и где его цель. */
const STATE = `(() => {
  const flight = document.querySelector('.psychologist-flight');
  const rect = flight ? flight.getBoundingClientRect() : null;
  const cellImg = document.querySelector('.psychologist-matrix__cell--flying .psychologist-matrix__avatar');
  const cellRect = cellImg ? cellImg.getBoundingClientRect() : null;
  const portrait = document.querySelector('.psychologist-avatar');
  const toBox = (r) =>
    r ? { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null;
  return JSON.stringify({
    flight: toBox(rect),
    cell: toBox(cellRect),
    portrait: toBox(portrait ? portrait.getBoundingClientRect() : null),
    matrixOpen: Boolean(document.querySelector('.psychologist-matrix')),
    chat: Boolean(document.querySelector('.chat-container')),
    alt: portrait ? portrait.alt : null,
  });
})()`;

const sample = async (label, times = 14, gap = 40) => {
  console.log(`\n── ${label} ──`);
  const frames = [];
  for (let i = 0; i < times; i += 1) {
    const state = JSON.parse(await evaluate(STATE));
    frames.push(state.flight);
    if (i === 0 || i === 3 || i === 7 || i === times - 1) {
      console.log(`  кадр ${String(i).padStart(2)}: ${state.flight ? JSON.stringify(state.flight) : 'полёта нет'}`);
    }
    await sleep(gap);
  }
  const last = JSON.parse(await evaluate(STATE));
  console.log(`  цель-ячейка: ${JSON.stringify(last.cell)}, место портрета: ${JSON.stringify(last.portrait)}`);
  console.log(`  матрица: ${last.matrixOpen}, чат: ${last.chat}, портрет: ${last.alt}`);
  const moved = frames.filter(Boolean);
  console.log(`  кадров в полёте: ${moved.length}/${times}`);
  return last;
};

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

console.log('── ДО ТАПА ──');
const before = JSON.parse(await evaluate(STATE));
console.log(`портрет: ${JSON.stringify(before.portrait)}, чат: ${before.chat}, матрица: ${before.matrixOpen}`);

// Тап по портрету → портрет летит в свою ячейку.
await evaluate(`document.querySelector('.psychologist-portrait-area').click(), 'tap'`);
await sample('ПОЛЁТ В МАТРИЦУ (open)', 14, 40);
await shot('0-open-done.png');

// Выбор Марка → портрет летит обратно на место.
await evaluate(`document.querySelector('[data-psychologist-id="mark"]').click(), 'select'`);
await sample('ПОЛЁТ ОБРАТНО (close)', 14, 40);
await shot('1-close-done.png');

// Кадры в середине перелёта: проверяем вид летящего портрета (кроп + маска).
await evaluate(`document.querySelector('.psychologist-portrait-area').click(), 'tap'`);
await sleep(150);
await shot('2-open-mid.png');
await sleep(1400);
await evaluate(`document.querySelector('[data-psychologist-id="mark"]').click(), 'select'`);
await sleep(150);
await shot('3-close-mid.png');
await sleep(1400);

// Вьюпорт изменился (уехала клавиатура), пока матрица открыта: возврат без анимации.
await evaluate(`document.querySelector('.psychologist-portrait-area').click(), 'tap'`);
await sleep(1200);
await trySend('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 744, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 744,
});
await sleep(400);
await evaluate(`document.querySelector('[data-psychologist-id="nina"]').click(), 'select'`);
await sleep(60);
const resized = JSON.parse(await evaluate(STATE));
console.log('\n── ВЬЮПОРТ ИЗМЕНИЛСЯ ──');
console.log(
  `полёт: ${resized.flight ? 'есть' : 'нет (мгновенный переход)'}, матрица: ${resized.matrixOpen}, ` +
    `чат: ${resized.chat}, портрет: ${resized.alt}`,
);
await sleep(600);
await shot('4-resized.png');
await trySend('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844,
});

console.log('\n── КОНСОЛЬ ──');
console.log(consoleLines.length ? consoleLines.join('\n') : 'пусто');
ws.close();
}
main();
