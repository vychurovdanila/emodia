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
import { EMOTIONS, EMOTION_TEXTS, type Emotion, type EmotionMotion } from '@emoza/shared';

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
 * Отступ от краёв канваса (доля от ширины/высоты экрана): 6% — как в
 * REFERENCE.md §3.2 (на экране 390×844 это ≈23 px). Плотность ВНУТРИ
 * матрицы держат SPRITE_SIZE_RATIO и CELL_GAP_RATIO.
 */
const EDGE_PADDING_RATIO = 0.06;

/**
 * Нижняя зона, которую матрица не занимает: высота bottom-nav (64px) плюс
 * воздух под последним рядом. Сетка вписывается в область над ней, поэтому
 * персонажи больше не упираются в иконки навигации.
 */
const BOTTOM_NAV_HEIGHT = 64;
const MATRIX_BOTTOM_MARGIN = 20;

/** Зазор между персонажами внутри ячейки: 1% ячейки — они почти соприкасаются. */
const CELL_GAP_RATIO = 0.01;

/** Радиус хит-ареа как доля от меньшей стороны ячейки: половина ячейки. */
const RADIUS_RATIO = 0.5;

/** Коэффициент инкрементальной интерполяции в ticker. */
const TWEEN_LERP = 0.15;

/** Порог «доехали»: ближе — присваиваем target напрямую. */
const TWEEN_EPSILON = 0.001;

/**
 * Мир в фокусе: сжимается ВОКРУГ СВОЕГО ЦЕНТРА (не уезжает влево),
 * опускается вниз и ПОЛНОСТЬЮ растворяется (alpha 0): за окном текста
 * не остаётся даже намёка на матрицу, читать ничего не мешает.
 */
const WORLD_FOCUS_SCALE = 0.55;
const WORLD_FOCUS_ALPHA = 0;
const WORLD_FOCUS_Y_RATIO = 0.55;

/** Сила расфокуса мира в фокусе. */
const FOCUS_BLUR_STRENGTH = 6;

/**
 * Мир при захвате: в отличие от фокуса, он остаётся ВИДИМЫМ фоном —
 * alpha 0.4 и мягкий блюр 6. Эмозик в руке яркий и резкий, а матрица
 * за ним читается как задний план и не отвлекает.
 */
const WORLD_HOLD_ALPHA = 0.4;
const WORLD_HOLD_BLUR = 6;

/**
 * Лента фокуса: отдельный слой ПОВЕРХ мира, в нём всегда ровно три шара.
 * Центр слоя — верхняя четверть экрана, на уровне стрелок ‹ ›;
 * координаты внутри слоя: prev слева, current в центре, next справа.
 *
 * Из матрицы вынимается ТОЛЬКО центральный шар: пустует одна ячейка.
 * Соседи — декоративные копии (свои спрайты с той же текстурой), их
 * оригиналы продолжают стоять в матрице на своих местах.
 */
const CAROUSEL_Y_RATIO = 0.25;

/**
 * Отступ соседей от центра ленты как доля ширины экрана. Он же — ШАГ ленты:
 * сосед проезжает ровно это расстояние, вставая в центр, поэтому в финале
 * страницы роли меняются, а смещение просто обнуляется — без скачка.
 * 0.40 — замер по герой.jpg: центр соседа стоит в 0.36–0.41 ширины от
 * середины экрана, поэтому шар виден почти целиком (обрезан на ~15 %),
 * как в референсе. При 0.45 и больше сосед уезжает за край экрана и
 * превращается в «цветное пятно» у бортика.
 */
const CAROUSEL_SIDE_X_RATIO = 0.4;

/** Центр ленты — крупный и резкий, соседи — тоже крупные, но в тумане.
 *  2.31 — это 2.2 + 5% (Проход 4): центр ещё чуть крупнее, соседи
 *  (CAROUSEL_SIDE_SCALE) не тронуты. */
const CAROUSEL_CENTER_SCALE = 2.19;
/**
 * Сосед заметно меньше центра: 1.15 при центре 2.2 (=0.52). Соседи — это
 * задний план: они не спорят с центральным персонажем, а лишь намекают
 * на «соседей по ленте».
 */
const CAROUSEL_SIDE_SCALE = 0.98;

/** Туман у края экрана: alpha 0.4 и мягкий блюр 8; в центре — 1 и 0. */
const CAROUSEL_FOG_ALPHA = 0.4;
const CAROUSEL_SIDE_BLUR = 8;

/**
 * Соседи стоят НИЖЕ центра на 12% своего размера: лента читается как
 * глубина — центр впереди, соседи на заднем плане.
 */
const CAROUSEL_SIDE_Y_RATIO = 0.12;

/** Snap после отпускания: инерция, порог «доехали» и доля шага для сноса. */
const CAROUSEL_SNAP_LERP = 0.18;
const CAROUSEL_SNAP_EPSILON = 1;
const CAROUSEL_SNAP_HALF_RATIO = 0.5;

/**
 * Уверенный свайп: скорость пальца в px/мс — едем на одну страницу даже
 * без сноса. Ниже этого порога страницу решает только снос пальца.
 */
const CAROUSEL_FLICK_VELOCITY = 0.5;

/** Жест ленты: сдвиг и время, меньше которых это тап, а не пролистывание. */
const CAROUSEL_DRAG_TAP_PX = 8;
const CAROUSEL_TAP_MS = 300;

/**
 * Бросок ленты: пороги скорости пальца (px/мс) и сколько страниц лента
 * пролистывает за один жест. Быстрый свайп — 5 персонажей, средний — 3,
 * уверенный — 1. Ниже порога решает только снос (см. releaseDrag).
 */
const CAROUSEL_FLING_VELOCITY_MAX = 2.5;
const CAROUSEL_FLING_PAGES_MAX = 5;
const CAROUSEL_FLING_VELOCITY_MID = 1.5;
const CAROUSEL_FLING_PAGES_MID = 3;

/** Качество блюра соседей: фильтров три, поэтому качество ниже, чем у мира. */
const CAROUSEL_BLUR_QUALITY = 3;

/** Качество блюра: высокое по умолчанию, низкое при падении FPS. */
const BLUR_QUALITY_HIGH = 4;
const BLUR_QUALITY_LOW = 2;
const LOW_FPS_THRESHOLD = 50;

/**
 * Персонажи лежат в 6 файлах — по 3 эмоции в каждом. Внутри файла сетка 3×3:
 * строка — эмоция, колонка — состояние. Индекс эмоции в EMOTIONS
 * раскладывается так: файл = floor(index / 3), строка = index % 3.
 */
const SPRITES_PER_FILE = 3;
const TOTAL_SPRITES = 6;

/**
 * Телефон определяем по вьюпорту и user agent: узкому экрану хватает
 * лёгкой версии спрайтов — кадр 250 px вместо 500. Решается один раз
 * при загрузке модуля, до инициализации Pixi.
 */
const isMobile =
  window.matchMedia('(max-width: 768px)').matches ||
  /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const SPRITE_DIR = isMobile ? 'mobile' : 'desktop';
const SPRITE_FRAME_SIZE = isMobile ? 250 : 500;

/** Колонки листа: 0 — покой, 1 — живое шевеление, 2 — вспышка. */
const SPRITE_COLUMNS = [0, 1, 2];
const SPRITE_COL_IDLE = 0;
const SPRITE_COL_MOVE = 1;
const SPRITE_COL_FLASH = 2;

/**
 * Размер персонажа в матрице: доля от размера ячейки. 1.0 — персонаж
 * заполняет свою ячейку (воздух даёт только CELL_GAP_RATIO), поэтому
 * матрица плотная: соседи почти соприкасаются.
 */
const SPRITE_SIZE_RATIO = 1;

/** Захват: сколько держать палец и насколько можно сдвинуться. */
const HOLD_THRESHOLD = 300;
const MOVE_THRESHOLD = 10;

/**
 * Шарик в руке: крупнее фокусного (в ленте центр — 2.31), потому что сейчас
 * он «главнее». 3.5 — это 4.4 - 20% (Проход 4): персонаж больше не упирается
 * в края экрана и не заезжает под шапку. От него же считается holdOffsetY,
 * поэтому персонаж автоматически встаёт над пальцем ровно так же, как при
 * меньшем масштабе.
 */
const BALL_HOLD_SCALE = 3.5;

/** Интерполяция шарика: слежение за пальцем, рост и возврат домой. */
const HOLD_FOLLOW_LERP = 0.35;
const HOLD_SCALE_LERP = 0.2;
const HOLD_RETURN_LERP = 0.18;

/**
 * Точка захвата: палец ложится НИЖЕ центра персонажа, поэтому шарик ведём
 * вверх на 20% его радиуса в руке — лицо остаётся видимым из-под пальца.
 */
const HOLD_FINGER_OFFSET_RATIO = 0.2;

/** Хит-ареа шарика = половина ячейки: соседние круги ровно соприкасаются. */
const HIT_AREA_RATIO = 1;

/**
 * Онбординг: три НЕЗАВИСИМЫХ флага, каждый ждёт своего события.
 * home — первый заход на экран, focusShown — первое попадание в фокус,
 * holdShown — первый долгий захват.
 */
const ONBOARDING_HOME_KEY = 'emoza:onboarding:home';
const ONBOARDING_FOCUS_KEY = 'emoza:onboarding:focusShown';
const ONBOARDING_HOLD_KEY = 'emoza:onboarding:holdShown';
const ONBOARDING_TIP_DURATION = 6000;

/** Центральный шар поднимается в ленту таким, каким стоял в матрице. */
const CAROUSEL_RISING_LOOK: SlotLook = { scale: 1, alpha: 1, blur: 0 };

