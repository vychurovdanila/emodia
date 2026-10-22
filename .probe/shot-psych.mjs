/**
 * Проверка мобильной разметки экрана психолога (Edge headless + CDP).
 * Запуск: node .probe/shot-psych.mjs <baseUrl> <outDir>
 * Снимает скриншот экрана психолога и печатает геометрию блоков.
 */
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173/';
const OUT = process.argv[3] ?? path.join(process.cwd(), '.probe', 'shots5');
const PORT = process.env.CDP_PORT ?? '9333';
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

const PROBE = `(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const round = (n) => Math.round(n * 10) / 10;
    return { top: round(r.top), bottom: round(r.bottom), w: round(r.width), h: round(r.height) };
  };
  const avatar = document.querySelector('.psychologist-avatar');
  const input = document.querySelector('.chat-input-wrapper');
  const nav = document.querySelector('.bottom-nav');
  return JSON.stringify({
    innerHeight: window.innerHeight,
    visualViewport: window.visualViewport ? Math.round(window.visualViewport.height) : null,
    screen: box('.psychologist-space'),
    portrait: box('.psychologist-portrait-area'),
    avatar: box('.psychologist-avatar'),
    avatarFit: avatar ? { fit: getComputedStyle(avatar).objectFit, pos: getComputedStyle(avatar).objectPosition } : null,
    chat: box('.psychologist-chat-area'),
    input: input ? { top: Math.round(input.getBoundingClientRect().top), bottom: Math.round(input.getBoundingClientRect().bottom) } : null,
    nav: box('.bottom-nav'),
    navState: nav ? Array.from(nav.querySelectorAll('button')).map((b) => b.getAttribute('data-icon') + ':' + (b.querySelector('svg') ? 'svg' : b.querySelector('img') ? 'img' : '—') + ':' + (b.querySelector('svg') ? getComputedStyle(b.querySelector('svg')).color : '—')) : null,
    screenText: document.querySelector('.psychologist-space') ? 'экран психолога' : 'другой экран',
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
await evaluate(`localStorage.setItem('emodia:onboarding:home','1');localStorage.setItem('emodia:onboarding:focusShown','1');localStorage.setItem('emodia:onboarding:holdShown','1');'seeded'`);
await send('Page.reload', { ignoreCache: false });
await sleep(6000);

console.log('── ГЛАВНЫЙ ──');
console.log(await evaluate(PROBE));
await shot('0-main.png');

// Переход на экран психолога кнопкой «Разговоры» в нижней навигации.
await evaluate(`document.querySelector('[data-icon="dialog"]')?.click(), 'clicked'`);
await sleep(1500);

console.log('── ЭКРАН ПСИХОЛОГА ──');
console.log(await evaluate(PROBE));
await shot('1-psychologist.png');

// Проверка keyboard-режима: уменьшаем видимую область (как при открытой клавиатуре).
await trySend('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 500,
  deviceScaleFactor: 2,
  mobile: true,
  screenWidth: 390,
  screenHeight: 844,
});
await sleep(800);
console.log('── ПСИХОЛОГ + КЛАВИАТУРА (видимая высота 500) ──');
console.log(await evaluate(PROBE));
await shot('2-psychologist-keyboard.png');

console.log('── КОНСОЛЬ ──');
console.log(consoleLines.length ? consoleLines.join('\n') : 'пусто');
ws.close();
