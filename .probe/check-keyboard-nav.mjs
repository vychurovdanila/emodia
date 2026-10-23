/**
 * Проверка поведения при открытой экранной клавиатуре:
 * навигация скрыта, поле ввода прижато к клавиатуре с небольшим отступом.
 * Запуск: node .probe/check-keyboard-nav.mjs <baseUrl>
 */
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173/';
const PORT = process.env.CDP_PORT ?? '9333';
const OUT = path.join(process.cwd(), '.probe', 'shots9');
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
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
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

const PROBE = `(() => {
  const nav = document.querySelector('.bottom-nav');
  const input = document.querySelector('.chat-input-wrapper');
  const greeting = document.querySelector('.chat-bubble--emotion');
  const messages = document.querySelector('.chat-messages');
  const round = (n) => Math.round(n * 10) / 10;
  const rect = (el) => (el ? { top: round(el.getBoundingClientRect().top), bottom: round(el.getBoundingClientRect().bottom), h: round(el.getBoundingClientRect().height) } : null);
  return JSON.stringify({
    innerHeight: window.innerHeight,
    keyboardClass: document.documentElement.classList.contains('keyboard-open'),
    navDisplay: nav ? getComputedStyle(nav).display : null,
    navVisible: nav ? nav.getBoundingClientRect().height > 0 && getComputedStyle(nav).display !== 'none' : false,
    portrait: rect(document.querySelector('.psychologist-portrait-area')),
    chatArea: rect(document.querySelector('.psychologist-chat-area')),
    chatContainer: rect(document.querySelector('.chat-container')),
    input: rect(input),
    greetingHidden: greeting ? greeting.getBoundingClientRect().bottom > (input ? input.getBoundingClientRect().top : 0) : null,
    messagesScroll: messages ? { scrollTop: Math.round(messages.scrollTop), scrollHeight: messages.scrollHeight, clientHeight: messages.clientHeight } : null,
  });
})()`;

await send('Page.enable');
await send('Runtime.enable');
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
console.log('── ПСИХОЛОГ, КЛАВИАТУРЫ НЕТ ──');
console.log(await evaluate(PROBE));
await shot('0-no-keyboard.png');

// Имитируем открытие клавиатуры: видимая область 500px.
await trySend('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 500, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844,
});
await sleep(900);
console.log('\n── ПСИХОЛОГ + КЛАВИАТУРА (500) ──');
console.log(await evaluate(PROBE));
await shot('1-keyboard.png');

// Проверяем, что правило для чата эмоции тоже применяется (padding-bottom панели).
console.log(
  'эмоция, padding-bottom .emotion-panel при клавиатуре: ' +
    (await evaluate(`(() => {
      const probe = document.createElement('div');
      probe.className = 'emotion-panel';
      document.body.appendChild(probe);
      const value = getComputedStyle(probe).paddingBottom;
      probe.remove();
      return value;
    })()`)),
);

// Возвращаемся к полной высоте — навигация должна вернуться.
await trySend('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844,
});
await sleep(900);
console.log('\n── ПОСЛЕ ЗАКРЫТИЯ КЛАВИАТУРЫ ──');
console.log(await evaluate(PROBE));
await shot('2-after.png');

ws.close();
