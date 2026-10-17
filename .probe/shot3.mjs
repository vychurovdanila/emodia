/**
 * Проверка мобильной разметки в реальном браузере (Edge headless + CDP).
 * Ничего не устанавливает: node 24 (global WebSocket) + системный Edge.
 *
 * Запуск: node .probe/shot3.mjs <baseUrl> <outDir>
 * Скрипт снимает состояния (главный / фокус / захват), печатает геометрию
 * DOM-блоков и ошибки консоли страницы.
 */
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5174/';
const OUT = process.argv[3] ?? path.join(process.cwd(), '.probe', 'shots');
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
  if (msg.method === 'Runtime.consoleAPICalled') {
    consoleLines.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
  }
  if (msg.method === 'Log.entryAdded') {
    consoleLines.push(`${msg.params.entry.level}: ${msg.params.entry.text}`);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleLines.push('exception: ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text));
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
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return result.result.value;
};

const shot = async (name) => {
  const result = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(result.data, 'base64'));
};

/** Тап: headless с mobile-эмуляцией превращает mouse в pointer/touch. */
const tap = async (x, y, holdMs = 0) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'touch' });
  if (holdMs) await sleep(holdMs);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, pointerType: 'touch' });
};


/** Снимок геометрии ключевых блоков (в CSS-пикселях). */
const PROBE = `(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const round = (n) => Math.round(n * 10) / 10;
    return { top: round(r.top), bottom: round(r.bottom), left: round(r.left), right: round(r.right), w: round(r.width), h: round(r.height) };
  };
  const txt = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
  const nav = document.querySelector('.bottom-nav');
  const navRect = nav?.getBoundingClientRect();
  const navPoint = navRect ? document.elementFromPoint(navRect.left + navRect.width / 4, navRect.top + navRect.height / 2) : null;
  const ann = document.querySelector('.focus-header__annotation');
  const holdName = document.querySelector('.hold-header__name');
  const holdHint = document.querySelector('.hold-header__hint');
  const holdBox = document.querySelector('.hold-header');
  const card = document.querySelector('.emotion-panel__card');
  const hint = document.querySelector('.input-hint');
  const panel = document.querySelector('.emotion-panel');
  const play = document.querySelector('.emotion-panel__play');
  return JSON.stringify({
    viewport: [window.innerWidth, window.innerHeight],
    noteText: txt('.daily-note'),
    note: box('.daily-note'),
    focus: document.querySelector('.focus-header') ? {
      title: txt('.focus-header__title'),
      annotation: txt('.focus-header__annotation'),
      box: box('.focus-header'),
      annotationBox: box('.focus-header__annotation'),
      annotationStyle: ann ? { marginTop: getComputedStyle(ann).marginTop, fontSize: getComputedStyle(ann).fontSize, fontWeight: getComputedStyle(ann).fontWeight, fontStyle: getComputedStyle(ann).fontStyle, color: getComputedStyle(ann).color } : null,
    } : null,
    hold: holdBox ? {
      name: txt('.hold-header__name'),
      hint: txt('.hold-header__hint'),
      box: box('.hold-header'),
      nameBox: box('.hold-header__name'),
      hintBox: box('.hold-header__hint'),
      nameStyle: { fontSize: getComputedStyle(holdName).fontSize, fontWeight: getComputedStyle(holdName).fontWeight, letterSpacing: getComputedStyle(holdName).letterSpacing, headerTop: getComputedStyle(holdBox).top },
      hintStyle: { marginTop: getComputedStyle(holdHint).marginTop, fontSize: getComputedStyle(holdHint).fontSize, fontWeight: getComputedStyle(holdHint).fontWeight, fontStyle: getComputedStyle(holdHint).fontStyle, color: getComputedStyle(holdHint).color },
    } : null,
    panel: box('.emotion-panel'),
    panelStyle: panel ? { top: getComputedStyle(panel).top, paddingBottom: getComputedStyle(panel).paddingBottom, justifyContent: getComputedStyle(panel).justifyContent, gap: getComputedStyle(panel).gap } : null,
    card: box('.emotion-panel__card'),
    cardStyle: card ? { radius: getComputedStyle(card).borderRadius, paddingBottom: getComputedStyle(card).paddingBottom, marginBottom: getComputedStyle(card).marginBottom, scrollbarWidth: getComputedStyle(card).scrollbarWidth, overflowY: getComputedStyle(card).overflowY, scrollHeight: card.scrollHeight, clientHeight: card.clientHeight } : null,
    play: box('.emotion-panel__play'),
    playStyle: play ? { position: getComputedStyle(play).position, bottom: getComputedStyle(play).bottom, transform: getComputedStyle(play).transform } : null,
    hint: box('.input-hint'),
    hintStyle: hint ? { radius: getComputedStyle(hint).borderRadius, marginTop: getComputedStyle(hint).marginTop } : null,
    nav: box('.bottom-nav'),
    navHitTest: navPoint ? (navPoint.closest('button')?.getAttribute('data-icon') ?? navPoint.tagName) : null,
    introOverlay: document.querySelector('[class*="intro"]') ? 'есть' : 'нет',
    canvas: !!document.querySelector('canvas'),
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
await trySend('Emulation.setSafeAreaInsetsOverride', {
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
});
await trySend('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

await send('Page.navigate', { url: BASE });
await sleep(3000);
await evaluate(`localStorage.setItem('emoza:onboarding:home','1');localStorage.setItem('emoza:onboarding:focusShown','1');localStorage.setItem('emoza:onboarding:holdShown','1');'seeded'`);
await send('Page.reload', { ignoreCache: false });
await sleep(7000);

console.log('── ГЛАВНЫЙ ──');
console.log(await evaluate(PROBE));
await shot('1-main.png');

// Ищем шарик матрицы: тапаем по сетке, пока не появится шапка фокуса.
let focusPoint = null;
outer: for (const yRatio of [0.3, 0.42, 0.52, 0.62, 0.72, 0.22]) {
  for (const xRatio of [0.5, 0.3, 0.7, 0.18, 0.82]) {
    const x = Math.round(390 * xRatio);
    const y = Math.round(844 * yRatio);
    await tap(x, y);
    await sleep(900);
    if (await evaluate(`!!document.querySelector('.focus-header')`)) {
      focusPoint = { x, y };
      break outer;
    }
  }
}
console.log('── ФОКУС: точка тапа ' + JSON.stringify(focusPoint) + ' ──');
console.log(await evaluate(PROBE));
await shot('2-focus.png');

// Подсказка онбординга в фокусе: вешаем её пробником (в реальной сессии
// флаги онбординга засеяны) и проверяем, что она висит НАД окном текста.
console.log('── ПОДСКАЗКА ОНБОРДИНГА В ФОКУСЕ ──');
console.log(await evaluate(`(() => {
  const host = document.querySelector('.emotion-space');
  const panel = document.querySelector('.emotion-panel');
  if (!host || !panel) return 'нет .emotion-space/.emotion-panel';
  const tip = document.createElement('div');
  tip.className = 'onboarding-tip onboarding-tip--focus';
  tip.textContent = 'Зажми шарик, проговори ситуацию и отпусти. Можешь ничего не говорить — это необязательно.';
  host.appendChild(tip);
  const r = tip.getBoundingClientRect();
  const p = panel.getBoundingClientRect();
  const round = (n) => Math.round(n * 10) / 10;
  const out = JSON.stringify({
    tipTop: round(r.top), tipBottom: round(r.bottom), tipH: round(r.height),
    panelTop: round(p.top), gapToPanel: round(p.top - r.bottom),
  });
  tip.remove();
  return out;
})()`));

// Возврат на главный кнопкой grid (data-icon="main").
await evaluate(`document.querySelector('[data-icon="main"]')?.click(); 'clicked'`);
await sleep(1600);
console.log('── ПОСЛЕ КЛИКА GRID ──');
console.log(await evaluate(PROBE));
await shot('3-back-home.png');

// Захват: держим палец на найденном шарике.
if (focusPoint) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: focusPoint.x, y: focusPoint.y, button: 'left', clickCount: 1, pointerType: 'touch' });
  await sleep(1300);
  console.log('── ЗАХВАТ ──');
  console.log(await evaluate(PROBE));
  await shot('4-hold.png');
  // Клик по сетке ПРИ УДЕРЖАНИИ: палец всё ещё на шарике — кнопка обязана
  // отпустить захват (holdReleaseRef) и вернуть главный экран.
  await evaluate(`document.querySelector('[data-icon="main"]')?.click(); 'clicked'`);
  await sleep(1600);
  console.log('── ПОСЛЕ КЛИКА GRID ИЗ ЗАХВАТА ──');
  console.log(await evaluate(PROBE));
  await shot('5-grid-from-hold.png');
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: focusPoint.x, y: focusPoint.y, button: 'left', clickCount: 1, pointerType: 'touch' });
  await sleep(1500);
  console.log('── ПОСЛЕ ОТПУСКАНИЯ ──');
  console.log(await evaluate(PROBE));
  await shot('6-released.png');
}

console.log('── КОНСОЛЬ СТРАНИЦЫ ──');
console.log(consoleLines.slice(-25).join('\n') || '(пусто)');
ws.close();