/** Параметры живого состояния: как часто шевелится и мигает. */
interface MotionParams {
  intervalMin: number;
  intervalMax: number;
  flashMin: number;
  flashMax: number;
  flashChance: number;
}

/** Ритм для каждого типа движения покоя (поле motion у эмоции). */
const MOTION_PARAMS: Record<EmotionMotion, MotionParams> = {
  calm: {
    intervalMin: 2200,
    intervalMax: 4200,
    flashMin: 600,
    flashMax: 1000,
    flashChance: 0.12,
  },
  tense: {
    intervalMin: 800,
    intervalMax: 1800,
    flashMin: 300,
    flashMax: 600,
    flashChance: 0.18,
  },
  heavy: {
    intervalMin: 3200,
    intervalMax: 5600,
    flashMin: 900,
    flashMax: 1500,
    flashChance: 0.08,
  },
};

/** Шарик одной эмоции: спрайт-персонаж, его фреймы и состояние покоя. */
interface Ball {
  /** Позиция/масштаб/поворот: ими управляют layoutBalls и твин фокуса. */
  container: Container;
  /** Персонаж: спрайт из листа эмоций, кадр 500 px (250 px на телефоне). */
  sprite: Sprite;
  /** Три фрейма персонажа: 0 — покой, 1 — живое, 2 — вспышка. */
  frames: [Texture, Texture, Texture];
  /** Показываемый сейчас фрейм: 0, 1 или 2. */
  state: 0 | 1 | 2;
  /** Ритм живого состояния для этого типа движения. */
  params: MotionParams;
  /** Когда снова можно сменить состояние покоя. */
  nextChangeAt: number;
  /** Когда гаснет вспышка (state 2). */
  state2Until: number;
  /** Радиус ячейки, под который посчитан спрайт: 0 — ещё не считали. */
  radius: number;
  hitArea: Circle;
  /** Базовая позиция ОТНОСИТЕЛЬНО ЦЕНТРА МИРА (0,0 = центр экрана). */
  baseX: number;
  baseY: number;
  emotion: Emotion;

  /** Палец сейчас на шарике и ждёт отпускания. */
  pressActive: boolean;
  pressStartTime: number;
  pressStartX: number;
  pressStartY: number;
  /** Палец ушёл дальше MOVE_THRESHOLD — это уже не тап. */
  pressMoved: boolean;
  /** Захват сработал: шарик в руке. */
  holdActivated: boolean;
  /** Куда шарик тянется в руке. */
  targetX: number;
  targetY: number;
  targetScale: number;
  /** Возвращается на место в матрице после отпускания. */
  returning: boolean;
  returnTargetX: number;
  returnTargetY: number;
  returnTargetScale: number;
}

/** Колбэки шарика: короткий тап и отпускание захвата. */
interface BallHandlers {
  /** Короткий тап: показать эмоцию в фокусе. */
  onTap: (id: string) => void;
  /** Захват отпущен: вернуть шарик в матрицу. */
  onHoldEnd: (id: string) => void;
}

/**
 * Текущее и целевое значение каждого анимируемого параметра МИРА.
 * Слоты ленты ведёт отдельный твин (см. SlotBase): мир и лента
 * двигаются независимо — матрица стоит, лента едет.
 */
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
    worldScale: 1,
    worldScaleTarget: 1,
    worldAlpha: 1,
    worldAlphaTarget: 1,
    worldY: 0,
    worldYTarget: 0,
    blur: 0,
    blurTarget: 0,
  };
}

/** Внешний вид шара в ленте: размер, прозрачность и размытие. */
interface SlotLook {
  scale: number;
  alpha: number;
  blur: number;
}

/**
 * Общая часть слота ленты: место, размер, прозрачность и СВОЙ BlurFilter.
 * Фильтр обязан быть личным: иначе соседей не размыть отдельно от центра.
 * У центрального шара это его собственный контейнер, у копий соседей —
 * отдельный контейнер со спрайтом; ведёт их один и тот же ticker.
 */
interface SlotBase {
  /** Контейнер слота: шар или декоративная копия. */
  container: Container;
  blur: BlurFilter;
  /** Блюр реально висит на контейнере: при strength 0 фильтр снят совсем. */
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

/** Центр ленты: настоящий шар, вынутый из своей ячейки матрицы. */
interface BallSlot extends SlotBase {
  kind: 'ball';
  ball: Ball;
}

/**
 * Декоративная копия соседа: свой спрайт с ТОЙ ЖЕ текстурой и свой
 * контейнер. Матрицу не трогает — оригинал остаётся в своей ячейке.
 * Тапы копия НЕ ловит: она декорация, поэтому тап по ней снимает фокус
 * так же, как тап по пустому месту.
 */
interface CopySlot extends SlotBase {
  kind: 'copy';
  /** Спрайт копии: размер совпадает с размером персонажа в матрице. */
  sprite: Sprite;
  /** Эмоция, чей кадр копия показывает сейчас. */
  ball: Ball;
}

/** Слот ленты: центр или декоративная копия соседа. */
type TapeSlot = BallSlot | CopySlot;

/** Семёрка ленты: prev/current/next — видимые на экране,
 *  farPrev/midPrev — слева за границей, midNext/farNext — справа за границей.
 *  Дополнительные слоты рендерятся для прелоада спрайтов: пользователь не
 *  видит процесс загрузки текстуры при свайпе. */
interface Carousel {
  farPrev: CopySlot;   // -3 шага (прелоад, за экраном)
  midPrev: CopySlot;   // -2 шага (прелоад, у края)
  prev: CopySlot;      // -1 шаг (видимый левый)
  current: BallSlot;   // 0 (центр)
  next: CopySlot;      // +1 шаг (видимый правый)
  midNext: CopySlot;   // +2 шага (прелоад, у края)
  farNext: CopySlot;   // +3 шага (прелоад, за экраном)
}

/**
 * Куда ведём шарик в руке: палец захватывает его НИЖЕ центра, поэтому центр
 * персонажа поднимаем на 20% его радиуса в руке. Считаем от размера в руке
 * (BALL_HOLD_SCALE), а не от текущего масштаба: иначе шарик «дрожал» бы,
 * пока растёт после захвата.
 */
function holdOffsetY(ball: Ball): number {
  return -ball.radius * BALL_HOLD_SCALE * HOLD_FINGER_OFFSET_RATIO;
}

/**
 * Куда ленте ехать до нужной эмоции: короткий путь по кругу.
 * +1 — вперёд (лента едет влево), -1 — назад (лента едет вправо).
 */
function directionTo(fromId: string, toId: string): 1 | -1 {
  const length = EMOTIONS.length;
  const from = EMOTIONS.findIndex((emotion) => emotion.id === fromId);
  const to = EMOTIONS.findIndex((emotion) => emotion.id === toId);
  const forward = (to - from + length) % length;

  return forward <= length / 2 ? 1 : -1;
}

/**
 * Один шаг интерполяции: current += (target - current) * 0.15.
 * Когда остаток меньше TWEEN_EPSILON — сразу возвращаем target
 * (параметр считается доехавшим и больше не интерполируется).
 */
function approach(current: number, target: number): number {
  if (Math.abs(target - current) < TWEEN_EPSILON) {
    return target;
  }

  return current + (target - current) * TWEEN_LERP;
}

/** Случайное число из диапазона [min, max]. */
function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Подсказка под именем эмоции: что делать, пока шарик в руке. */
function heldHint(emotion: Emotion): string {
  if (emotion.kind === 'positive') {
    return 'Проговори и закрепи';
  }

  if (emotion.kind === 'neutral') {
    return 'Проговори и наблюдай';
  }

  return 'Проговори и отпусти';
}

/**
 * Аннотация под заголовком фокуса — та же фраза, что ждёт эмозика при
 * захвате, но со строчной буквы: в герой.jpg аннотация идёт строчными.
 */
function focusAnnotation(emotion: Emotion): string {
  return heldHint(emotion).toLowerCase();
}

/**
 * Звук взятия шарика: для каждой эмоции есть два варианта (${id}-1.mp3,
 * ${id}-2.mp3), играем случайный. Если файл не найден или плеер молчит,
 * захват работает как обычно.
 */
function playGrabSound(emotionId: string): void {
  try {
    // Выбираем случайный вариант: 1 или 2
    const variant = Math.random() > 0.5 ? '1' : '2';
    const audio = new Audio(`/sounds/${emotionId}-${variant}.mp3`);
    audio.volume = 0.6;
    void audio.play().catch(() => {});
  } catch {
    // Звук необязателен: без него захват работает как обычно.
  }
}

/** Показан ли уже этот шаг онбординга. localStorage может быть недоступен. */
function readOnboardingFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** Ставит флаг онбординга (в приватном режиме просто игнорируется). */
function markOnboardingFlag(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // Ничего страшного: подсказка покажется в следующий раз.
  }
}

/**
 * Ставит pivot в ЦЕНТР МИРА и центрирует мир на экране.
 *
 * Без этого мир при фокусе сжимался бы к локальному (0,0) — то есть
 * к верхнему левому углу сетки — и уезжал влево. Pivot обязан
 * совпадать с центром локальных bounds мира: формула `world.width / 2`
 * дала бы центр только для раскладки, начинающейся с нуля,
 * а у нас координаты шариков центрированы вокруг нуля (см. layoutBalls).
 */
function centerWorld(app: Application, world: Container): void {
  const bounds = world.getLocalBounds();

  world.pivot.set(
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
  );
  world.position.set(app.screen.width / 2, app.screen.height / 2);
}

/**
 * Пересчитывает геометрию шариков под текущий размер канваса.
 * Вызывается после инициализации Pixi и из ResizeObserver.
 *
 * Координаты считаются ОТНОСИТЕЛЬНО ЦЕНТРА МИРА (0,0 = центр экрана),
 * поэтому pivot мира = центр сетки, а не её левый верхний угол.
 */
