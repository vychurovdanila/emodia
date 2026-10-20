import {
  Application,
  Assets,
  BlurFilter,
  Circle,
  Container,
  Rectangle,
  Sprite,
  Texture,
  type FederatedPointerEvent,
  type TextureSource,
} from 'pixi.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EMOTIONS, EMOTION_TEXTS, type Emotion, type EmotionMotion } from '@emodia/shared';

import {
  DialogIcon,
  ExploreIcon,
  MainActiveIcon,
  MainColoredIcon,
  UserIcon,
} from '../components/NavIcons';

/** Раскладка сетки: 3 колонки × 6 строк (18 эмоций). */
const GRID_COLS = 3;
const GRID_ROWS = 6;

/**
 * Отступ от краёв канваса (доля от ширины/высоты экрана). Плотность ВНУТРИ
 * матрицы держат SPRITE_SIZE_RATIO и CELL_GAP_RATIO.
 */
const EDGE_PADDING_RATIO = 0.035;

/**
 * Нижняя зона, которую матрица не занимает: высота bottom-nav (68px) плюс
 * воздух под последним рядом. Сетка вписывается в область над ней, поэтому
 * персонажи больше не упираются в иконки навигации.
 */
const BOTTOM_NAV_HEIGHT = 68;
const MATRIX_BOTTOM_MARGIN = 20;

/** Зазор между персонажами внутри ячейки: 2% ячейки — они почти соприкасаются. */
const CELL_GAP_RATIO = 0.02;

/** Радиус хит-ареа как доля от меньшей стороны ячейки: половина ячейки. */
const RADIUS_RATIO = 0.5;

/** Коэффициент инкрементальной интерполяции в ticker. */
const TWEEN_LERP = 0.15;

/** Порог «доехали»: ближе — присваиваем target напрямую. */
const TWEEN_EPSILON = 0.01;

/**
 * Мир в фокусе: сжимается ВОКРУГ СВОЕГО ЦЕНТРА, опускается вниз
 * и ПОЛНОСТЬЮ растворяется (alpha 0): за окном текста не остаётся 
 * даже намёка на матрицу.
 */
const WORLD_FOCUS_SCALE = 0.55;
const WORLD_FOCUS_ALPHA = 0;
const WORLD_FOCUS_Y_RATIO = 0.55;
const FOCUS_BLUR_STRENGTH = 6;

/**
 * Мир при захвате: в отличие от фокуса, он остаётся ВИДИМЫМ фоном —
 * alpha 0.35 и мягкий блюр 6. Эмозик в руке яркий и резкий.
 */
const WORLD_HOLD_ALPHA = 0.35;
const WORLD_HOLD_BLUR = 6;

/**
 * Лента фокуса: отдельный слой ПОВЕРХ мира. Центр слоя — верхняя четверть экрана.
 * Из матрицы вынимается ТОЛЬКО центральный шар: пустует одна ячейка.
 * Соседи — декоративные копии, их оригиналы продолжают стоять в матрице.
 */
const CAROUSEL_Y_RATIO = 0.25;

/**
 * Отступ соседей от центра ленты как доля ширины экрана. Он же — ШАГ ленты:
 * сосед проезжает ровно это расстояние, вставая в центр.
 */
const CAROUSEL_SIDE_X_RATIO = 0.44;

/** Центр ленты — крупный и резкий, соседи — тоже крупные, но в тумане. */
const CAROUSEL_CENTER_SCALE = 2.0;
const CAROUSEL_SIDE_SCALE = 0.90;

/** Туман у края экрана: alpha 0.35 и мягкий блюр 8; в центре — 1 и 0. */
const CAROUSEL_FOG_ALPHA = 0.35;
const CAROUSEL_SIDE_BLUR = 8;

/** Соседи стоят НИЖЕ центра на 25% своего размера: лента читается как глубина. */
const CAROUSEL_SIDE_Y_RATIO = 0.25;

/** Snap после отпускания: инерция, порог «доехали» и доля шага для сноса. */
const CAROUSEL_SNAP_LERP = 0.18;
const CAROUSEL_SNAP_EPSILON = 1;
const CAROUSEL_SNAP_HALF_RATIO = 0.5;

/** Уверенный свайп: скорость пальца в px/мс — едем на одну страницу. */
const CAROUSEL_FLICK_VELOCITY = 0.6;

/** Жест ленты: сдвиг и время, меньше которых это тап, а не пролистывание. */
const CAROUSEL_DRAG_TAP_PX = 8;
const CAROUSEL_TAP_MS = 300;

/** Бросок ленты: пороги скорости пальца (px/мс) и сколько страниц пролистываем. */
const CAROUSEL_FLING_VELOCITY_MAX = 4.5;
const CAROUSEL_FLING_PAGES_MAX = 3;
const CAROUSEL_FLING_VELOCITY_MID = 2.6;
const CAROUSEL_FLING_PAGES_MID = 2;

/** Качество блюра соседей. */
const CAROUSEL_BLUR_QUALITY = 3;

/** Качество блюра мира: высокое по умолчанию, низкое при падении FPS. */
const BLUR_QUALITY_HIGH = 4;
const BLUR_QUALITY_LOW = 2;
const LOW_FPS_THRESHOLD = 50;

/**
 * Персонажи лежат в 6 файлах — по 3 эмоции в каждом. Внутри файла сетка 3×3.
 * Индекс эмоции: файл = floor(index / 3), строка = index % 3.
 */
const SPRITES_PER_FILE = 3;
const TOTAL_SPRITES = 6;

/** 
 * Телефон определяем по вьюпорту: узкому экрану хватает лёгкой версии 
 * спрайтов — кадр 250 px вместо 500. 
 */
const isMobile = window.matchMedia('(max-width: 768px)').matches || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const SPRITE_FRAME_SIZE = isMobile ? 250 : 500;

/** Колонки листа: 0 — покой, 1 — живое шевеление, 2 — вспышка. */
const SPRITE_COLUMNS = [0, 1, 2];
const SPRITE_COL_IDLE = 0;
const SPRITE_COL_MOVE = 1;
const SPRITE_COL_FLASH = 2;

/** Размер персонажа в матрице: 1.05 позволяет заполнить ячейку. */
const SPRITE_SIZE_RATIO = 1.0;

/** Захват: сколько держать палец и насколько можно сдвинуться. */
const HOLD_THRESHOLD = 300;
const MOVE_THRESHOLD = 10;

/** Шарик в руке: крупнее фокусного, так как он «главнее». */
const BALL_HOLD_SCALE = 3.5;

/** Интерполяция шарика: слежение за пальцем, рост и возврат домой. */
const HOLD_FOLLOW_LERP = 0.35;
const HOLD_SCALE_LERP = 0.2;
const HOLD_RETURN_LERP = 0.18;

/** Точка захвата: палец ложится НИЖЕ центра, шарик ведём вверх на 40% радиуса. */
const HOLD_FINGER_OFFSET_RATIO = 0.4;

/** Хит-ареа шарика = половина ячейки. */
const HIT_AREA_RATIO = 1;

