import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ChatWidget } from '../components/ChatWidget';
import type { NavState } from '../components/BottomNav';
import { PSYCHOLOGISTS } from '../data/psychologists';
import type { Emotion } from '@emodia/shared';

interface PsychologistSpaceProps {
  /** id психолога из PSYCHOLOGISTS, который открыт по умолчанию. */
  initialPsychologistId?: string;
  /** Отчёт о состоянии иконок нижней навигации (цвет текущего психолога). */
  onNavStateChange?: (state: NavState) => void;
}

/** Переписка между «пользователем» и роботом-психологом. */
type ChatMessage = { role: 'user' | 'emotion'; text: string };

/** Минимальная горизонтальная дистанция свайпа по портрету (пиксели). */
const SWIPE_THRESHOLD = 40;

/** Матрица выбора психолога: 3 колонки × 4 строки (12 портретов). */
const MATRIX_COLS = 3;
const MATRIX_ROWS = 4;

/** Место психолога в матрице — по его порядку в PSYCHOLOGISTS. */
function matrixPosition(index: number): { row: number; col: number } {
  return { row: Math.floor(index / MATRIX_COLS) + 1, col: (index % MATRIX_COLS) + 1 };
}

/** Скорость «перелёта» портрета: тот же экспоненциальный лерп, что у твинов эмоций. */
const FLIGHT_LERP = 0.25;
/** Порог остановки перелёта (пиксели). */
const FLIGHT_EPSILON = 0.5;

/** Перелёт портрета: в свою ячейку матрицы (open) или обратно на место (close). */
interface Flight {
  phase: 'open' | 'close';
  psychologistId: string;
  image: string;
  from: DOMRect;
  /** Куда летим; для open вычисляется после отрисовки матрицы. */
  to: DOMRect | null;
}

