/**
 * Сравнение положения поля ввода в чате эмоции и в чате психолога.
 * Запуск: node .probe/check-input-pos.mjs <baseUrl>
 */
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173/';
const PORT = process.env.CDP_PORT ?? '9333';

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
const trySend = (m, p) => send(m, p).catch(() => null);
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result.value;
};
const tap = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'touch' });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, pointerType: 'touch' });
};

const INPUT_BOX = `(() => {
  const el = document.querySelector('.chat-input-wrapper');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), screen: window.innerHeight };
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
await evaluate(`localStorage.setItem('emodia:onboarding:home','1');localStorage.setItem('emodia:onboarding:focusShown','1');localStorage.setItem('emodia:onboarding:holdShown','1');'seeded'`);
await send('Page.reload', { ignoreCache: false });
await sleep(6000);

// 1) Экран психолога (без фокуса клик по «Разговоры» ведёт туда)
await evaluate(`document.querySelector('[data-icon="dialog"]')?.click(), 'ok'`);
await sleep(1200);
const psych = await evaluate(INPUT_BOX);
console.log('психолог:', JSON.stringify(psych));

await evaluate(`(() => {
  const el = document.querySelector('.psychologist-chat-area');
  return JSON.stringify({ marginBottom: el ? getComputedStyle(el).marginBottom : null });
})()`).then((v) => console.log('  chat-area:', v));

// 2) Назад на эмоции, фокус на шарике, открыть чат эмоции
await evaluate(`document.querySelector('[data-icon="main"]')?.click(), 'ok'`);
await sleep(1200);

let focused = false;
outer: for (const yRatio of [0.3, 0.42, 0.52, 0.62, 0.72, 0.22]) {
  for (const xRatio of [0.5, 0.3, 0.7, 0.18, 0.82]) {
    await tap(Math.round(390 * xRatio), Math.round(844 * yRatio));
    await sleep(800);
    if (await evaluate(`!!document.querySelector('.focus-header')`)) {
      focused = true;
      break outer;
    }
  }
}
console.log('фокус найден:', focused);

await evaluate(`document.querySelector('[data-icon="dialog"]')?.click(), 'ok'`);
await sleep(1200);
const emotion = await evaluate(INPUT_BOX);
console.log('эмоция:', JSON.stringify(emotion));

console.log(
  'разница (психолог − эмоция):',
  psych && emotion ? psych.bottom - emotion.bottom + 'px' : 'н/д',
);
ws.close();