/** Онбординг: три независимых флага. */
const ONBOARDING_HOME_KEY = 'emodia:onboarding:home';
const ONBOARDING_FOCUS_KEY = 'emodia:onboarding:focusShown';
const ONBOARDING_HOLD_KEY = 'emodia:onboarding:holdShown';
const ONBOARDING_TIP_DURATION = 6000;

/** Центральный шар поднимается в ленту таким, каким стоял в матрице. */
const CAROUSEL_RISING_LOOK: SlotLook = { scale: 1, alpha: 1, blur: 0 };

interface MotionParams {
  intervalMin: number;
  intervalMax: number;
  flashMin: number;
  flashMax: number;
  flashChance: number;
}

const MOTION_PARAMS: Record<EmotionMotion, MotionParams> = {
  calm: { intervalMin: 2200, intervalMax: 4200, flashMin: 600, flashMax: 1000, flashChance: 0.12 },
  tense: { intervalMin: 800, intervalMax: 1800, flashMin: 300, flashMax: 600, flashChance: 0.18 },
  heavy: { intervalMin: 3200, intervalMax: 5600, flashMin: 900, flashMax: 1500, flashChance: 0.08 },
};

interface Ball {
  container: Container;
  sprite: Sprite;
  frames: [Texture, Texture, Texture];
  state: 0 | 1 | 2;
  params: MotionParams;
  nextChangeAt: number;
  state2Until: number;
  radius: number;
  hitArea: Circle;
  baseX: number;
  baseY: number;
  emotion: Emotion;
  pressActive: boolean;
  pressStartTime: number;
  pressStartX: number;
  pressStartY: number;
  pressMoved: boolean;
  holdActivated: boolean;
  targetX: number;
  targetY: number;
  targetScale: number;
  returning: boolean;
  returnTargetX: number;
  returnTargetY: number;
  returnTargetScale: number;
}

interface BallHandlers {
  onTap: (id: string) => void;
  onHoldEnd: (id: string) => void;
}

interface Tween {
  worldScale: number;
  worldScaleTarget: number;
  worldAlpha: number;
  worldAlphaTarget: number;
  worldY: number;
  worldYTarget: number;
  blur: number;
  blurTarget: number;
}

function createTween(): Tween {
  return {
    worldScale: 1, worldScaleTarget: 1, worldAlpha: 1, worldAlphaTarget: 1,
    worldY: 0, worldYTarget: 0, blur: 0, blurTarget: 0,
  };
}

interface SlotLook {
  scale: number;
  alpha: number;
  blur: number;
}

interface SlotBase {
  container: Container;
  blur: BlurFilter;
  blurAttached: boolean;
  x: number;
  y: number;
  scale: number;
  alpha: number;
  blurStrength: number;
  xTarget: number;
  yTarget: number;
  scaleTarget: number;
  alphaTarget: number;
  blurTarget: number;
}

interface BallSlot extends SlotBase {
  kind: 'ball';
  ball: Ball;
}

interface CopySlot extends SlotBase {
  kind: 'copy';
  sprite: Sprite;
  ball: Ball;
}

type TapeSlot = BallSlot | CopySlot;

interface Carousel {
  farPrev: CopySlot;
  midPrev: CopySlot;
  prev: CopySlot;
  current: BallSlot;
  next: CopySlot;
  midNext: CopySlot;
  farNext: CopySlot;
}

function holdOffsetY(ball: Ball): number {
  return -ball.radius * BALL_HOLD_SCALE * HOLD_FINGER_OFFSET_RATIO;
}

function directionTo(fromId: string, toId: string): 1 | -1 {
  const length = EMOTIONS.length;
  const from = EMOTIONS.findIndex((emotion) => emotion.id === fromId);
  const to = EMOTIONS.findIndex((emotion) => emotion.id === toId);
  const forward = (to - from + length) % length;
  return forward <= length / 2 ? 1 : -1;
}

