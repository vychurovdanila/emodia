/**
 * Геометрия чата на экране психолога: видно ли приветствие целиком.
 * Запуск: node .probe/check-greeting-fit.mjs <baseUrl>
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

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return result.result.value;
};

const PROBE = `(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const round = (n) => Math.round(n * 10) / 10;
    return {
      top: round(r.top), bottom: round(r.bottom), h: round(r.height),
      scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
      scrollTop: Math.round(el.scrollTop),
    };
  };
  return JSON.stringify({
    viewport: window.innerHeight,
    portrait: box('.psychologist-portrait-area'),
    chatArea: box('.psychologist-chat-area'),
    chatContainer: box('.chat-container'),
    messages: box('.chat-messages'),
    greeting: box('.chat-bubble--emotion'),
    input: box('.chat-input-wrapper'),
  }, null, 2);
})()`;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844,
});
await send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, left: 0, right: 0, bottom: 34 } });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

await send('Page.navigate', { url: BASE });
await sleep(3000);
await evaluate(
  `localStorage.setItem('emodia:onboarding:home','1');localStorage.setItem('emodia:onboarding:focusShown','1');localStorage.setItem('emodia:onboarding:holdShown','1');'seeded'`,
);
await send('Page.reload', { ignoreCache: false });
await sleep(6000);
await evaluate(`document.querySelector('[data-icon="dialog"]')?.click(), 'clicked'`);
await sleep(1500);

console.log(await evaluate(PROBE));
ws.close();