export function PsychologistSpace({ initialPsychologistId, onNavStateChange }: PsychologistSpaceProps) {
  // Чей портрет/чат показан сейчас; по умолчанию — психолог из пропса.
  const [activeId, setActiveId] = useState(initialPsychologistId || PSYCHOLOGISTS[0].id);
  // Независимые истории: сообщения каждого психолога хранятся под его id.
  const [histories, setHistories] = useState<Record<string, ChatMessage[]>>({});
  const [isTyping, setIsTyping] = useState(false);
  // Открыта матрица выбора психолога (тап по портрету): чат скрыт, показана сетка.
  const [isMatrixOpen, setIsMatrixOpen] = useState(false);
  // Идущий перелёт портрета (в ячейку матрицы или обратно).
  const [flight, setFlight] = useState<Flight | null>(null);

  /** Слой с «летящим» портретом и контейнер матрицы — нужны для замеров и анимации. */
  const flightRef = useRef<HTMLDivElement | null>(null);
  const matrixRef = useRef<HTMLDivElement | null>(null);
  const portraitAreaRef = useRef<HTMLDivElement | null>(null);
  /** Куда возвращаться: место большого портрета на экране психолога. */
  const portraitRect = useRef<DOMRect | null>(null);
  /** Высота вьюпорта при открытии матрицы: если изменилась (уехала клавиатура), место портрета другое. */
  const portraitViewport = useRef<number | null>(null);

  // Точка начала касания — чтобы понять направление свайпа по портрету.
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const psychologistIndexRaw = PSYCHOLOGISTS.findIndex(p => p.id === activeId);
  const psychologistIndex = psychologistIndexRaw === -1 ? 0 : psychologistIndexRaw;
  const psychologist = PSYCHOLOGISTS[psychologistIndex];

  // Сообщаем App цвет текущего психолога для иконки «Разговоры» в нижней навигации.
  useLayoutEffect(() => {
    onNavStateChange?.({
      mainColor: undefined,
      dialogColor: psychologist.color,
      showStory: false,
    });
  }, [onNavStateChange, psychologist]);

  /** Переключение активного психолога по кругу: +1 — следующий, -1 — предыдущий. */
  const switchPsychologist = (offset: number) => {
    const nextIndex = (psychologistIndex + offset + PSYCHOLOGISTS.length) % PSYCHOLOGISTS.length;
    setActiveId(PSYCHOLOGISTS[nextIndex].id);
  };

  /**
   * Тап по портрету: он «летит» в свою ячейку матрицы (как шар эмоции в фокус),
   * чат уступает место сетке.
   */
  const handlePortraitTap = () => {
    if (flight) return;
    const avatar = portraitAreaRef.current?.querySelector<HTMLImageElement>('.psychologist-avatar');
    if (!avatar) return;

    const from = avatar.getBoundingClientRect();
    portraitRect.current = from;
    portraitViewport.current = window.visualViewport?.height ?? window.innerHeight;
    setFlight({ phase: 'open', psychologistId: psychologist.id, image: psychologist.image, from, to: null });
    setIsMatrixOpen(true);
  };

  /** Выбор из матрицы: портрет летит обратно на место, затем матрица исчезает и возвращается чат. */
  const handleSelectPsychologist = (id: string) => {
    if (flight) return;

    const cellAvatar = matrixRef.current?.querySelector<HTMLImageElement>(
      `[data-psychologist-id="${id}"] .psychologist-matrix__avatar`,
    );
    const to = portraitRect.current;
    const selected = PSYCHOLOGISTS.find(item => item.id === id);
    // Клавиатура закрылась вместе с чатом → большой портрет уже на другом месте: без анимации.
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const layoutMoved =
      portraitViewport.current !== null && Math.abs(viewportHeight - portraitViewport.current) > 1;

    // Без замеров (нечего анимировать) — переключаемся сразу.
    if (!cellAvatar || !to || !selected || layoutMoved) {
      setActiveId(id);
      setIsMatrixOpen(false);
      return;
    }

    setFlight({
      phase: 'close',
      psychologistId: id,
      image: selected.image,
      from: cellAvatar.getBoundingClientRect(),
      to,
    });
  };

  /**
   * Перелёт портрета: экспоненциальный лерп 0.15 за кадр — та же скорость,
   * что у твинов эмоций (TWEEN_LERP в EmotionSpace).
   */
  useLayoutEffect(() => {
    if (!flight) return;

    const layer = flightRef.current;
    if (!layer) return;

    const to =
      flight.to ??
      matrixRef.current
        ?.querySelector<HTMLImageElement>(
          `[data-psychologist-id="${flight.psychologistId}"] .psychologist-matrix__avatar`,
        )
        ?.getBoundingClientRect();

    const finish = () => {
      if (flight.phase === 'close') {
        // Матрица закрывается только после «приземления» портрета.
        setActiveId(flight.psychologistId);
        setIsMatrixOpen(false);
      }
      setFlight(null);
    };

    if (!to) {
      finish();
      return;
    }

    let x = flight.from.left;
    let y = flight.from.top;
    let w = flight.from.width;
    let h = flight.from.height;
    let raf = 0;

    const step = () => {
      x += (to.left - x) * FLIGHT_LERP;
      y += (to.top - y) * FLIGHT_LERP;
      w += (to.width - w) * FLIGHT_LERP;
      h += (to.height - h) * FLIGHT_LERP;

      layer.style.left = `${x}px`;
      layer.style.top = `${y}px`;
      layer.style.width = `${w}px`;
      layer.style.height = `${h}px`;

      const arrived =
        Math.abs(to.left - x) < FLIGHT_EPSILON &&
        Math.abs(to.top - y) < FLIGHT_EPSILON &&
        Math.abs(to.width - w) < FLIGHT_EPSILON &&
        Math.abs(to.height - h) < FLIGHT_EPSILON;

      if (arrived) {
        finish();
        return;
      }

      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [flight]);

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStart.current.x;
    const dy = touch.clientY - touchStart.current.y;
    touchStart.current = null;

    // Засчитываем только явно горизонтальный свайп достаточной длины.
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;

    if (dx < 0) {
      switchPsychologist(1); // свайп влево — следующий психолог
    } else {
      switchPsychologist(-1); // свайп вправо — предыдущий психолог
    }
  };

  /** Отправка сообщения в историю конкретного (текущего) психолога + имитация ответа. */
  const handleSendMessage = (text: string) => {
    const psychologistId = activeId;

    setHistories(prev => ({
      ...prev,
      [psychologistId]: [...(prev[psychologistId] || []), { role: 'user', text }],
    }));
    setIsTyping(true);

    // Имитация ответа психолога (как в EmotionSpace)
    setTimeout(() => {
      setHistories(prev => ({
        ...prev,
        [psychologistId]: [
          ...(prev[psychologistId] || []),
          { role: 'emotion', text: 'Понимаю тебя. Расскажи подробнее, что случилось?' },
        ],
      }));
      setIsTyping(false);
    }, 1500);
  };

  // ChatWidget принимает сущность Emotion — собираем её из данных текущего психолога,
  // чтобы «цвет» и «имя» собеседника подхватились чатом автоматически.
  const emotion: Emotion = {
    id: psychologist.id,
    name: psychologist.name,
    annotation: psychologist.name,
    kind: 'neutral',
    color: psychologist.color,
    motion: 'calm',
    release: 'dissolve',
    gridPosition: { row: 1, col: 1 },
  };

  // Пока портрет летит, его «двойник» в ячейке скрыт: виден только летящий слой.
  const flyingId = flight?.psychologistId ?? null;

  return (
    <div
      className="psychologist-space"
      style={
        isMatrixOpen
          ? undefined
          : ({ '--bg-tint': psychologist.color } as CSSProperties)
      }
    >
      {isMatrixOpen ? (
        /* Матрица выбора психолога: 3 × 4, у каждого своё место; чат скрыт */
        <div
          ref={matrixRef}
          className={`psychologist-matrix${flight?.phase === 'close' ? ' psychologist-matrix--leaving' : ''}`}
          role="listbox"
          aria-label={`Выбор психолога: ${MATRIX_COLS}×${MATRIX_ROWS}`}
        >
          {PSYCHOLOGISTS.map((item, index) => {
            const position = matrixPosition(index);
            const isActive = item.id === activeId;
            const isFlying = flyingId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`psychologist-matrix__cell${isActive ? ' psychologist-matrix__cell--active' : ''}${
                  isFlying ? ' psychologist-matrix__cell--flying' : ''
                }`}
                style={
                  {
                    gridColumn: position.col,
                    gridRow: position.row,
                    '--psychologist-color': item.color,
                  } as CSSProperties
                }
                data-psychologist-id={item.id}
                aria-label={`${item.name} — ${item.annotation}`}
                aria-selected={isActive}
                onClick={() => handleSelectPsychologist(item.id)}
              >
                <img className="psychologist-matrix__avatar" src={item.image} alt="" />
              </button>
            );
          })}
        </div>
      ) : (
        <>
          {/* Верхняя часть: портрет; свайп переключает психолога, тап открывает матрицу */}
          <div
            ref={portraitAreaRef}
            className="psychologist-portrait-area"
            style={{ touchAction: 'pan-y' }}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onClick={handlePortraitTap}
          >
            <img src={psychologist.image} alt={psychologist.name} className="psychologist-avatar" />
          </div>

          {/* Нижняя часть: чат с историей именно текущего психолога */}
          <div className="psychologist-chat-area">
            <ChatWidget
              emotion={emotion}
              messages={histories[activeId] || []}
              onSendMessage={handleSendMessage}
              isTyping={isTyping}
              greeting={psychologist.greeting}
            />
          </div>
        </>
      )}

      {/* Летящий портрет: тот же кадр (cover + маска), что у ячейки и у большого портрета */}
      {flight && (
        <div
          ref={flightRef}
          className="psychologist-flight"
          style={{
            left: flight.from.left,
            top: flight.from.top,
            width: flight.from.width,
            height: flight.from.height,
          }}
        >
          <img className="psychologist-flight__img" src={flight.image} alt="" />
        </div>
      )}
    </div>
  );
}