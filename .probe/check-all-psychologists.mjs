/**
 * Проверка: все психологи из PSYCHOLOGISTS доступны на экране диалога —
 * свайп по портрету перебирает их по кругу, портрет грузится, приветствие и цвет иконки меняются.
 * Запуск: node .probe/check-all-psychologists.mjs <baseUrl> [сколько проверить]
 */
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173/';
const EXPECTED = Number(process.argv[3] ?? 12);
const PORT = process.env.CDP_PORT ?? '9333';
const OUT = path.join(process.cwd(), '.probe', 'shots7');
fs.mkdirSync(OUT, { recursive: true });

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = list.find((t) => t.type === 'page');
if (!target) throw new Error('нет page-таргета: ' + JSON.stringify(list));

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
  if (msg.method === 'Log.entryAdded') {
    consoleLines.push(`${msg.params.entry.level}: ${msg.params.entry.text}`);
  }
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
  } catch (error) {
    consoleLines.push(`cdp-warn: ${method} → ${error.message}`);
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

/** Снимок текущего состояния экрана психолога. */
const PROBE = `(() => {
  const img = document.querySelector('.psychologist-avatar');
  const bubble = document.querySelector('.chat-bubble--emotion');
  const nav = document.querySelector('[data-icon="dialog"]');
  const icon = nav?.querySelector('svg');
  return JSON.stringify({
    name: img ? img.alt : null,
    src: img ? img.getAttribute('src') : null,
    loaded: img ? img.complete && img.naturalWidth > 0 : false,
    greeting: bubble ? (bubble.textContent || '').trim() : null,
    navColor: icon ? getComputedStyle(icon).color : null,
  });
})()`;

/** Свайп влево по портрету → следующий психолог. */
const swipeNext = `(() => {
  const el = document.querySelector('.psychologist-portrait-area');
  if (!el) return 'no-area';
  const touch = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: 200 });
  el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch(300)], changedTouches: [touch(300)] }));
  el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], changedTouches: [touch(100)] }));
  return 'swiped';
})()`;

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await trySend('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
  screenWidth: 390,
  screenHeight: 844,
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
await sleep(1500);

const seen = [];
for (let i = 0; i < EXPECTED; i += 1) {
  const state = JSON.parse(await evaluate(PROBE));
  // Приветствие должно начинаться с «Привет, я <Имя>, <аннотация>…» и быть своим у каждого.
  const greetOk = Boolean(state.greeting && state.name && state.greeting.startsWith(`Привет, я ${state.name},`));
  const intro = state.greeting ? state.greeting.split('.')[0] + '.' : '';
  seen.push({ ...state, greetOk, intro });
  console.log(
    `${String(i + 1).padStart(2, '0')}. ${String(state.name).padEnd(8)} portrait=${state.loaded ? 'OK  ' : 'FAIL'} ` +
      `greeting=${greetOk ? 'OK' : 'FAIL'} color=${state.navColor}\n     ${intro}`,
  );
  if (i === 0) await shot('0-first.png');
  if (i === 1) await shot('1-second.png');
  if (i === EXPECTED - 1) await shot('2-last.png');
  if (i < EXPECTED - 1) {
    await evaluate(swipeNext);
    await sleep(700);
  }
}

const names = seen.map((s) => s.name);
const unique = new Set(names);
const uniqueGreetings = new Set(seen.map((s) => s.intro));
const broken = seen.filter((s) => !s.loaded || !s.greetOk);
console.log('\n── ИТОГ ──');
console.log(`уникальных психологов в обходе: ${unique.size} (ожидалось ${EXPECTED})`);
console.log(`уникальных приветствий: ${uniqueGreetings.size} (ожидалось ${EXPECTED})`);
console.log(`сломанных портретов/приветствий: ${broken.length}`);

// Контрольный свайп с последнего — должен вернуться к первому (цикл).
await evaluate(swipeNext);
await sleep(700);
const wrapped = JSON.parse(await evaluate(PROBE));
console.log(`после свайпа с последнего: ${wrapped.name} (ожидался ${names[0]})`);

console.log('\n── КОНСОЛЬ ──');
console.log(consoleLines.length ? consoleLines.join('\n') : 'пусто');
ws.close();