function layoutBalls(app: Application, balls: Ball[], matrix: Container): void {
  const paddingX = app.screen.width * EDGE_PADDING_RATIO;
  const paddingY = app.screen.height * EDGE_PADDING_RATIO;

  // Рабочая высота = экран минус bottom-nav и воздух под ним: сетка вписана
  // в область над иконками, поэтому нижний ряд персонажей не упирается
  // в навигацию.
  const usableHeight =
    app.screen.height - BOTTOM_NAV_HEIGHT - MATRIX_BOTTOM_MARGIN;

  const cellW = (app.screen.width - paddingX * 2) / GRID_COLS;
  const cellH = (usableHeight - paddingY * 2) / GRID_ROWS;
  const cell = Math.min(cellW, cellH);
  // Радиус = половина ячейки: по нему считаются хит-ареа и точка захвата.
  const radius = cell * RADIUS_RATIO;
  // Персонаж заполняет ячейку минус маленький зазор: матрица плотная.
  const spriteSize = cell * SPRITE_SIZE_RATIO - cell * CELL_GAP_RATIO;

  const originX = app.screen.width / 2;
  const originY = app.screen.height / 2;

  for (const ball of balls) {
    const colIndex = ball.emotion.gridPosition.col - 1;
    const rowIndex = ball.emotion.gridPosition.row - 1;

    ball.baseX = paddingX + colIndex * cellW + cellW / 2 - originX;
    ball.baseY = paddingY + rowIndex * cellH + cellH / 2 - originY;

    // Персонаж: размер спрайта пересчитываем только если радиус изменился.
    if (ball.radius !== radius) {
      ball.sprite.width = spriteSize;
      ball.sprite.height = spriteSize;
      ball.radius = radius;
    }

    // Хит-ареа = половина ячейки: соседние круги ровно соприкасаются.
    ball.hitArea.radius = radius * HIT_AREA_RATIO;

    // Центр ленты и шарик в руке живут вне матрицы — их позицию ведёт
    // ticker, поэтому здесь их не трогаем: ячейка пустует. Соседи ленты —
    // декоративные копии, их оригиналы матрицу не покидают.
    if (ball.container.parent === matrix) {
      ball.container.position.set(ball.baseX, ball.baseY);
    }
  }
}

/** Создаёт шарик эмоции: плоский круг и хит-ареа. */
function createBall(
  emotion: Emotion,
  frames: [Texture, Texture, Texture],
  handlers: BallHandlers,
): Ball {
  // Радиус здесь условный — layoutBalls() проставит реальный.
  const hitArea = new Circle(0, 0, 1);

  const container = new Container();
  container.eventMode = 'static';
  container.cursor = 'pointer';
  container.hitArea = hitArea;

  // Персонаж: спрайт из листа. События он не ловит,
  // поэтому event.target — всегда контейнер шарика.
  const sprite = new Sprite(frames[SPRITE_COL_IDLE]);
  sprite.anchor.set(0.5);
  sprite.eventMode = 'none';
  container.addChild(sprite);

  const params = MOTION_PARAMS[emotion.motion];

  const ball: Ball = {
    container,
    sprite,
    frames,
    // Начинаем с кадра покоя: дальше его меняет логика живого состояния.
    state: SPRITE_COL_IDLE,
    params,
    nextChangeAt:
      performance.now() + rand(params.intervalMin, params.intervalMax),
    state2Until: 0,
    // 0 — размер спрайта ещё не считали: это сделает layoutBalls.
    radius: 0,
    hitArea,
    baseX: 0,
    baseY: 0,
    emotion,

    pressActive: false,
    pressStartTime: 0,
    pressStartX: 0,
    pressStartY: 0,
    pressMoved: false,
    holdActivated: false,
    targetX: 0,
    targetY: 0,
    targetScale: 1,
    returning: false,
    returnTargetX: 0,
    returnTargetY: 0,
    returnTargetScale: 1,
  };

  // Палец: короткий тап открывает эмоцию, долгий захват берёт в руку.
  container.on('pointerdown', (event: FederatedPointerEvent) => {
    if (ball.holdActivated || ball.returning) {
      return;
    }

    ball.pressActive = true;
    ball.pressMoved = false;
    ball.pressStartTime = performance.now();
    ball.pressStartX = event.global.x;
    ball.pressStartY = event.global.y;
  });

  container.on('globalpointermove', (event: FederatedPointerEvent) => {
    if (!ball.pressActive) {
      return;
    }

    const dx = event.global.x - ball.pressStartX;
    const dy = event.global.y - ball.pressStartY;

    if (Math.hypot(dx, dy) > MOVE_THRESHOLD) {
      ball.pressMoved = true;
    }
  });

  container.on('pointerup', (event: FederatedPointerEvent) => {
    if (!ball.pressActive) {
      return;
    }

    ball.pressActive = false;

    // Захват уже сработал в ticker: дальше шарик ведёт сцена.
    if (ball.holdActivated) {
      handlers.onHoldEnd(ball.emotion.id);
      return;
    }

    const dt = performance.now() - ball.pressStartTime;
    const dx = event.global.x - ball.pressStartX;
    const dy = event.global.y - ball.pressStartY;
    const moved = Math.hypot(dx, dy);

    // Палец повёл — это не тап и не удержание: жест отдаём сцене (свайп).
    if (moved > MOVE_THRESHOLD) {
      return;
    }

    // Удержание обрабатывает ticker: только он видит, что палец не двигался.
    if (dt < HOLD_THRESHOLD) {
      handlers.onTap(ball.emotion.id);
    }
  });

  return ball;
}

