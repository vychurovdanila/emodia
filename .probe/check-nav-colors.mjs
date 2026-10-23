/**
 * Проверка цвета иконок нижней навигации: на экране психолога «главная»
 * должна быть того же цвета, что и неактивные explore/user.
 * Запуск: node .probe/check-nav-colors.mjs <baseUrl>
 */
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173/';
const PORT = process.env.CDP_PORT ?? '9333';
const OUT = path.join(process.cwd(), '.probe', 'shots8');
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

const shot = async (name) => {
  const result = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(result.data, 'base64'));
};

/** Фактические цвета заливок каждой иконки навигации. */
const PROBE = `(() => {
  const out = {};
  document.querySelectorAll('.bottom-nav button').forEach((btn) => {
    const key = btn.getAttribute('data-icon');
    const svg = btn.querySelector('svg');
    const img = btn.querySelector('img');
    if (svg) {
      const fills = new Set();
      svg.querySelectorAll('path,circle,rect,polygon,line').forEach((el) => {
        const f = getComputedStyle(el).fill;
        fills.add(f);
      });
      out[key] = { type: 'svg', computedColor: getComputedStyle(svg).color, fills: Array.from(fills) };
    } else if (img) {
      out[key] = { type: 'img', src: img.getAttribute('src') };
    } else {
      out[key] = { type: 'none' };
    }
  });
  return JSON.stringify(out);
})()`;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
  screenWidth: 390,
  screenHeight: 844,
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

console.log('── ЭКРАН ЭМОЦИЙ ──');
console.log(await evaluate(PROBE));

await evaluate(`document.querySelector('[data-icon="dialog"]')?.click(), 'clicked'`);
await sleep(1500);

console.log('\n── ЭКРАН ПСИХОЛОГА (main должен совпадать с explore/user) ──');
const nav = JSON.parse(await evaluate(PROBE));
console.log(JSON.stringify(nav, null, 2));
await shot('0-psychologist-nav.png');

const mainFill = nav.main?.fills?.[0];
const exploreFill = nav.explore?.fills?.[0];
const userFill = nav.user?.fills?.[0];
console.log(
  `\nmain=${mainFill} explore=${exploreFill} user=${userFill} → ` +
    (mainFill === exploreFill && mainFill === userFill ? 'СОВПАДАЮТ' : 'РАЗЛИЧАЮТСЯ'),
);
ws.close();
