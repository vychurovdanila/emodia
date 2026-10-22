/**
 * Проверка: кнопка «назад» полностью убрана с экрана психолога,
 * а выход обратно на экран эмоций через нижнюю навигацию работает.
 * Запуск: node .probe/check-back-removed.mjs <baseUrl>
 */
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173/';
const PORT = process.env.CDP_PORT ?? '9333';

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

const PROBE = `(() => {
  const backByClass = document.querySelector('.psychologist-back-btn');
  const backByAria = document.querySelector('[aria-label*="Назад"]');
  const backByText = Array.from(document.querySelectorAll('.psychologist-portrait-area button'))
    .map((b) => (b.textContent || '').trim())
    .filter((t) => t.includes('\\u2190'));
  return JSON.stringify({
    screen: document.querySelector('.psychologist-space') ? 'психолог' : document.querySelector('.emotion-space') ? 'эмоции' : 'неизвестно',
    backBtnInDom: Boolean(backByClass),
    backByAriaLabel: Boolean(backByAria),
    backArrowButtons: backByText,
    portraitChildren: Array.from(document.querySelectorAll('.psychologist-portrait-area > *')).map((el) => el.tagName.toLowerCase()),
    inputBottom: Math.round(document.querySelector('.chat-input-wrapper')?.getBoundingClientRect().bottom ?? -1),
    navBottom: Math.round(document.querySelector('.bottom-nav')?.getBoundingClientRect().bottom ?? -1),
  });
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

// Переход на экран психолога кнопкой «Разговоры».
await evaluate(`document.querySelector('[data-icon="dialog"]')?.click(), 'clicked'`);
await sleep(1500);
console.log('── ЭКРАН ПСИХОЛОГА ──');
console.log(await evaluate(PROBE));

// Выход с экрана только нижней навигацией: кнопка «главная».
await evaluate(`document.querySelector('[data-icon="main"]')?.click(), 'clicked'`);
await sleep(1200);
console.log('── ПОСЛЕ КЛИКА ПО «ГЛАВНОЙ» ──');
console.log(await evaluate(PROBE));

console.log('── КОНСОЛЬ ──');
console.log(consoleLines.length ? consoleLines.join('\n') : 'пусто');
ws.close();