/**
 * Ежедневная заметка на главном экране: смесь цитат и «новостей» мира
 * Эмодиа. Показывается, только когда нет ни фокуса, ни захвата; текст
 * меняется при каждом возврате на главный (см. useEffect в компоненте).
 * Пишется от сути, без канцелярских вступлений («Мысль дня:») — заметка
 * сразу говорит то, что хочет сказать.
 */
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

  /** Тап по шарику: читается из Pixi, пишется из React. */
  const onBallClickRef = useRef<(id: string | null) => void>(() => {});
  /**
   * Мост «React-состояние → Pixi»: применяет фокус к сцене.
   * direction задаёт стрелка или свайп; если её нет (тап по шарику
   * в матрице) сцена сама выберет короткий путь по кругу.
   */
  const applyFocusRef = useRef<
    (id: string | null, direction?: 1 | -1) => void
  >(() => {});
  /** Захват: Pixi сообщает React, что шарик взят в руку. */
  const onHoldStartRef = useRef<(id: string) => void>(() => {});
  /** Отпускание: Pixi сообщает React, что шарик отпущен. */
  const onHoldEndRef = useRef<() => void>(() => {});
  /** Что сцена делает при отпускании захвата: пишет setup сцены. */
  const holdReleaseRef = useRef<(id: string) => void>(() => {});
  /** Финал перелистывания: сцена сообщает React, какая эмоция в фокусе. */
  const focusCommitRef = useRef<(id: string) => void>(() => {});

  /**
   * Лента едет: пока анимация не кончилась, клики по матрице, стрелки,
   * свайпы и захват ждут. Пишет сцена, читает React.
   */
  const carouselBusyRef = useRef(false);

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [heldId, setHeldId] = useState<string | null>(null);

  /** Ежедневная заметка на главном: случайная строка из DAILY_NOTES. */
  const [dailyNote, setDailyNote] = useState(
    () => DAILY_NOTES[Math.floor(Math.random() * DAILY_NOTES.length)],
  );

  /** Актуальные фокус и захват для Pixi-обработчиков (без ререндера). */
  const focusedIdRef = useRef<string | null>(null);
  const heldIdRef = useRef<string | null>(null);

  /** Сцена инициализирована: онбординг показываем только по готовой сцене. */
  const [sceneReady, setSceneReady] = useState(false);
  /** Онбординг 1: карточка «Это эмозики» при первом заходе. */
  const [showHomeIntro, setShowHomeIntro] = useState(false);
  /** Онбординг 2: плашка про удержание при первом попадании в фокус. */
  const [showFocusTip, setShowFocusTip] = useState(false);
  /** Онбординг 3: карточка про запись при первом долгом захвате. */
  const [showHoldIntro, setShowHoldIntro] = useState(false);

  const handleBallClick = useCallback((id: string | null) => {
    // Идёт перелистывание: клики по матрице не принимаем.
    if (carouselBusyRef.current) {
      return;
    }

    // Шарик в руке: сцена занята удержанием, фокус не переключаем.
    if (heldIdRef.current) {
      return;
    }

    setFocusedId((current) => (id === null ? null : current === id ? null : id));
  }, []);

  const handleHoldStart = useCallback((id: string) => {
    setHeldId(id);
  }, []);

  const handleHoldEnd = useCallback(() => {
    setHeldId(null);
  }, []);

  /** Финал перелистывания: новая эмоция в фокусе — обновляем заголовок. */
  const handleFocusCommit = useCallback((id: string) => {
    focusedIdRef.current = id;
    setFocusedId(id);
  }, []);

  useEffect(() => {
    onBallClickRef.current = handleBallClick;
  }, [handleBallClick]);

  useEffect(() => {
    onHoldStartRef.current = handleHoldStart;
  }, [handleHoldStart]);

  useEffect(() => {
    onHoldEndRef.current = handleHoldEnd;
  }, [handleHoldEnd]);

  useEffect(() => {
    focusedIdRef.current = focusedId;
  }, [focusedId]);

  useEffect(() => {
    heldIdRef.current = heldId;
  }, [heldId]);

  useEffect(() => {
    focusCommitRef.current = handleFocusCommit;
  }, [handleFocusCommit]);

  // ── Онбординг: три независимых шага, у каждого свой флаг ──

  // Шаг 1: «Это эмозики» — один раз при первом заходе, по готовой сцене.
  useEffect(() => {
    if (sceneReady && !readOnboardingFlag(ONBOARDING_HOME_KEY)) {
      setShowHomeIntro(true);
    }
  }, [sceneReady]);

  /** «Понятно»: закрываем карточку и больше её не показываем. */
  const closeHomeIntro = useCallback(() => {
    setShowHomeIntro(false);
    markOnboardingFlag(ONBOARDING_HOME_KEY);
  }, []);

  // Шаг 2: плашка про удержание — при ПЕРВОМ попадании в фокус, любым
  // способом (тап, стрелки, свайп). Висит 6 секунд.
  useEffect(() => {
    if (!focusedId || readOnboardingFlag(ONBOARDING_FOCUS_KEY)) {
      return;
    }

    setShowFocusTip(true);
    markOnboardingFlag(ONBOARDING_FOCUS_KEY);

    const timer = window.setTimeout(() => {
      setShowFocusTip(false);
    }, ONBOARDING_TIP_DURATION);

    return () => {
      clearTimeout(timer);
      // Ушли из фокуса раньше таймера — плашка гаснет вместе с фокусом.
      setShowFocusTip(false);
    };
  }, [focusedId]);

  // Шаг 3: карточка про запись — при первом долгом захвате. Держим её,
  // пока шарик в руке, флаг ставим на отпускании: иначе подсказку
  // не успеть прочитать.
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

    if (!containerEl) {
      return;
    }

    let app: Application | null = null;
    let destroyed = false;
    let resizeObserver: ResizeObserver | null = null;

    const setup = async () => {
      // ── Спрайты персонажей: 6 файлов по 3 эмоции, порядок строк — ──
      // ── порядок EMOTIONS. Телефон получает лёгкую версию.        ──
      const spriteSources: TextureSource[] = [];

      for (let i = 1; i <= TOTAL_SPRITES; i++) {
        const path = `/emotions/${SPRITE_DIR}/sprites-${i}.png`;
        const texture = await Assets.load<Texture>(path);

        spriteSources.push(texture.source);
      }

      const pixiApp = new Application();

      await pixiApp.init({
        width: containerEl.clientWidth,
        height: containerEl.clientHeight,
        background: 0xf5f0e8,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
      });

      // StrictMode монтирует эффект дважды: второй запуск не должен
      // оставить в DOM осиротевший канвас.
      if (destroyed) {
        pixiApp.destroy(true, { children: true });
        return;
      }

      app = pixiApp;
      containerEl.appendChild(pixiApp.canvas);

      // ── Мир: все 18 шариков лежат в одном контейнере, поэтому ──
      // ── масштаб, сдвиг и блюр применяются к сцене целиком.   ──
      const world = new Container();
      const worldBlur = new BlurFilter({
        strength: 0,
        quality: BLUR_QUALITY_HIGH,
      });
      world.filters = [worldBlur];
      pixiApp.stage.addChild(world);

      // ── Лента фокуса: отдельный слой ПОВЕРХ мира. ──
      // Внутри слоя свои координаты: (0, 0) — верхняя четверть экрана,
      // prev слева, current в центре, next справа. Мир сюда не входит,
      // поэтому блюр и сжатие матрицы шарики ленты не задевают.
      const carouselLayer = new Container();
      pixiApp.stage.addChild(carouselLayer);

      /** Ставит слой ленты в верхнюю четверть экрана. */
      const layoutCarouselLayer = () => {
        carouselLayer.position.set(
          pixiApp.screen.width / 2,
          // -15px (Проход 5; было +10px): весь ряд ленты поднят на 25px выше.
          pixiApp.screen.height * CAROUSEL_Y_RATIO - 15,
        );
      };

      layoutCarouselLayer();

      const balls: Ball[] = EMOTIONS.map((emotion, index) => {
        // Тройка эмоций на файл: файл = index / 3, строка в файле = index % 3,
        // колонка = состояние персонажа (покой / живое / вспышка).
        const fileIdx = Math.floor(index / SPRITES_PER_FILE);
        const rowInFile = index % SPRITES_PER_FILE;
        const source = spriteSources[fileIdx];

        const frames = SPRITE_COLUMNS.map(
          (col) =>
            new Texture({
              source,
              frame: new Rectangle(
                col * SPRITE_FRAME_SIZE,
                rowInFile * SPRITE_FRAME_SIZE,
                SPRITE_FRAME_SIZE,
                SPRITE_FRAME_SIZE,
              ),
            }),
        ) as [Texture, Texture, Texture];

        const ball = createBall(emotion, frames, {
          onTap: (id) => onBallClickRef.current(id),
          onHoldEnd: (id) => holdReleaseRef.current(id),
        });

        world.addChild(ball.container);

        return ball;
      });

      // Раскладка + центрирование: pivot в центре мира, position —
      // в центре экрана, чтобы сжатие при фокусе было симметричным.
      layoutBalls(pixiApp, balls, world);
      centerWorld(pixiApp, world);

      // ── Клик по пустому месту сбрасывает фокус. ──
      // graphics.eventMode = 'none', поэтому event.target — либо
      // контейнер шарика, либо сам stage.
      pixiApp.stage.eventMode = 'static';
      pixiApp.stage.hitArea = pixiApp.screen;
      pixiApp.stage.on('pointertap', (event) => {
        if (event.target === pixiApp.stage) {
          onBallClickRef.current(null);
        }
      });

      let selectedBall: Ball | null = null;
      /** Шарик в руке: он живёт на stage и следует за пальцем. */
      let heldBall: Ball | null = null;
      const tween = createTween();

      // ── Лента фокуса: три шара над матрицей ──
      /** Текущий состав ленты: null, когда фокуса нет. */
      let carousel: Carousel | null = null;
      /** Слоты, которые ведёт ticker: ровно три слота ленты. */
      let activeSlots: TapeSlot[] = [];

      // ── Жест ленты: палец ведёт смещение, отпускание доводит страницу ──
      /** Режим ленты: покой, палец ведёт ленту, доводка к странице. */
      let carouselMode: 'idle' | 'dragging' | 'snapping' = 'idle';
      /** Смещение ленты: 0 — центр на месте, ±шаг — сосед встал в центр. */
      let carouselOffset = 0;
      /** Куда едет смещение во время snap. */
      let targetCarouselOffset = 0;
      /** Где начался жест: точка пальца и смещение ленты в тот момент. */
      let dragStartX = 0;
      let dragStartOffset = 0;
      let dragStartTime = 0;
      /** Последняя точка замера скорости пальца (px/мс). */
      let lastDragX = 0;
      let lastDragTime = 0;
      let dragVelocity = 0;
      /** Палец сдвинулся дальше CAROUSEL_DRAG_TAP_PX — это уже не тап. */
      let dragMoved = false;
      /** Куда едет snap и сколько страниц ему ещё проехать. */
      let snapDirection: 1 | -1 = 1;
      let pendingPages = 0;
      /** Центр поднимается из матрицы: цели ставит вход, а не смещение. */
      let tapeEntering = false;

      /** Индекс эмоции в EMOTIONS: -1, если такой нет. */
      const emotionIndex = (id: string) =>
        EMOTIONS.findIndex((emotion) => emotion.id === id);

      /** Шар-сосед по кругу: порядок ленты — это порядок EMOTIONS. */
      const neighbourBall = (index: number, offset: number) =>
        balls[(index + offset + EMOTIONS.length) % EMOTIONS.length];

      /** Шаг ленты: путь соседа до центра и он же ширина страницы. */
      const sideStep = () => pixiApp.screen.width * CAROUSEL_SIDE_X_RATIO;

      /** Близость точки ленты к центру: 1 — в центре, 0 — у края экрана. */
      const centerProgress = (x: number) =>
        Math.max(0, 1 - Math.abs(x) / pixiApp.screen.width);

      /**
       * Куда слоту ехать и каким стать на месте x: в центре персонаж крупный
       * и резкий, к краям тает в тумане. Функция ставит ТОЛЬКО цели. В
       * режиме входа в фокус (layoutTape(false)) к целям ведёт approach в
       * ticker — отсюда «проявление из тумана». В режиме следования
       * (layoutTape(true)) placeSlotAt тут же переносит цели в текущие
       * значения, чтобы лента за пальцем (и за snap) стояла ровно по месту.
       */
      /** Насколько сосед опущен: 12% его собственного размера на экране. */
      const sideYOffset = (slot: TapeSlot) =>
        slot.ball.sprite.width * CAROUSEL_SIDE_SCALE * CAROUSEL_SIDE_Y_RATIO;

      const aimSlotAt = (slot: TapeSlot, x: number) => {
        const progress = centerProgress(x);

        slot.xTarget = x;
        // В центре слот ровно на линии ленты, у края — ниже: задний план.
        slot.yTarget = (1 - progress) * sideYOffset(slot);
        slot.scaleTarget =
          CAROUSEL_SIDE_SCALE +
          (CAROUSEL_CENTER_SCALE - CAROUSEL_SIDE_SCALE) * progress;
        slot.alphaTarget =
          CAROUSEL_FOG_ALPHA + (1 - CAROUSEL_FOG_ALPHA) * progress;
        slot.blurTarget = (1 - progress) * CAROUSEL_SIDE_BLUR;
      };

      /**
       * Лента едет за пальцем: всё состояние ставим напрямую, без инерции —
       * x, y, масштаб, туман и блюр определяются ТОЛЬКО позицией. Иначе
       * размер догонял бы место с лагом (approach 15%/кадр): во время snap
       * соседи выглядели бы «не на своём месте», а ПОСЛЕ коммита ещё
       * полсекунды продолжали бы расти/ужиматься — эквивалент мигания.
       * Позиция меняется плавно (snap или палец), значит плавно меняется
       * и всё остальное; там, где лента остановилась, всё уже в финале.
       */
      const placeSlotAt = (slot: TapeSlot, x: number) => {
        aimSlotAt(slot, x);
        slot.x = x;
        slot.y = slot.yTarget;
        // Соседи так же остаются ниже центра — иначе при перетаскивании
        // они бы «подпрыгивали» (y уже считается от centerProgress).
        slot.scale = slot.scaleTarget;
        slot.alpha = slot.alphaTarget;
        slot.blurStrength = slot.blurTarget;
      };

      /**
       * Раскладывает тройку по текущему смещению: prev слева, current
       * в центре, next справа. follow = false — вход в фокус: центр едет
       * из своей ячейки, поэтому место только задаётся целью.
       */
      const layoutTape = (follow: boolean) => {
        if (!carousel) {
          return;
        }

        const offset = carouselOffset;
        const step = sideStep();
        const place = follow ? placeSlotAt : aimSlotAt;

        // Прелоад-слоты за границей экрана (невидимы для пользователя)
        place(carousel.farPrev, -3 * step + offset);
        place(carousel.midPrev, -2 * step + offset);
        // Видимые на экране
        place(carousel.prev, -step + offset);
        place(carousel.current, offset);
        place(carousel.next, step + offset);
        // Прелоад-слоты за границей экрана
        place(carousel.midNext, 2 * step + offset);
        place(carousel.farNext, 3 * step + offset);
      };

      /** Переносит текущие значения слота в его контейнер. */
      const drawSlot = (slot: TapeSlot) => {
        slot.container.position.set(slot.x, slot.y);
        slot.container.scale.set(slot.scale);
        slot.container.alpha = slot.alpha;

        // Блюр прикрепляем один раз и больше не открепляем: повторное
        // прикрепление при переходе от 0 к ненулевому значению вызывает
        // скачок/мигание (фильтр меняет способ рендера контейнера).
        // Нулевая сила — визуальный no-op.
        if (!slot.blurAttached) {
          slot.container.filters = [slot.blur];
          slot.blurAttached = true;
        }

        slot.blur.strength = slot.blurStrength;
      };

      /** Слот доехал: все параметры равны целям. */
      const slotArrived = (slot: TapeSlot) =>
        slot.x === slot.xTarget &&
        slot.y === slot.yTarget &&
        slot.scale === slot.scaleTarget &&
        slot.alpha === slot.alphaTarget &&
        slot.blurStrength === slot.blurTarget;

      /**
       * Конструктор центрального слота: забирает НАСТОЯЩИЙ шар из матрицы
       * (его ячейка пустеет) и ставит стартовые значения — дальше ведёт ticker.
       */
      const createSlot = (
        ball: Ball,
        x: number,
        y: number,
        look?: SlotLook,
      ): BallSlot => {
        ball.container.parent?.removeChild(ball.container);
        carouselLayer.addChild(ball.container);

        // Прошлый блюр мог остаться на шарике: начинаем с чистого листа.
        ball.container.filters = [];

        // В ленте персонаж замирает на кадре покоя и стоит ровно.
        // returning снимаем: шарик мог ещё ехать домой, если лента его
        // перехватила на полпути, — теперь им управляет слот.
        ball.state = SPRITE_COL_IDLE;
        ball.sprite.texture = ball.frames[SPRITE_COL_IDLE];
        ball.container.rotation = 0;
        ball.pressActive = false;
        ball.returning = false;

        const slot: BallSlot = {
          kind: 'ball',
          ball,
          container: ball.container,
          blur: new BlurFilter({ strength: 0, quality: CAROUSEL_BLUR_QUALITY }),
          blurAttached: false,
          x,
          y,
          scale: look ? look.scale : CAROUSEL_CENTER_SCALE,
          alpha: look ? look.alpha : 1,
          blurStrength: look ? look.blur : 0,
          xTarget: x,
          yTarget: y,
          scaleTarget: CAROUSEL_CENTER_SCALE,
          alphaTarget: 1,
          blurTarget: 0,
        };

        // Место в ленте задаёт смещение: цели ставим сразу, а сам слот
        // сходится к ним через approach (вход в фокус — подъём из ячейки).
        aimSlotAt(slot, x);

        // Блюр набирается плавно: резкий скачок размытия выглядит грязно.
        drawSlot(slot);
        activeSlots.push(slot);

        return slot;
      };

      /** Центр поднимается в ленту из своей ячейки: старт — место на экране. */
      const attachFromMatrix = (ball: Ball): BallSlot => {
        const globalPos = ball.container.getGlobalPosition();

        return createSlot(
          ball,
          globalPos.x - carouselLayer.x,
          globalPos.y - carouselLayer.y,
          CAROUSEL_RISING_LOOK,
        );
      };

      /**
       * Копия повторяет персонажа своей эмоции один в один: после ресайза
       * матрица пересчитана, поэтому размер спрайта берём у шара.
       */
      const syncCopySize = (copy: CopySlot) => {
        copy.sprite.width = copy.ball.sprite.width;
        copy.sprite.height = copy.ball.sprite.height;
      };

      /**
       * Декоративная копия соседа: СВОЙ контейнер и спрайт с общей
       * текстурой. Оригинальный шар остаётся в матрице нетронутым.
       * look — с каких значений копия начинает: так прежний центр
       * становится соседом без скачка, а новая копия рождается из нуля.
       */
      const createCopy = (ball: Ball, x: number, look?: SlotLook): CopySlot => {
        const container = new Container();
        const sprite = new Sprite(ball.frames[SPRITE_COL_IDLE]);

        sprite.anchor.set(0.5);
        sprite.eventMode = 'none';

        // Копия — декорация: тапы она не ловит, поэтому тап по ней уходит
        // в stage и снимает фокус. Переключать фокус на соседа нельзя.
        container.eventMode = 'none';
        container.addChild(sprite);

        carouselLayer.addChild(container);

        const copy: CopySlot = {
          kind: 'copy',
          container,
          sprite,
          ball,
          blur: new BlurFilter({ strength: 0, quality: CAROUSEL_BLUR_QUALITY }),
          blurAttached: false,
          x,
          y: 0,
          scale: CAROUSEL_SIDE_SCALE,
          // Новая копия рождается из нуля: alpha наберёт approach.
          alpha: 0,
          blurStrength: 0,
          xTarget: x,
          yTarget: 0,
          scaleTarget: CAROUSEL_SIDE_SCALE,
          alphaTarget: CAROUSEL_FOG_ALPHA,
          blurTarget: CAROUSEL_SIDE_BLUR,
        };

        syncCopySize(copy);

        // Место и туман — по текущему смещению; стартовые значения берём
        // у прежнего центра (look), чтобы сосед встал на место без скачка.
        placeSlotAt(copy, x);
        copy.alpha = look ? look.alpha : 0;
        copy.scale = look ? look.scale : copy.scaleTarget;
        copy.blurStrength = look ? look.blur : copy.blurTarget;

        drawSlot(copy);
        activeSlots.push(copy);

        return copy;
      };

      /**
       * Копия — декорация: при снятии фокуса и смене страницы её убираем.
       */
      const destroyCopy = (copy: CopySlot) => {
        copy.container.parent?.removeChild(copy.container);
        copy.container.destroy({ children: true });
      };

      /** Возвращает шар из ленты в матрицу: место своё, блюр снят. */
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
        ball.nextChangeAt =
          performance.now() +
          rand(ball.params.intervalMin, ball.params.intervalMax);
      };

      /**
       * Отпускает шар ленты домой плавно: место в мире пересчитываем от
       * его положения на экране (мир сжат и сдвинут вниз), дальше его
       * доводит ticker по флагу returning.
       */
      const flySlotHome = (slot: BallSlot) => {
        const ball = slot.ball;
        const globalPos = ball.container.getGlobalPosition();
        const worldScale = world.scale.x;

        ball.container.filters = [];
        ball.container.parent?.removeChild(ball.container);
        world.addChild(ball.container);
        ball.container.position.set(
          (globalPos.x - world.position.x) / worldScale + world.pivot.x,
          (globalPos.y - world.position.y) / worldScale + world.pivot.y,
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

      /**
       * Вход в фокус: вокруг выбранной эмоции собирается лента, а мир
       * уходит в расфокус и вниз. Мир едет только здесь — при смене
       * эмоции он уже стоит неподвижно.
       */
      const enterFocus = (id: string) => {
        const index = emotionIndex(id);
        const ball = index >= 0 ? balls[index] : undefined;

        if (!ball) {
          return;
        }

        tween.worldScaleTarget = WORLD_FOCUS_SCALE;
        tween.worldAlphaTarget = WORLD_FOCUS_ALPHA;
        tween.worldYTarget = pixiApp.screen.height * WORLD_FOCUS_Y_RATIO;
        tween.blurTarget = FOCUS_BLUR_STRENGTH;

        // Из матрицы уходит ТОЛЬКО центральный шар: он поднимается в ленту,
        // и пустой остаётся одна его ячейка. Соседи остаются в своих ячейках:
        // в ленте вместо них — копии, которые проявляются из тумана.
        const step = sideStep();
        const current = attachFromMatrix(ball);
        // Видимые слоты
        const prev = createCopy(neighbourBall(index, -1), -step);
        const next = createCopy(neighbourBall(index, 1), step);
        // Прелоад-слоты за границами экрана (для плавного появления при свайпе)
        const farPrev = createCopy(neighbourBall(index, -3), -3 * step);
        const midPrev = createCopy(neighbourBall(index, -2), -2 * step);
        const midNext = createCopy(neighbourBall(index, 2), 2 * step);
        const farNext = createCopy(neighbourBall(index, 3), 3 * step);

        carousel = { farPrev, midPrev, prev, current, next, midNext, farNext };
        selectedBall = ball;

        // Пока центр не доехал из своей ячейки, лента заперта: палец подождёт.
        tapeEntering = true;
        carouselMode = 'idle';
        carouselOffset = 0;
        targetCarouselOffset = 0;
        pendingPages = 0;
        carouselBusyRef.current = true;

        layoutTape(false);
      };

      /**
       * Страница доехала: роли сдвигаются на одну. Сосед, стоявший в центре,
       * становится настоящим центром (его шар выходит из матрицы), прежний
       * центр встаёт на его место копией, а на дальнем конце рождается новая
       * копия. Скачка нет: шаг ленты равен пути соседа до центра, поэтому
       * в финале страницы смещение просто обнуляется.
       */
      const commitCarouselTransition = (direction: 1 | -1) => {
        const tape = carousel;

        if (!tape) {
          return;
        }

        const arrivingSlot = direction === 1 ? tape.next : tape.prev;
        const farSlot = direction === 1 ? tape.prev : tape.next;
        const leaving = tape.current;

        // Пришедший сосед: извлекаем НАСТОЯЩИЙ шар из матрицы. Стартовые
        // значения — канон центра (2.19/1/0): к моменту коммита копия уже
        // стояла на месте центра точно в этих значениях (placeSlotAt ведёт
        // состояние по позиции), поэтому подмена «копия → оригинал» проходит
        // без единого кадра скачка. Для быстрого пролистывания на несколько
        // страниц это же значение правильное: роли переставляются мгновенно,
        // и центру не нужно «вырастать» из бокового масштаба копии.
        const arriving = createSlot(arrivingSlot.ball, 0, 0);

        const index = emotionIndex(arriving.ball.emotion.id);

        // ── Переиспользуем arrivingSlot и farSlot (вместо destroyCopy + createCopy) ──
        // Контейнеры не создаются и не уничтожаются — меняются только ссылка
        // на шар и текстура. Масштаб/прозрачность/блюр каждой копии в тот же
        // кадр проставит layoutTape через placeSlotAt: слоты живут ровно в
        // состоянии своей позиции, поэтому сразу после коммита обе боковые
        // копии УЖЕ в финале — нет никакой послемоментной пульсации размера.
        // Размер спрайта копии синхронизируем с новым шаром (страховка).

        arrivingSlot.ball = leaving.ball;
        arrivingSlot.sprite.texture = arrivingSlot.ball.frames[SPRITE_COL_IDLE];
        syncCopySize(arrivingSlot);

        // farSlot → новая копия на дальнем конце.
        farSlot.ball = neighbourBall(index, direction === 1 ? 1 : -1);
        farSlot.sprite.texture = farSlot.ball.frames[SPRITE_COL_IDLE];
        syncCopySize(farSlot);

        // ── Прелоад-слоты за экраном ──
        const refreshCopyBall = (slot: CopySlot, rel: number) => {
          slot.ball = neighbourBall(index, rel);
          slot.sprite.texture = slot.ball.frames[SPRITE_COL_IDLE];
          syncCopySize(slot);
        };
        refreshCopyBall(tape.farPrev, -3);
        refreshCopyBall(tape.midPrev, -2);
        refreshCopyBall(tape.midNext, 2);
        refreshCopyBall(tape.farNext, 3);

        // Прежний центр вернулся в матрицу.
        returnSlotToWorld(leaving);

        carousel =
          direction === 1
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

      /**
       * Ведёт ленту на страницы: pages = 0 — возврат к текущей эмоции,
       * pages > 0 — столько страниц проехать. Дальше смещение ведёт ticker.
       */
      const startSnap = (direction: 1 | -1, pages: number) => {
        snapDirection = direction;
        pendingPages = pages;
        carouselMode = 'snapping';
        carouselBusyRef.current = true;
        targetCarouselOffset = pages > 0 ? -direction * sideStep() : 0;
      };

      /**
       * Бросок через несколько страниц: роли ленты пересобираются МГНОВЕННО
       * (pages - 1 раз в этом же кадре), а последняя страница доезжает
       * snap'ом. Так быстрый свайп пролистывает 3–5 персонажей, а не одного:
       * пошаговая анимация на пять страниц тянулась бы секундами.
       */
      const flingCarousel = (direction: 1 | -1, pages: number) => {
        // Снос пальца сбрасываем: лента встаёт по канону, иначе скачок
        // читался бы как рывок вбок.
        carouselOffset = 0;
        targetCarouselOffset = 0;

        for (let page = 0; page < pages - 1; page += 1) {
          commitCarouselTransition(direction);
        }

        // Последняя страница едет плавно: бросок заканчивается посадкой.
        startSnap(direction, 1);
      };

      /**
       * Гонит ленту к нужной эмоции: тап по шарику матрицы или стрелка.
       * Страницы едут одна за другой (по кругу, коротким путём), название
       * обновляется на каждой остановке — мгновенно, в том же кадре.
       */
      const driveCarouselTo = (id: string, direction?: 1 | -1) => {
        const tape = carousel;

        if (!tape || carouselBusyRef.current) {
          return;
        }

        const from = emotionIndex(tape.current.ball.emotion.id);
        const to = emotionIndex(id);

        if (from < 0 || to < 0 || from === to) {
          return;
        }

        const dir = direction ?? directionTo(tape.current.ball.emotion.id, id);
        const length = EMOTIONS.length;
        const pages =
          dir === 1
            ? (to - from + length) % length
            : (from - to + length) % length;

        startSnap(dir, pages);
      };

      /**
       * Палец задержался на шарике — берём его в руку: вибрация, звук,
       * шарик уезжает из мира на stage, мир уходит в расфокус и вниз.
       */
      const activateHold = (ball: Ball): boolean => {
        // Лента едет: захват подождёт следующего кадра.
        if (carouselBusyRef.current) {
          return false;
        }

        // Мультитач-гвард: второй палец не должен запустить второй захват.
        if (heldIdRef.current || heldBall) {
          return false;
        }

        // Жест ленты прерываем: шарик уходит в руку, лента встаёт на место.
        carouselMode = 'idle';
        carouselOffset = 0;
        targetCarouselOffset = 0;
        pendingPages = 0;

        ball.state = SPRITE_COL_FLASH;
        ball.sprite.texture = ball.frames[SPRITE_COL_FLASH];

        if ('vibrate' in navigator) {
          navigator.vibrate(20);
        }

        playGrabSound(ball.emotion.id);

        const globalPos = ball.container.getGlobalPosition();
        ball.container.parent?.removeChild(ball.container);
        pixiApp.stage.addChild(ball.container);
        ball.container.position.set(globalPos.x, globalPos.y);

        // Шарик мог стоять в ленте соседом: в руке он снова яркий и резкий.
        ball.container.filters = [];
        ball.container.alpha = 1;
        ball.container.rotation = 0;

        // Палец ложится ниже центра персонажа: центр ведём вверх на 20%
        // радиуса — лицо остаётся видимым из-под пальца.
        ball.targetX = globalPos.x;
        ball.targetY = globalPos.y + holdOffsetY(ball);
        ball.targetScale = BALL_HOLD_SCALE;

        heldBall = ball;
        onHoldStartRef.current(ball.emotion.id);

        // Если в фокусе был другой шарик — снимаем фокус: иначе заголовок
        // эмоции и заголовок удержания наложатся друг на друга.
        if (selectedBall) {
          onBallClickRef.current(null);
        }

        // Мир уходит на задний план: он ВИДЕН (alpha 0.4) и слегка размыт,
        // поэтому эмозик в руке читается как главный на фоне матрицы.
        tween.worldScaleTarget = WORLD_FOCUS_SCALE;
        tween.worldAlphaTarget = WORLD_HOLD_ALPHA;
        tween.worldYTarget = pixiApp.screen.height * WORLD_FOCUS_Y_RATIO;
        tween.blurTarget = WORLD_HOLD_BLUR;

        return true;
      };

      /**
       * Палец отпущен — шарик плавно возвращается на своё место в матрице.
       * Координаты пересчитываем из stage в мир: мир сейчас сжат и сдвинут
       * вниз, поэтому без пересчёта шарик прыгнул бы в сторону.
       */
      const releaseHold = (id: string) => {
        const ball = heldBall;

        if (!ball || ball.emotion.id !== id) {
          return;
        }

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
          (globalPos.y - world.position.y) / worldScale + world.pivot.y,
        );
        ball.container.scale.set(ball.container.scale.x / worldScale);

        ball.returning = true;
        ball.returnTargetX = ball.baseX;
        ball.returnTargetY = ball.baseY;
        ball.returnTargetScale = 1;

        heldBall = null;
        onHoldEndRef.current();

        // Мир возвращается из расфокуса.
        tween.worldScaleTarget = 1;
        tween.worldAlphaTarget = 1;
        tween.worldYTarget = pixiApp.screen.height / 2;
        tween.blurTarget = 0;
      };

      // Сцена задаёт шарикам, что делать при отпускании захвата.
      holdReleaseRef.current = releaseHold;

      // Палец ведёт ленту или шарик: и то и другое живёт на stage, поэтому
      // отпускание ловим на всей сцене — палец может уехать с шарика.
      pixiApp.stage.on('pointermove', (event: FederatedPointerEvent) => {
        // Шарик в руке: за пальцем едет он, а лента стоит.
        if (heldBall) {
          heldBall.targetX = event.global.x;
          heldBall.targetY = event.global.y + holdOffsetY(heldBall);
          return;
        }

        if (carouselMode !== 'dragging') {
          return;
        }

        const dx = event.global.x - dragStartX;
        carouselOffset = dragStartOffset + dx;

        if (Math.abs(dx) > CAROUSEL_DRAG_TAP_PX) {
          dragMoved = true;
        }

        // Скорость пальца (px/мс): по ней snap решает, ехать ли дальше.
        const now = performance.now();
        const dt = now - lastDragTime;

        if (dt > 0) {
          dragVelocity = (event.global.x - lastDragX) / dt;
          lastDragX = event.global.x;
          lastDragTime = now;
        }
      });

      /**
       * Отпускание пришло не на шарик: гасим незакрытый пресс. Иначе
       * оставшийся pressActive с уже выдержанным временем сам откроет
       * захват в следующем кадре ticker.
       */
      const clearPressState = () => {
        for (const ball of balls) {
          ball.pressActive = false;
          ball.pressMoved = false;
        }
      };

      /**
       * Отпускание пальца: короткий тап снимает фокус и возвращает к матрице,
       * свайп — снапит ленту на 1, 3 или 5 страниц по силе броска.
       */
      const releaseDrag = (tap: boolean) => {
        if (carouselMode !== 'dragging') {
          return;
        }

        if (tap) {
          // Тап — единое правило: любое место экрана (шарик, копия соседа,
          // пустое место) снимает фокус и возвращает в матрицу. Панель под
          // шариком ловит тап сама (pointer-events: auto), поэтому фокус
          // остаётся только там.
          carouselMode = 'idle';
          carouselOffset = 0;
          targetCarouselOffset = 0;
          onBallClickRef.current(null);

          return;
        }

        // Сила броска решает, сколько страниц пролистнуть. Знак сноса важнее
        // скорости: палец мог замереть перед отпусканием.
        const step = sideStep();
        const shift = carouselOffset !== 0 ? carouselOffset : dragVelocity;
        const direction: 1 | -1 = shift < 0 ? 1 : -1;
        const velocity = Math.abs(dragVelocity);

        let pages = 0;

        if (velocity > CAROUSEL_FLING_VELOCITY_MAX) {
          pages = CAROUSEL_FLING_PAGES_MAX;
        } else if (velocity > CAROUSEL_FLING_VELOCITY_MID) {
          pages = CAROUSEL_FLING_PAGES_MID;
        } else if (velocity > CAROUSEL_FLICK_VELOCITY) {
          pages = 1;
        }

        // Медленный, но длинный снос: палец увёл ленту дальше половины шага —
        // это тоже страница. Иначе лента возвращается к текущей эмоции.
        if (
          pages === 0 &&
          Math.abs(carouselOffset) > step * CAROUSEL_SNAP_HALF_RATIO
        ) {
          pages = 1;
        }

        if (pages > 1) {
          flingCarousel(direction, pages);
          return;
        }

        startSnap(direction, pages);
      };

      // Жест ленты начинается только в фокусе, без шарика в руке и когда
      // лента уже доехала: вход в фокус и snap — не время для пальца.
      pixiApp.stage.on('pointerdown', (event: FederatedPointerEvent) => {
        if (
          !focusedIdRef.current ||
          heldIdRef.current ||
          carouselBusyRef.current ||
          carouselMode !== 'idle'
        ) {
          return;
        }

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

        releaseDrag(
          !dragMoved && performance.now() - dragStartTime < CAROUSEL_TAP_MS,
        );
      });

      pixiApp.stage.on('pointerupoutside', () => {
        if (heldBall) {
          releaseHold(heldBall.emotion.id);
        }

        clearPressState();
        // Палец ушёл за пределы окна: доводим ленту к ближайшей странице.
        releaseDrag(false);
      });

      // Браузер отменил жест (уход в фон, системный свайп «назад»):
      // без этого шарик остался бы залипшим в руке.
      pixiApp.stage.on('pointercancel', () => {
        if (heldBall) {
          releaseHold(heldBall.emotion.id);
        }

        clearPressState();
        releaseDrag(false);
      });

      // Покой: мир стоит ровно по центру экрана (position.x = ширина / 2
      // держит ticker), поэтому стартовое значение — половина высоты.
      tween.worldY = pixiApp.screen.height / 2;
      tween.worldYTarget = pixiApp.screen.height / 2;

      /**
       * Применяет фокус к живой сцене. Мир уходит в расфокус и вниз
       * только на входе в фокус и на выходе из него: при смене эмоции
       * матрица стоит неподвижно — едет только лента.
       */
      applyFocusRef.current = (id, direction) => {
        if (destroyed) {
          return;
        }

        // ── Снятие фокуса: лента возвращается в матрицу, мир — на место. ──
        if (id === null) {
          if (carousel) {
            // Центр летит в свою ячейку плавно — та же анимация, что при
            // отпускании захвата. Страховка: любой другой шар ленты (например
            // центр, который не успел уехать) встаёт на место сразу.
            for (const slot of activeSlots) {
              if (slot.kind !== 'ball' || slot === carousel.current) {
                continue;
              }

              returnSlotToWorld(slot);
            }

            // Шар в руке живёт на stage: домой его отправит отпускание.
            if (carousel.current.ball !== heldBall) {
              flySlotHome(carousel.current);
            }

            // Копии — декорации: возвращать в матрицу нечего, убираем.
            // Уничтожаем все копии, включая прелоад-слоты за экраном.
            destroyCopy(carousel.farPrev);
            destroyCopy(carousel.midPrev);
            destroyCopy(carousel.prev);
            destroyCopy(carousel.next);
            destroyCopy(carousel.midNext);
            destroyCopy(carousel.farNext);

            carousel = null;
          }

          // Жест сбрасываем: ленты больше нет — вести нечего.
          carouselMode = 'idle';
          carouselOffset = 0;
          targetCarouselOffset = 0;
          pendingPages = 0;
          tapeEntering = false;
          activeSlots = [];
          carouselBusyRef.current = false;
          selectedBall = null;

          // Шарик в руке держит мир в расфокусе, даже если фокус снят.
          if (!heldBall) {
            tween.worldScaleTarget = 1;
            tween.worldAlphaTarget = 1;
            tween.worldYTarget = pixiApp.screen.height / 2;
            tween.blurTarget = 0;
          }
          return;
        }

        // Лента уже едет: не мешаем — следующий жест начнёт новый переход.
        if (carouselBusyRef.current) {
          return;
        }

        if (carousel) {
          if (carousel.current.ball.emotion.id === id) {
            return;
          }

          // Фокус уже есть: лента едет к нужной эмоции страницами, мир стоит.
          // Без direction (тап по шарику в матрице) едем коротким путём.
          driveCarouselTo(id, direction);
          return;
        }

        enterFocus(id);
      };

      // ── Пересчёт раскладки при изменении размера окна ──
      resizeObserver = new ResizeObserver(() => {
        const width = containerEl.clientWidth;
        const height = containerEl.clientHeight;

        if (width === 0 || height === 0) {
          return;
        }

        pixiApp.renderer.resize(width, height);
        pixiApp.stage.hitArea = pixiApp.screen;

        layoutBalls(pixiApp, balls, world);
        // Размер изменился — pivot и позиция мира пересчитываются заново.
        centerWorld(pixiApp, world);
        // Лента живёт в своей четверти экрана: слой тоже переезжает.
        layoutCarouselLayer();

        if (carousel) {
          // Матрица пересчитана: копии соседей должны совпасть с шарами.
          syncCopySize(carousel.prev);
          syncCopySize(carousel.next);

          // Жест и незавершённый snap отпускаем: точки ленты изменились,
          // поэтому лента встаёт по канону нового размера.
          carouselMode = 'idle';
          carouselOffset = 0;
          targetCarouselOffset = 0;
          pendingPages = 0;
          tapeEntering = false;
          carouselBusyRef.current = false;
          layoutTape(true);
          // Размер, блюр и прозрачность доведёт ticker: это доли секунды.
        }

        // Если фокус активен — пересчитываем цель мира под новый размер.
        if (selectedBall) {
          tween.worldYTarget = pixiApp.screen.height * WORLD_FOCUS_Y_RATIO;
        } else {
          // Покой: мир должен стоять ровно по центру, интерполировать нечего.
          tween.worldY = pixiApp.screen.height / 2;
          tween.worldYTarget = pixiApp.screen.height / 2;
        }
      });

      resizeObserver.observe(containerEl);

      // ── Покадровая интерполяция: расфокус мира и полёт шарика ──
      let fpsWindowStart = performance.now();
      let fpsFrames = 0;
      let degraded = false;

      pixiApp.ticker.add(() => {
        const now = performance.now();

        // Захват: палец задержался дольше порога и не сдвинулся.
        for (const ball of balls) {
          if (
            ball.pressActive &&
            !ball.holdActivated &&
            !ball.pressMoved &&
            now - ball.pressStartTime > HOLD_THRESHOLD
          ) {
            // Гвард внутри активации: не взяли захват — не помечаем шарик.
            ball.holdActivated = activateHold(ball);
          }
        }

        // ── Лента: палец ведёт смещение, отпускание доводит страницу ──
        if (carouselMode === 'snapping') {
          const diff = targetCarouselOffset - carouselOffset;
          carouselOffset += diff * CAROUSEL_SNAP_LERP;

          if (Math.abs(diff) < CAROUSEL_SNAP_EPSILON) {
            if (targetCarouselOffset !== 0) {
              // Страница доехала: сосед встал ровно в центр, поэтому смещение
              // обнуляем ДО смены ролей — лента не дёрнется.
              carouselOffset = 0;
              targetCarouselOffset = 0;
              commitCarouselTransition(snapDirection);
              pendingPages -= 1;
            } else {
              carouselOffset = 0;
            }

            if (pendingPages > 0) {
              // Ещё не все страницы: едем дальше, с нуля.
              targetCarouselOffset = -snapDirection * sideStep();
            } else {
              // Лента встала. Название уже обновлено: его ставит
              // commitCarouselTransition в том же кадре, что и смена центра.
              carouselMode = 'idle';
              carouselBusyRef.current = false;
            }
          }
        }

        if (carousel) {
          // Жест: место ставим напрямую — лента не отстаёт от пальца.
          // Вход в фокус: только цели — центр поднимается из своей ячейки.
          layoutTape(!tapeEntering);
        }

        // Шарик в руке: тянется за пальцем и растёт.
        if (heldBall) {
          heldBall.container.x +=
            (heldBall.targetX - heldBall.container.x) * HOLD_FOLLOW_LERP;
          heldBall.container.y +=
            (heldBall.targetY - heldBall.container.y) * HOLD_FOLLOW_LERP;

          const heldScale = heldBall.container.scale.x;
          heldBall.container.scale.set(
            heldScale + (heldBall.targetScale - heldScale) * HOLD_SCALE_LERP,
          );
        }

        // Отпущенный шарик плавно возвращается в матрицу.
        for (const ball of balls) {
          if (!ball.returning) {
            continue;
          }

          ball.container.x +=
            (ball.returnTargetX - ball.container.x) * HOLD_RETURN_LERP;
          ball.container.y +=
            (ball.returnTargetY - ball.container.y) * HOLD_RETURN_LERP;

          const returnScale = ball.container.scale.x;
          ball.container.scale.set(
            returnScale +
              (ball.returnTargetScale - returnScale) * HOLD_RETURN_LERP,
          );

          if (
            Math.abs(ball.container.x - ball.returnTargetX) < 1 &&
            Math.abs(ball.container.y - ball.returnTargetY) < 1
          ) {
            ball.container.position.set(ball.returnTargetX, ball.returnTargetY);
            ball.container.scale.set(ball.returnTargetScale);
            ball.returning = false;
            ball.nextChangeAt =
              now + rand(ball.params.intervalMin, ball.params.intervalMax);
          }
        }

        // Живое состояние покоя: шарики по очереди шевелятся, иногда
        // вспыхивают. Позиции при этом не меняются — только фрейм.
        for (const ball of balls) {
          // Шар, который держит палец, живёт по своим законам: activateHold
          // ставит ему кадр 2, и он не шевелится. Летящий домой шар тоже
          // стоит на кадре покоя, а счётчик переключений запустит посадка.
          //
          // Центральный шар ленты ЖИВЁТ вместе с матрицей: пока его не взяли
          // в руку, он моргает и иногда вспыхивает по MOTION_PARAMS — поэтому
          // персонаж в фокусе «дышит», а не замирает на кадре 0.
          if (ball.holdActivated || ball.returning) {
            continue;
          }

          const p = ball.params;

          if (ball.state === SPRITE_COL_FLASH && now >= ball.state2Until) {
            ball.state = SPRITE_COL_IDLE;
            ball.sprite.texture = ball.frames[SPRITE_COL_IDLE];
            ball.nextChangeAt = now + rand(p.intervalMin, p.intervalMax);
          } else if (
            ball.state !== SPRITE_COL_FLASH &&
            now >= ball.nextChangeAt
          ) {
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

        // Мир: масштаб, прозрачность, сдвиг вниз и сила расфокуса.
        tween.worldScale = approach(tween.worldScale, tween.worldScaleTarget);
        tween.worldAlpha = approach(tween.worldAlpha, tween.worldAlphaTarget);
        tween.worldY = approach(tween.worldY, tween.worldYTarget);
        tween.blur = approach(tween.blur, tween.blurTarget);

        world.scale.set(tween.worldScale);
        world.alpha = tween.worldAlpha;
        // X всегда центр экрана: мир сжимается симметрично, влево не уезжает.
        world.position.set(pixiApp.screen.width / 2, tween.worldY);
        worldBlur.strength = tween.blur;

        // Лента фокуса: каждый слот едет к своей точке, растёт и тает.
        for (const slot of activeSlots) {
          // Шар в руке уехал на stage — его ведёт удержание.
          if (
            slot.kind === 'ball' &&
            slot.ball.container.parent !== carouselLayer
          ) {
            continue;
          }

          // Размер, прозрачность и блюр сходятся к целям плавно: соседи
          // проявляются из тумана, а не появляются подменой кадра.
          slot.alpha = approach(slot.alpha, slot.alphaTarget);
          slot.x = approach(slot.x, slot.xTarget);
          slot.y = approach(slot.y, slot.yTarget);
          slot.scale = approach(slot.scale, slot.scaleTarget);
          slot.blurStrength = approach(slot.blurStrength, slot.blurTarget);

          drawSlot(slot);
        }

        // Центр доехал из своей ячейки: лента свободна — можно вести её
        // пальцем (до этого жест заперт, иначе лента дёрнулась бы).
        if (tapeEntering && activeSlots.every(slotArrived)) {
          tapeEntering = false;
          carouselBusyRef.current = false;
        }

        // Блюр — самая дорогая часть кадра: если FPS просел,
        // снижаем качество, чтобы сохранить плавность.
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

      // Сцена готова: только теперь показываем онбординг (шаг 1).
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

      if (app) {
        app.destroy(true, { children: true });
        app = null;
      }
    };
  }, []);

  // React-состояние → Pixi: фокус применяется к уже живой сцене.
  useEffect(() => {
    applyFocusRef.current(focusedId);
  }, [focusedId]);

  /**
   * Возврат на главный экран: заметка меняется на новую. Срабатывает и при
   * первом рендере (focusedId уже null), поэтому текст не «застывает».
   */
  useEffect(() => {
    if (focusedId === null) {
      setDailyNote(DAILY_NOTES[Math.floor(Math.random() * DAILY_NOTES.length)]);
    }
  }, [focusedId]);

  const focusedEmotion = focusedId
    ? (EMOTIONS.find((emotion) => emotion.id === focusedId) ?? null)
    : null;

  const heldEmotion = heldId
    ? (EMOTIONS.find((emotion) => emotion.id === heldId) ?? null)
    : null;

  /**
   * Цвет главной иконки в bottom-nav: пока смотрим или держим эмозика —
   * его цвет, иначе null (тогда показываем разноцветный main-active).
   */
  const navMainColor = (heldEmotion ?? focusedEmotion)?.color;

  return (
    <div className="emotion-space">
      <div ref={containerRef} id="pixi-container" />

      {/* Ежедневная заметка вверху главного экрана. Видна только без фокуса
          и без захвата: в этих состояниях её место занимает заголовок. */}
      {focusedId === null && heldId === null && (
        <div className="daily-note">{dailyNote}</div>
      )}

      {/* ── Онбординг: три независимых шага, у каждого свой флаг ── */}

      {/* Шаг 1: знакомство с эмозиками — один раз при первом заходе. */}
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

      {/* Шаг 2: плашка про удержание — только в фокусе (focusedId). */}
      {showFocusTip && focusedId && (
        <div className="onboarding-tip onboarding-tip--focus">
          Зажми шарик, проговори ситуацию и отпусти. Можешь ничего не
          говорить — это необязательно.
        </div>
      )}

      {/* Шаг 3: карточка про запись — при первом долгом захвате.
          Палец держит шарик, поэтому карточка не ловит события. */}
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

      {/* Шапка фокуса: имя эмоции и аннотация под ним (REFERENCE §2, §8).
          В фокусе подпись — краткое ОПИСАНИЕ эмоции (emotion.annotation),
          а при захвате — подсказка «проговори и …» (focusAnnotation). */}
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

      {/* Окно с текстом об эмоции и плашка ввода под ним (REFERENCE §2, §8). */}
      {focusedId && (
        <div className="emotion-panel">
          <div className="emotion-panel__card">
            {/* Текст об эмоции: абзацы из EMOTION_TEXTS по id эмоции. */}
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

          {/* Точная формулировка из референса, ничего не меняем. */}
          <div className="input-hint">
            Напишите что нибудь, задай свой вопрос или запиши мне короткий
            войс — зажми этот экран пальцем. Еще ты можешь взять эмоцию
            (зажми пальцем), если ощущаешь ее сейчас, проговорить ее и
            отпустить…
          </div>
        </div>
      )}

      {/* Панель записи при захвате: только волна, без текста. Стоит выше
          нижних иконок, поэтому навигацию не перекрывает. */}
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

      {/* Нижняя навигация: четыре раздела. Мы всегда на главном экране,
          поэтому main активен: без фокуса — разноцветный main-active,
          в фокусе/захвате — main-colored в цвете эмозика (currentColor).
          Иконки — точные SVG из docs/design/icons (без Lucide). */}
      <nav className="bottom-nav">
        <button
          type="button"
          className="nav-icon"
          data-icon="main"
          aria-label="Матрица эмоций"
          onClick={() => {
            const held = heldIdRef.current;

            // Захват: отпускаем шарик — он возвращается в свою ячейку, мир
            // встаёт на место (releaseHold внутри сбрасывает и React-состояние).
            if (held) {
              holdReleaseRef.current(held);
            }

            // Фокус: убираем ленту, шарик улетает домой в матрицу.
            // applyFocus(null) идемпотентен: если ленты нет — он ничего не делает.
            if (focusedIdRef.current) {
              applyFocusRef.current(null);
            }

            // Обнуляем React-состояния: главный экран показывается сразу,
            // не дожидаясь конца анимации возврата.
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

        <button
          type="button"
          className="nav-icon"
          data-icon="dialog"
          aria-label="Разговоры"
        >
          <DialogIcon />
        </button>

        <button
          type="button"
          className="nav-icon"
          data-icon="explore"
          aria-label="Исследовать"
        >
          <ExploreIcon />
        </button>

        <button
          type="button"
          className="nav-icon"
          data-icon="user"
          aria-label="Профиль"
        >
          <UserIcon />
        </button>
      </nav>
    </div>
  );
}