function approach(current: number, target: number): number {
  if (Math.abs(target - current) < TWEEN_EPSILON) return target;
  return current + (target - current) * TWEEN_LERP;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function heldHint(emotion: Emotion): string {
  if (emotion.kind === 'positive') return 'Проговори и закрепи';
  if (emotion.kind === 'neutral') return 'Проговори и наблюдай';
  return 'Проговори и отпусти';
}

function focusAnnotation(emotion: Emotion): string {
  return heldHint(emotion).toLowerCase();
}

function playGrabSound(emotionId: string): void {
  try {
    const variant = Math.random() > 0.5 ? '1' : '2';
    const audio = new Audio(`/sounds/${emotionId}-${variant}.mp3`);
    audio.volume = 0.6;
    void audio.play().catch(() => {});
  } catch { /* ignore */ }
}

function readOnboardingFlag(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

function markOnboardingFlag(key: string): void {
  try { localStorage.setItem(key, '1'); } catch { /* ignore */ }
}

/**
 * Ставит pivot в ЦЕНТР МИРА и центрирует мир на экране.
 * Без этого мир при фокусе сжимался бы к верхнему левому углу сетки.
 */
function centerWorld(app: Application, world: Container): void {
  const bounds = world.getLocalBounds();
  world.pivot.set((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2);
  world.position.set(app.screen.width / 2, app.screen.height / 2);
}

/**
 * Пересчитывает геометрию шариков под текущий размер канваса.
 * Координаты считаются ОТНОСИТЕЛЬНО ЦЕНТРА МИРА (0,0 = центр экрана).
 */
function layoutBalls(app: Application, balls: Ball[], matrix: Container): void {
  const paddingX = app.screen.width * EDGE_PADDING_RATIO;
  const paddingY = app.screen.height * EDGE_PADDING_RATIO;
  const usableHeight = app.screen.height - BOTTOM_NAV_HEIGHT - MATRIX_BOTTOM_MARGIN;
  const cellW = (app.screen.width - paddingX * 2) / GRID_COLS;
  const cellH = (usableHeight - paddingY * 2) / GRID_ROWS;
  const cell = Math.min(cellW, cellH);
  const radius = cell * RADIUS_RATIO;
  const spriteSize = cell * SPRITE_SIZE_RATIO - cell * CELL_GAP_RATIO;

  const originX = app.screen.width / 2;
  const originY = app.screen.height / 2;

  for (const ball of balls) {
    const colIndex = ball.emotion.gridPosition.col - 1;
    const rowIndex = ball.emotion.gridPosition.row - 1;

    ball.baseX = paddingX + colIndex * cellW + cellW / 2 - originX;
    ball.baseY = paddingY + rowIndex * cellH + cellH / 2 - originY;

    if (ball.radius !== radius) {
      ball.sprite.width = spriteSize;
      ball.sprite.height = spriteSize;
      ball.radius = radius;
    }

    ball.hitArea.radius = radius * HIT_AREA_RATIO;

    if (ball.container.parent === matrix) {
      ball.container.position.set(ball.baseX, ball.baseY);
    }
  }
}

/** Создаёт шарик эмоции: плоский круг и хит-ареа. */
function createBall(emotion: Emotion, frames: [Texture, Texture, Texture], handlers: BallHandlers): Ball {
  const hitArea = new Circle(0, 0, 1);
  const container = new Container();
  container.eventMode = 'static';
  container.cursor = 'pointer';
  container.hitArea = hitArea;

  const sprite = new Sprite(frames[SPRITE_COL_IDLE]);
  sprite.anchor.set(0.5);
  sprite.eventMode = 'none';
  container.addChild(sprite);

  const params = MOTION_PARAMS[emotion.motion];

  const ball: Ball = {
    container, sprite, frames, state: SPRITE_COL_IDLE, params,
    nextChangeAt: performance.now() + rand(params.intervalMin, params.intervalMax),
    state2Until: 0, radius: 0, hitArea, baseX: 0, baseY: 0, emotion,
    pressActive: false, pressStartTime: 0, pressStartX: 0, pressStartY: 0,
    pressMoved: false, holdActivated: false, targetX: 0, targetY: 0, targetScale: 1,
    returning: false, returnTargetX: 0, returnTargetY: 0, returnTargetScale: 1,
  };

  container.on('pointerdown', (event: FederatedPointerEvent) => {
    if (ball.holdActivated || ball.returning) return;
    ball.pressActive = true;
    ball.pressMoved = false;
    ball.pressStartTime = performance.now();
    ball.pressStartX = event.global.x;
    ball.pressStartY = event.global.y;
  });

  container.on('globalpointermove', (event: FederatedPointerEvent) => {
    if (!ball.pressActive) return;
    const dx = event.global.x - ball.pressStartX;
    const dy = event.global.y - ball.pressStartY;
    if (Math.hypot(dx, dy) > MOVE_THRESHOLD) ball.pressMoved = true;
  });

  container.on('pointerup', (event: FederatedPointerEvent) => {
    if (!ball.pressActive) return;
    ball.pressActive = false;

    if (ball.holdActivated) {
      handlers.onHoldEnd(ball.emotion.id);
      return;
    }

    const dt = performance.now() - ball.pressStartTime;
    const dx = event.global.x - ball.pressStartX;
    const dy = event.global.y - ball.pressStartY;
    const moved = Math.hypot(dx, dy);

    if (moved > MOVE_THRESHOLD) return;
    if (dt < HOLD_THRESHOLD) handlers.onTap(ball.emotion.id);
  });

  return ball;
}

const DAILY_NOTES = [
  'То, что ты чувствуешь — имеет значение.',
  'В мире Эмодиа сегодня солнечно. Радость вышла на поляну первой.',
  'Гнев вчера починил забор. Соседи заметили.',
  'Иногда Тревога ошибается. Проверь её слова.',
  'Умиротворение напоминает: дыши. Просто дыши.',
  'Любопытство нашло новую тропинку за рекой. Вернётся к вечеру.',
  'Печаль сегодня слушает дождь у ручья.',
  'Вдохновение не спало всю ночь — рисовало звёзды.',
  'Благодарность испекла хлеб и оставила на подоконнике.',
  'Одиночество смотрит на горизонт. Иногда к нему кто-то приходит.',
  'Зависть учится замечать, что у неё уже есть.',
  'Стыд спрятался за деревьями. Ему нужно время.',
  'Триумф поставил флаг на холме. Но он знает — это не навсегда.',
  'Страх сторожит мост. Мимо можно пройти, если не бежать.',
];

export function EmotionSpace() {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // === ЗАЩИТА ОТ СТРОГОГО РЕЖИМА (STRICTMODE) ===
  // Храним экземпляр приложения, чтобы убивать его при повторном рендере
  const appRef = useRef<Application | null>(null);

  const onBallClickRef = useRef<(id: string | null) => void>(() => {});
  const applyFocusRef = useRef<(id: string | null, direction?: 1 | -1) => void>(() => {});
  const onHoldStartRef = useRef<(id: string) => void>(() => {});
  const onHoldEndRef = useRef<() => void>(() => {});
  const holdReleaseRef = useRef<(id: string) => void>(() => {});
  const focusCommitRef = useRef<(id: string) => void>(() => {});
  const carouselBusyRef = useRef(false);

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [heldId, setHeldId] = useState<string | null>(null);
  const [dailyNote, setDailyNote] = useState(() => DAILY_NOTES[Math.floor(Math.random() * DAILY_NOTES.length)]);
  const focusedIdRef = useRef<string | null>(null);
  const heldIdRef = useRef<string | null>(null);

  const [sceneReady, setSceneReady] = useState(false);
  const [showHomeIntro, setShowHomeIntro] = useState(false);
  const [showFocusTip, setShowFocusTip] = useState(false);
  const [showHoldIntro, setShowHoldIntro] = useState(false);

  const handleBallClick = useCallback((id: string | null) => {
    if (carouselBusyRef.current || heldIdRef.current) return;
    setFocusedId((current) => (id === null ? null : current === id ? null : id));
  }, []);

  const handleHoldStart = useCallback((id: string) => setHeldId(id), []);
  const handleHoldEnd = useCallback(() => setHeldId(null), []);

  const handleFocusCommit = useCallback((id: string) => {
    focusedIdRef.current = id;
    setFocusedId(id);
  }, []);

  useEffect(() => { onBallClickRef.current = handleBallClick; }, [handleBallClick]);
  useEffect(() => { onHoldStartRef.current = handleHoldStart; }, [handleHoldStart]);
  useEffect(() => { onHoldEndRef.current = handleHoldEnd; }, [handleHoldEnd]);
  useEffect(() => { focusedIdRef.current = focusedId; }, [focusedId]);
  useEffect(() => { heldIdRef.current = heldId; }, [heldId]);
  useEffect(() => { focusCommitRef.current = handleFocusCommit; }, [handleFocusCommit]);

  useEffect(() => {
    if (sceneReady && !readOnboardingFlag(ONBOARDING_HOME_KEY)) setShowHomeIntro(true);
  }, [sceneReady]);

  const closeHomeIntro = useCallback(() => {
    setShowHomeIntro(false);
    markOnboardingFlag(ONBOARDING_HOME_KEY);
  }, []);

  useEffect(() => {
    if (!focusedId || readOnboardingFlag(ONBOARDING_FOCUS_KEY)) return;
    setShowFocusTip(true);
    markOnboardingFlag(ONBOARDING_FOCUS_KEY);
    const timer = window.setTimeout(() => setShowFocusTip(false), ONBOARDING_TIP_DURATION);
    return () => { clearTimeout(timer); setShowFocusTip(false); };
  }, [focusedId]);

  useEffect(() => {
    if (heldId && !readOnboardingFlag(ONBOARDING_HOLD_KEY)) {
      setShowHoldIntro(true);
      return;
    }
    if (!heldId && showHoldIntro) {
      setShowHoldIntro(false);
      markOnboardingFlag(ONBOARDING_HOLD_KEY);
    }
  }, [heldId, showHoldIntro]);

  useEffect(() => {
    const containerEl = containerRef.current;
    if (!containerEl) return;

    let destroyed = false;
    let resizeObserver: ResizeObserver | null = null;

    const setup = async () => {
      // Если приложение уже было создано (HMR или StrictMode) — убиваем его
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
      containerEl.innerHTML = '';

      // 1. Сначала грузим быстрые мобильные спрайты (250x250) для мгновенного старта
      const spriteSources: TextureSource[] = [];
      for (let i = 1; i <= TOTAL_SPRITES; i++) {
        const texture = await Assets.load<Texture>(`/emotions/mobile/sprites-${i}.png`);
        spriteSources.push(texture.source);
      }

      if (destroyed) return;

      const pixiApp = new Application();
      await pixiApp.init({
        width: containerEl.clientWidth,
        height: containerEl.clientHeight,
        background: 0xf5f0e8,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
      });

      if (destroyed) {
        pixiApp.destroy(true, { children: true });
        return;
      }

      appRef.current = pixiApp;
      containerEl.appendChild(pixiApp.canvas);

      const world = new Container();
      const worldBlur = new BlurFilter({ strength: 0, quality: BLUR_QUALITY_HIGH });
      world.filters = [worldBlur];
      pixiApp.stage.addChild(world);

      const carouselLayer = new Container();
      pixiApp.stage.addChild(carouselLayer);

      const layoutCarouselLayer = () => {
        carouselLayer.position.set(pixiApp.screen.width / 2, pixiApp.screen.height * CAROUSEL_Y_RATIO - 15);
      };
      layoutCarouselLayer();

      const balls: Ball[] = EMOTIONS.map((emotion, index) => {
        const fileIdx = Math.floor(index / SPRITES_PER_FILE);
        const rowInFile = index % SPRITES_PER_FILE;
        const source = spriteSources[fileIdx];
        
        // Нарезаем мобильные фреймы (250px)
        const frames = SPRITE_COLUMNS.map(
          (col) => new Texture({
            source,
            frame: new Rectangle(
              col * SPRITE_FRAME_SIZE,
              rowInFile * SPRITE_FRAME_SIZE,
              SPRITE_FRAME_SIZE,
              SPRITE_FRAME_SIZE
            ),
          })
        ) as [Texture, Texture, Texture];

        const ball = createBall(emotion, frames, {
          onTap: (id) => onBallClickRef.current(id),
          onHoldEnd: (id) => holdReleaseRef.current(id),
        });

        world.addChild(ball.container);
        return ball;
      });

      // 2. Фоновая подгрузка HD спрайтов (500x500)
      const loadHDSprites = async () => {
        try {
          const hdSources: TextureSource[] = [];
          for (let i = 1; i <= TOTAL_SPRITES; i++) {
            // Грузим из папки desktop (HD версия)
            const texture = await Assets.load<Texture>(`/emotions/desktop/sprites-${i}.png`);
            hdSources.push(texture.source);
          }

          // ЯВНО УКАЗЫВАЕМ РАЗМЕР КАДРА ДЛЯ HD (500px)
          const HD_FRAME_SIZE = 500;

          balls.forEach((ball, index) => {
            const fileIdx = Math.floor(index / SPRITES_PER_FILE);
            const rowInFile = index % SPRITES_PER_FILE;
            const source = hdSources[fileIdx];

            const hdFrames = SPRITE_COLUMNS.map(
              (col) => new Texture({
                source,
                frame: new Rectangle(
                  col * HD_FRAME_SIZE,
                  rowInFile * HD_FRAME_SIZE,
                  HD_FRAME_SIZE,
                  HD_FRAME_SIZE
                ),
              })
            ) as [Texture, Texture, Texture];

            ball.frames = hdFrames;
            
            if (!ball.holdActivated && !ball.returning) {
              // СОХРАНЯЕМ ТЕКУЩИЙ РАЗМЕР, ЧТОБЫ ШАР НЕ УВЕЛИЧИЛСЯ
              const currentWidth = ball.sprite.width;
              const currentHeight = ball.sprite.height;
              
              ball.sprite.texture = ball.frames[ball.state];
              
              ball.sprite.width = currentWidth;
              ball.sprite.height = currentHeight;
            }
          });
        } catch (error) {
          console.warn('Фоновая загрузка HD спрайтов не удалась:', error);
        }
      };

      // Запускаем фоновую загрузку, не блокируя основной поток
      void loadHDSprites();

      layoutBalls(pixiApp, balls, world);
      centerWorld(pixiApp, world);

      pixiApp.stage.eventMode = 'static';
      pixiApp.stage.hitArea = pixiApp.screen;
      pixiApp.stage.on('pointertap', (event) => {
        if (event.target === pixiApp.stage) onBallClickRef.current(null);
      });

      let selectedBall: Ball | null = null;
      let heldBall: Ball | null = null;
      const tween = createTween();

      let carousel: Carousel | null = null;
      let activeSlots: TapeSlot[] = [];
      let carouselMode: 'idle' | 'dragging' | 'snapping' = 'idle';
      let carouselOffset = 0;
      let targetCarouselOffset = 0;
      let dragStartX = 0;
      let dragStartOffset = 0;
      let dragStartTime = 0;
      let lastDragX = 0;
      let lastDragTime = 0;
      let dragVelocity = 0;
      let dragMoved = false;
      let snapDirection: 1 | -1 = 1;
      let pendingPages = 0;
      let tapeEntering = false;

      const emotionIndex = (id: string) => EMOTIONS.findIndex((emotion) => emotion.id === id);
      const neighbourBall = (index: number, offset: number) => balls[(index + offset + EMOTIONS.length) % EMOTIONS.length];
      const sideStep = () => pixiApp.screen.width * CAROUSEL_SIDE_X_RATIO;
      const centerProgress = (x: number) => Math.max(0, 1 - Math.abs(x) / pixiApp.screen.width);
      const sideYOffset = (slot: TapeSlot) => slot.ball.sprite.width * CAROUSEL_SIDE_SCALE * CAROUSEL_SIDE_Y_RATIO;

      const aimSlotAt = (slot: TapeSlot, x: number) => {
        const progress = centerProgress(x);
        slot.xTarget = x;
        slot.yTarget = (1 - progress) * sideYOffset(slot);
        slot.scaleTarget = CAROUSEL_SIDE_SCALE + (CAROUSEL_CENTER_SCALE - CAROUSEL_SIDE_SCALE) * progress;
        slot.alphaTarget = CAROUSEL_FOG_ALPHA + (1 - CAROUSEL_FOG_ALPHA) * progress;
        slot.blurTarget = (1 - progress) * CAROUSEL_SIDE_BLUR;
      };

      const placeSlotAt = (slot: TapeSlot, x: number) => {
        aimSlotAt(slot, x);
        slot.x = x;
        slot.y = slot.yTarget;
        slot.scale = slot.scaleTarget;
        slot.alpha = slot.alphaTarget;
        slot.blurStrength = slot.blurTarget;
      };

      const layoutTape = (follow: boolean) => {
        if (!carousel) return;
        const offset = carouselOffset;
        const step = sideStep();
        const place = follow ? placeSlotAt : aimSlotAt;

        place(carousel.farPrev, -3 * step + offset);
        place(carousel.midPrev, -2 * step + offset);
        place(carousel.prev, -step + offset);
        place(carousel.current, offset);
        place(carousel.next, step + offset);
        place(carousel.midNext, 2 * step + offset);
        place(carousel.farNext, 3 * step + offset);
      };

      const drawSlot = (slot: TapeSlot) => {
        slot.container.position.set(slot.x, slot.y);
        slot.container.scale.set(slot.scale);
        slot.container.alpha = slot.alpha;

        if (!slot.blurAttached) {
          slot.container.filters = [slot.blur];
          slot.blurAttached = true;
        }
        slot.blur.strength = slot.blurStrength;
      };

      const slotArrived = (slot: TapeSlot) =>
        slot.x === slot.xTarget && slot.y === slot.yTarget &&
        slot.scale === slot.scaleTarget && slot.alpha === slot.alphaTarget &&
        slot.blurStrength === slot.blurTarget;

      const createSlot = (ball: Ball, x: number, y: number, look?: SlotLook): BallSlot => {
        ball.container.parent?.removeChild(ball.container);
        carouselLayer.addChild(ball.container);
        ball.container.filters = [];
        ball.state = SPRITE_COL_IDLE;
        ball.sprite.texture = ball.frames[SPRITE_COL_IDLE];
        ball.container.rotation = 0;
        ball.pressActive = false;
        ball.returning = false;

        const slot: BallSlot = {
          kind: 'ball', ball, container: ball.container,
          blur: new BlurFilter({ strength: 0, quality: CAROUSEL_BLUR_QUALITY }),
          blurAttached: false,
          x, y, scale: look ? look.scale : CAROUSEL_CENTER_SCALE,
          alpha: look ? look.alpha : 1, blurStrength: look ? look.blur : 0,
          xTarget: x, yTarget: y, scaleTarget: CAROUSEL_CENTER_SCALE,
          alphaTarget: 1, blurTarget: 0,
        };
        aimSlotAt(slot, x);
        drawSlot(slot);
        activeSlots.push(slot);
        return slot;
      };

      const attachFromMatrix = (ball: Ball): BallSlot => {
        const globalPos = ball.container.getGlobalPosition();
        return createSlot(ball, globalPos.x - carouselLayer.x, globalPos.y - carouselLayer.y, CAROUSEL_RISING_LOOK);
      };

      const syncCopySize = (copy: CopySlot) => {
        copy.sprite.width = copy.ball.sprite.width;
        copy.sprite.height = copy.ball.sprite.height;
      };

      const createCopy = (ball: Ball, x: number, look?: SlotLook): CopySlot => {
        const container = new Container();
        const sprite = new Sprite(ball.frames[SPRITE_COL_IDLE]);
        sprite.anchor.set(0.5);
        sprite.eventMode = 'none';
        container.eventMode = 'none';
        container.addChild(sprite);
        carouselLayer.addChild(container);

        const copy: CopySlot = {
          kind: 'copy', container, sprite, ball,
          blur: new BlurFilter({ strength: 0, quality: CAROUSEL_BLUR_QUALITY }),
          blurAttached: false,
          x, y: 0, scale: CAROUSEL_SIDE_SCALE, alpha: 0, blurStrength: 0,
          xTarget: x, yTarget: 0, scaleTarget: CAROUSEL_SIDE_SCALE,
          alphaTarget: CAROUSEL_FOG_ALPHA, blurTarget: CAROUSEL_SIDE_BLUR,
        };
        syncCopySize(copy);
        placeSlotAt(copy, x);
        copy.alpha = look ? look.alpha : 0;
        copy.scale = look ? look.scale : copy.scaleTarget;
        copy.blurStrength = look ? look.blur : copy.blurTarget;
        drawSlot(copy);
        activeSlots.push(copy);
        return copy;
      };

      const destroyCopy = (copy: CopySlot) => {
        copy.container.parent?.removeChild(copy.container);
        copy.container.destroy({ children: true });
      };

      const returnSlotToWorld = (slot: BallSlot) => {
        const ball = slot.ball;
        ball.container.filters = [];
        ball.container.parent?.removeChild(ball.container);
        world.addChild(ball.container);
        ball.container.position.set(ball.baseX, ball.baseY);
        ball.container.scale.set(1);
        ball.container.alpha = 1;
        ball.container.rotation = 0;
        ball.state = SPRITE_COL_IDLE;
        ball.sprite.texture = ball.frames[SPRITE_COL_IDLE];
        ball.pressActive = false;
        ball.nextChangeAt = performance.now() + rand(ball.params.intervalMin, ball.params.intervalMax);
      };

      const flySlotHome = (slot: BallSlot) => {
        const ball = slot.ball;
        const globalPos = ball.container.getGlobalPosition();
        const worldScale = world.scale.x;
        ball.container.filters = [];
        ball.container.parent?.removeChild(ball.container);
        world.addChild(ball.container);
        ball.container.position.set(
          (globalPos.x - world.position.x) / worldScale + world.pivot.x,
          (globalPos.y - world.position.y) / worldScale + world.pivot.y
        );
        ball.container.scale.set(ball.container.scale.x / worldScale);
        ball.container.alpha = 1;
        ball.container.rotation = 0;
        ball.returning = true;
        ball.returnTargetX = ball.baseX;
        ball.returnTargetY = ball.baseY;
        ball.returnTargetScale = 1;
        ball.state = SPRITE_COL_IDLE;
        ball.sprite.texture = ball.frames[SPRITE_COL_IDLE];
        ball.pressActive = false;
      };

      const enterFocus = (id: string) => {
        const index = emotionIndex(id);
        const ball = index >= 0 ? balls[index] : undefined;
        if (!ball) return;

        tween.worldScaleTarget = WORLD_FOCUS_SCALE;
        tween.worldAlphaTarget = WORLD_FOCUS_ALPHA;
        tween.worldYTarget = pixiApp.screen.height * WORLD_FOCUS_Y_RATIO;
        tween.blurTarget = FOCUS_BLUR_STRENGTH;

        const step = sideStep();
        const current = attachFromMatrix(ball);
        const prev = createCopy(neighbourBall(index, -1), -step);
        const next = createCopy(neighbourBall(index, 1), step);
        const farPrev = createCopy(neighbourBall(index, -3), -3 * step);
        const midPrev = createCopy(neighbourBall(index, -2), -2 * step);
        const midNext = createCopy(neighbourBall(index, 2), 2 * step);
        const farNext = createCopy(neighbourBall(index, 3), 3 * step);

        carousel = { farPrev, midPrev, prev, current, next, midNext, farNext };
        selectedBall = ball;
        tapeEntering = true;
        carouselMode = 'idle';
        carouselOffset = 0;
        targetCarouselOffset = 0;
        pendingPages = 0;
        carouselBusyRef.current = true;

        layoutTape(false);
      };

      const commitCarouselTransition = (direction: 1 | -1) => {
        const tape = carousel;
        if (!tape) return;

        const arrivingSlot = direction === 1 ? tape.next : tape.prev;
        const farSlot = direction === 1 ? tape.prev : tape.next;
        const leaving = tape.current;

        const arriving = createSlot(arrivingSlot.ball, 0, 0);
        const index = emotionIndex(arriving.ball.emotion.id);

        // Переиспользуем контейнеры вместо их удаления и создания новых
        arrivingSlot.ball = leaving.ball;
        arrivingSlot.sprite.texture = arrivingSlot.ball.frames[SPRITE_COL_IDLE];
        syncCopySize(arrivingSlot);

        farSlot.ball = neighbourBall(index, direction === 1 ? 1 : -1);
        farSlot.sprite.texture = farSlot.ball.frames[SPRITE_COL_IDLE];
        syncCopySize(farSlot);

        const refreshCopyBall = (slot: CopySlot, rel: number) => {
          slot.ball = neighbourBall(index, rel);
          slot.sprite.texture = slot.ball.frames[SPRITE_COL_IDLE];
          syncCopySize(slot);
        };
        refreshCopyBall(tape.farPrev, -3);
        refreshCopyBall(tape.midPrev, -2);
        refreshCopyBall(tape.midNext, 2);
        refreshCopyBall(tape.farNext, 3);

        // Возвращаем покинувший центр шар в матрицу
        returnSlotToWorld(leaving);

        carousel = direction === 1
          ? { farPrev: tape.farPrev, midPrev: tape.midPrev, prev: arrivingSlot, current: arriving, next: farSlot, midNext: tape.midNext, farNext: tape.farNext }
          : { farPrev: tape.farPrev, midPrev: tape.midPrev, prev: farSlot, current: arriving, next: arrivingSlot, midNext: tape.midNext, farNext: tape.farNext };
        
        selectedBall = arriving.ball;
        activeSlots = [
          carousel.farPrev, carousel.midPrev,
          carousel.prev, carousel.current, carousel.next,
          carousel.midNext, carousel.farNext,
        ];

        layoutTape(true);
        focusCommitRef.current(arriving.ball.emotion.id);
      };

      const startSnap = (direction: 1 | -1, pages: number) => {
        snapDirection = direction;
        pendingPages = pages;
        carouselMode = 'snapping';
        carouselBusyRef.current = true;
        targetCarouselOffset = pages > 0 ? -direction * sideStep() : 0;
      };

      const flingCarousel = (direction: 1 | -1, pages: number) => {
        carouselOffset = 0;
        targetCarouselOffset = 0;
        for (let page = 0; page < pages - 1; page += 1) {
          commitCarouselTransition(direction);
        }
        startSnap(direction, 1);
      };

      const driveCarouselTo = (id: string, direction?: 1 | -1) => {
        const tape = carousel;
        if (!tape || carouselBusyRef.current) return;

        const from = emotionIndex(tape.current.ball.emotion.id);
        const to = emotionIndex(id);
        if (from < 0 || to < 0 || from === to) return;

        const dir = direction ?? directionTo(tape.current.ball.emotion.id, id);
        const length = EMOTIONS.length;
        const pages = dir === 1 ? (to - from + length) % length : (from - to + length) % length;
        startSnap(dir, pages);
      };

      const activateHold = (ball: Ball): boolean => {
        if (carouselBusyRef.current || heldIdRef.current || heldBall) return false;
        
        carouselMode = 'idle';
        carouselOffset = 0;
        targetCarouselOffset = 0;
        pendingPages = 0;

        ball.state = SPRITE_COL_FLASH;
        ball.sprite.texture = ball.frames[SPRITE_COL_FLASH];
        if ('vibrate' in navigator) navigator.vibrate(20);
        playGrabSound(ball.emotion.id);

        const globalPos = ball.container.getGlobalPosition();
        ball.container.parent?.removeChild(ball.container);
        pixiApp.stage.addChild(ball.container);
        ball.container.position.set(globalPos.x, globalPos.y);
        ball.container.filters = [];
        ball.container.alpha = 1;
        ball.container.rotation = 0;

        ball.targetX = globalPos.x;
        ball.targetY = globalPos.y + holdOffsetY(ball);
        ball.targetScale = BALL_HOLD_SCALE;
        heldBall = ball;
        onHoldStartRef.current(ball.emotion.id);

        if (selectedBall) onBallClickRef.current(null);

        tween.worldScaleTarget = WORLD_FOCUS_SCALE;
        tween.worldAlphaTarget = WORLD_HOLD_ALPHA;
        tween.worldYTarget = pixiApp.screen.height * WORLD_FOCUS_Y_RATIO;
        tween.blurTarget = WORLD_HOLD_BLUR;

        return true;
      };

      const releaseHold = (id: string) => {
        const ball = heldBall;
        if (!ball || ball.emotion.id !== id) return;
        
        ball.holdActivated = false;
        ball.pressActive = false;
        ball.pressMoved = false;
        ball.state = SPRITE_COL_IDLE;
        ball.sprite.texture = ball.frames[SPRITE_COL_IDLE];

        const globalPos = ball.container.getGlobalPosition();
        const worldScale = world.scale.x;
        ball.container.parent?.removeChild(ball.container);
        world.addChild(ball.container);
        ball.container.position.set(
          (globalPos.x - world.position.x) / worldScale + world.pivot.x,
          (globalPos.y - world.position.y) / worldScale + world.pivot.y
        );
        ball.container.scale.set(ball.container.scale.x / worldScale);
        
        ball.returning = true;
        ball.returnTargetX = ball.baseX;
        ball.returnTargetY = ball.baseY;
        ball.returnTargetScale = 1;
        heldBall = null;
        onHoldEndRef.current();

        tween.worldScaleTarget = 1;
        tween.worldAlphaTarget = 1;
        tween.worldYTarget = pixiApp.screen.height / 2;
        tween.blurTarget = 0;
      };

      holdReleaseRef.current = releaseHold;

      pixiApp.stage.on('pointermove', (event: FederatedPointerEvent) => {
        if (heldBall) {
          heldBall.targetX = event.global.x;
          heldBall.targetY = event.global.y + holdOffsetY(heldBall);
          return;
        }
        if (carouselMode !== 'dragging') return;

        const dx = event.global.x - dragStartX;
        carouselOffset = dragStartOffset + dx;
        if (Math.abs(dx) > CAROUSEL_DRAG_TAP_PX) dragMoved = true;

        const now = performance.now();
        const dt = now - lastDragTime;
        if (dt > 0) {
          dragVelocity = (event.global.x - lastDragX) / dt;
          lastDragX = event.global.x;
          lastDragTime = now;
        }
      });

      const clearPressState = () => {
        for (const ball of balls) {
          ball.pressActive = false;
          ball.pressMoved = false;
        }
      };

      const releaseDrag = (tap: boolean) => {
        if (carouselMode !== 'dragging') return;

        if (tap) {
          carouselMode = 'idle';
          carouselOffset = 0;
          targetCarouselOffset = 0;
          onBallClickRef.current(null);
          return;
        }

        const step = sideStep();
        const shift = carouselOffset !== 0 ? carouselOffset : dragVelocity;
        const direction: 1 | -1 = shift < 0 ? 1 : -1;
        const velocity = Math.abs(dragVelocity);

        let pages = 0;
        if (velocity > CAROUSEL_FLING_VELOCITY_MAX) pages = CAROUSEL_FLING_PAGES_MAX;
        else if (velocity > CAROUSEL_FLING_VELOCITY_MID) pages = CAROUSEL_FLING_PAGES_MID;
        else if (velocity > CAROUSEL_FLICK_VELOCITY) pages = 1;

        if (pages === 0 && Math.abs(carouselOffset) > step * CAROUSEL_SNAP_HALF_RATIO) {
          pages = 1;
        }

        if (pages > 1) {
          flingCarousel(direction, pages);
          return;
        }

        startSnap(direction, pages);
      };

      pixiApp.stage.on('pointerdown', (event: FederatedPointerEvent) => {
        if (!focusedIdRef.current || heldIdRef.current || carouselBusyRef.current || carouselMode !== 'idle') return;
        
        carouselMode = 'dragging';
        carouselOffset = 0;
        targetCarouselOffset = 0;
        dragStartX = event.global.x;
        dragStartOffset = carouselOffset;
        dragStartTime = performance.now();
        dragVelocity = 0;
        lastDragX = event.global.x;
        lastDragTime = dragStartTime;
        dragMoved = false;
      });

      pixiApp.stage.on('pointerup', () => {
        if (heldBall) {
          releaseHold(heldBall.emotion.id);
          clearPressState();
          return;
        }
        clearPressState();
        releaseDrag(!dragMoved && performance.now() - dragStartTime < CAROUSEL_TAP_MS);
      });

      pixiApp.stage.on('pointerupoutside', () => {
        if (heldBall) releaseHold(heldBall.emotion.id);
        clearPressState();
        releaseDrag(false);
      });

      pixiApp.stage.on('pointercancel', () => {
        if (heldBall) releaseHold(heldBall.emotion.id);
        clearPressState();
        releaseDrag(false);
      });

      tween.worldY = pixiApp.screen.height / 2;
      tween.worldYTarget = pixiApp.screen.height / 2;

      applyFocusRef.current = (id, direction) => {
        if (destroyed) return;

        if (id === null) {
          if (carousel) {
            for (const slot of activeSlots) {
              if (slot.kind !== 'ball' || slot === carousel.current) continue;
              returnSlotToWorld(slot);
            }
            if (carousel.current.ball !== heldBall) {
              flySlotHome(carousel.current);
            }
            destroyCopy(carousel.farPrev);
            destroyCopy(carousel.midPrev);
            destroyCopy(carousel.prev);
            destroyCopy(carousel.next);
            destroyCopy(carousel.midNext);
            destroyCopy(carousel.farNext);
            carousel = null;
          }

          carouselMode = 'idle';
          carouselOffset = 0;
          targetCarouselOffset = 0;
          pendingPages = 0;
          tapeEntering = false;
          activeSlots = [];
          carouselBusyRef.current = false;
          selectedBall = null;

          if (!heldBall) {
            tween.worldScaleTarget = 1;
            tween.worldAlphaTarget = 1;
            tween.worldYTarget = pixiApp.screen.height / 2;
            tween.blurTarget = 0;
          }
          return;
        }

        if (carouselBusyRef.current) return;

        if (carousel) {
          if (carousel.current.ball.emotion.id === id) return;
          driveCarouselTo(id, direction);
          return;
        }

        enterFocus(id);
      };

      resizeObserver = new ResizeObserver(() => {
        const width = containerEl.clientWidth;
        const height = containerEl.clientHeight;
        if (width === 0 || height === 0) return;

        pixiApp.renderer.resize(width, height);
        pixiApp.stage.hitArea = pixiApp.screen;
        layoutBalls(pixiApp, balls, world);
        centerWorld(pixiApp, world);
        layoutCarouselLayer();

        if (carousel) {
          syncCopySize(carousel.prev);
          syncCopySize(carousel.next);
          carouselMode = 'idle';
          carouselOffset = 0;
          targetCarouselOffset = 0;
          pendingPages = 0;
          tapeEntering = false;
          carouselBusyRef.current = false;
          layoutTape(true);
        }

        if (selectedBall) {
          tween.worldYTarget = pixiApp.screen.height * WORLD_FOCUS_Y_RATIO;
        } else {
          tween.worldY = pixiApp.screen.height / 2;
          tween.worldYTarget = pixiApp.screen.height / 2;
        }
      });

      resizeObserver.observe(containerEl);

      let fpsWindowStart = performance.now();
      let fpsFrames = 0;
      let degraded = false;

      pixiApp.ticker.add(() => {
        const now = performance.now();
        
        // Детект долгого нажатия для захвата
        for (const ball of balls) {
          if (ball.pressActive && !ball.holdActivated && !ball.pressMoved && now - ball.pressStartTime > HOLD_THRESHOLD) {
            ball.holdActivated = activateHold(ball);
          }
        }

        // Анимация Snap (доводка карусели)
        if (carouselMode === 'snapping') {
          const diff = targetCarouselOffset - carouselOffset;
          carouselOffset += diff * CAROUSEL_SNAP_LERP;

          if (Math.abs(diff) < CAROUSEL_SNAP_EPSILON) {
            if (targetCarouselOffset !== 0) {
              carouselOffset = 0;
              targetCarouselOffset = 0;
              commitCarouselTransition(snapDirection);
              pendingPages -= 1;
            } else {
              carouselOffset = 0;
            }

            if (pendingPages > 0) {
              targetCarouselOffset = -snapDirection * sideStep();
            } else {
              carouselMode = 'idle';
              carouselBusyRef.current = false;
            }
          }
        }

        // Отрисовка карусели
        if (carousel) layoutTape(!tapeEntering);

        // Ведение шарика пальцем
        if (heldBall) {
          heldBall.container.x += (heldBall.targetX - heldBall.container.x) * HOLD_FOLLOW_LERP;
          heldBall.container.y += (heldBall.targetY - heldBall.container.y) * HOLD_FOLLOW_LERP;
          const heldScale = heldBall.container.scale.x;
          heldBall.container.scale.set(heldScale + (heldBall.targetScale - heldScale) * HOLD_SCALE_LERP);
        }

        // Возврат шарика в матрицу
        for (const ball of balls) {
          if (!ball.returning) continue;
          ball.container.x += (ball.returnTargetX - ball.container.x) * HOLD_RETURN_LERP;
          ball.container.y += (ball.returnTargetY - ball.container.y) * HOLD_RETURN_LERP;
          const returnScale = ball.container.scale.x;
          ball.container.scale.set(returnScale + (ball.returnTargetScale - returnScale) * HOLD_RETURN_LERP);

          if (Math.abs(ball.container.x - ball.returnTargetX) < 1 && Math.abs(ball.container.y - ball.returnTargetY) < 1) {
            ball.container.position.set(ball.returnTargetX, ball.returnTargetY);
            ball.container.scale.set(ball.returnTargetScale);
            ball.returning = false;
            ball.nextChangeAt = now + rand(ball.params.intervalMin, ball.params.intervalMax);
          }
        }

        // Живая анимация лиц (покой/движение/вспышка)
        for (const ball of balls) {
          if (ball.holdActivated || ball.returning) continue;
          const p = ball.params;

          if (ball.state === SPRITE_COL_FLASH && now >= ball.state2Until) {
            ball.state = SPRITE_COL_IDLE;
            ball.sprite.texture = ball.frames[SPRITE_COL_IDLE];
            ball.nextChangeAt = now + rand(p.intervalMin, p.intervalMax);
          } else if (ball.state !== SPRITE_COL_FLASH && now >= ball.nextChangeAt) {
            if (ball.state === SPRITE_COL_IDLE) {
              if (Math.random() < p.flashChance) {
                ball.state = SPRITE_COL_FLASH;
                ball.sprite.texture = ball.frames[SPRITE_COL_FLASH];
                ball.state2Until = now + rand(p.flashMin, p.flashMax);
              } else {
                ball.state = SPRITE_COL_MOVE;
                ball.sprite.texture = ball.frames[SPRITE_COL_MOVE];
                ball.nextChangeAt = now + rand(p.intervalMin, p.intervalMax);
              }
            } else {
              ball.state = SPRITE_COL_IDLE;
              ball.sprite.texture = ball.frames[SPRITE_COL_IDLE];
              ball.nextChangeAt = now + rand(p.intervalMin, p.intervalMax);
            }
          }
        }

        // Интерполяция мира (приближение/отдаление при фокусе)
        tween.worldScale = approach(tween.worldScale, tween.worldScaleTarget);
        tween.worldAlpha = approach(tween.worldAlpha, tween.worldAlphaTarget);
        tween.worldY = approach(tween.worldY, tween.worldYTarget);
        tween.blur = approach(tween.blur, tween.blurTarget);

        world.scale.set(tween.worldScale);
        world.alpha = tween.worldAlpha;
        world.position.set(pixiApp.screen.width / 2, tween.worldY);
        worldBlur.strength = tween.blur;

        // Плавное движение слотов карусели
        for (const slot of activeSlots) {
          if (slot.kind === 'ball' && slot.ball.container.parent !== carouselLayer) continue;

          slot.alpha = approach(slot.alpha, slot.alphaTarget);
          slot.x = approach(slot.x, slot.xTarget);
          slot.y = approach(slot.y, slot.yTarget);
          slot.scale = approach(slot.scale, slot.scaleTarget);
          slot.blurStrength = approach(slot.blurStrength, slot.blurTarget);
          drawSlot(slot);
        }

        // Разблокировка карусели после завершения анимации входа
        if (tapeEntering && activeSlots.every(slotArrived)) {
          tapeEntering = false;
          carouselBusyRef.current = false;
        }

        // Оптимизация FPS (снижение качества блюра)
        fpsFrames += 1;
        if (now - fpsWindowStart >= 1000) {
          const fps = (fpsFrames * 1000) / (now - fpsWindowStart);
          if (fps < LOW_FPS_THRESHOLD && !degraded) {
            degraded = true;
            worldBlur.quality = BLUR_QUALITY_LOW;
          }
          fpsWindowStart = now;
          fpsFrames = 0;
        }
      });

      setSceneReady(true);
    };

    void setup();

    return () => {
      destroyed = true;
      applyFocusRef.current = () => {};
      holdReleaseRef.current = () => {};
      focusCommitRef.current = () => {};
      carouselBusyRef.current = false;

      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      
      // === ГАРАНТИРОВАННАЯ ОЧИСТКА ===
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
      if (containerEl) {
        containerEl.innerHTML = '';
      }
    };
  }, []);

  useEffect(() => {
    applyFocusRef.current(focusedId);
  }, [focusedId]);

  useEffect(() => {
    if (focusedId === null) {
      setDailyNote(DAILY_NOTES[Math.floor(Math.random() * DAILY_NOTES.length)]);
    }
  }, [focusedId]);

  const focusedEmotion = focusedId ? (EMOTIONS.find((emotion) => emotion.id === focusedId) ?? null) : null;
  const heldEmotion = heldId ? (EMOTIONS.find((emotion) => emotion.id === heldId) ?? null) : null;
  const navMainColor = (heldEmotion ?? focusedEmotion)?.color;

  return (
    <div className="emotion-space">
      <div ref={containerRef} id="pixi-container" />

      {focusedId === null && heldId === null && (
        <div className="daily-note">{dailyNote}</div>
      )}

      {showHomeIntro && (
        <div className="onboarding-overlay">
          <div className="onboarding-card">
            <div className="onboarding-card__title">Это эмозики</div>
            <div className="onboarding-card__text">
              Твои эмоции. Они здесь обитают и ждут твоего внимания и заботы.
              Не забывай ухаживать за ними. Попробуй тапнуть на одного из них
              или схвати пальцем.
            </div>
            <button
              type="button"
              className="onboarding-card__btn"
              onClick={closeHomeIntro}
            >
              Понятно
            </button>
          </div>
        </div>
      )}

      {showFocusTip && focusedId && (
        <div className="onboarding-tip onboarding-tip--focus">
          Зажми шарик, проговори ситуацию и отпусти. Можешь ничего не
          говорить — это необязательно.
        </div>
      )}

      {showHoldIntro && (
        <div className="onboarding-overlay onboarding-overlay--hold">
          <div className="onboarding-card onboarding-card--plain">
            <div className="onboarding-card__text">
              Ты взял эмоцию в свои руки, обратил на неё внимание. Прямо
              сейчас записывается войс от тебя — проговори, что происходит,
              и отпусти палец.
            </div>
          </div>
        </div>
      )}

      {focusedEmotion && (
        <div className="focus-header">
          <div className="focus-header__title">{focusedEmotion.name}</div>
          <div className="focus-header__annotation">
            {heldEmotion
              ? focusAnnotation(focusedEmotion)
              : focusedEmotion.annotation}
          </div>
        </div>
      )}

      {heldEmotion && (
        <div className="hold-header">
          <div className="hold-header__name">
            {heldEmotion.name.toUpperCase()}
          </div>
          <div className="hold-header__hint">{heldHint(heldEmotion)}</div>
        </div>
      )}

      {focusedId && (
        <div className="emotion-panel">
          <div className="emotion-panel__card">
            <div className="emotion-panel__text">
              {(EMOTION_TEXTS[focusedEmotion?.id ?? ''] || 'Текст скоро появится...')
                .split('\n')
                .map((paragraph, i) => (
                  <p key={i} style={{ marginBottom: '16px' }}>
                    {paragraph}
                  </p>
                ))}
            </div>
          </div>

          <div className="input-hint">
            Напишите что нибудь, задай свой вопрос или запиши мне короткий
            войс — зажми этот экран пальцем. Еще ты можешь взять эмоцию
            (зажми пальцем), если ощущаешь ее сейчас, проговорить ее и
            отпустить…
          </div>
        </div>
      )}

      {heldId && (
        <div className="recording-panel">
          <div className="recording-panel__wave">
            {[...Array(5)].map((_, index) => (
              <div
                key={index}
                className="wave-bar"
                style={{ animationDelay: `${index * 0.1}s` }}
              />
            ))}
          </div>
        </div>
      )}

      <nav className="bottom-nav">
        <button
          type="button"
          className="nav-icon"
          data-icon="main"
          aria-label="Матрица эмоций"
          onClick={() => {
            const held = heldIdRef.current;
            if (held) holdReleaseRef.current(held);
            if (focusedIdRef.current) applyFocusRef.current(null);
            setFocusedId(null);
            setHeldId(null);
          }}
        >
          {navMainColor ? (
            <MainColoredIcon style={{ color: navMainColor }} />
          ) : (
            <MainActiveIcon />
          )}
        </button>

        <button type="button" className="nav-icon" data-icon="dialog" aria-label="Разговоры">
          <DialogIcon />
        </button>

        <button type="button" className="nav-icon" data-icon="explore" aria-label="Исследовать">
          <ExploreIcon />
        </button>

        <button type="button" className="nav-icon" data-icon="user" aria-label="Профиль">
          <UserIcon />
        </button>
      </nav>
    </div>
  );
}