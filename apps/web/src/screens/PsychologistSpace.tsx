import { useLayoutEffect, useRef, useState } from 'react';
import { ChatWidget } from '../components/ChatWidget';
import type { NavState } from '../components/BottomNav';
import { PSYCHOLOGISTS } from '../data/psychologists';
import type { Emotion } from '@emodia/shared';

interface PsychologistSpaceProps {
  /** id психолога из PSYCHOLOGISTS, который открыт по умолчанию. */
  initialPsychologistId?: string;
  /** Возврат к матрице эмоций (кнопка «назад»). */
  onGoBack?: () => void;
  /** Отчёт о состоянии иконок нижней навигации (цвет текущего психолога). */
  onNavStateChange?: (state: NavState) => void;
}

/** Переписка между «пользователем» и роботом-психологом. */
type ChatMessage = { role: 'user' | 'emotion'; text: string };

/** Минимальная горизонтальная дистанция свайпа по портрету (пиксели). */
const SWIPE_THRESHOLD = 50;

export function PsychologistSpace({ initialPsychologistId, onGoBack, onNavStateChange }: PsychologistSpaceProps) {
  // Чей портрет/чат показан сейчас; по умолчанию — психолог из пропса.
  const [activeId, setActiveId] = useState(initialPsychologistId || PSYCHOLOGISTS[0].id);
  // Независимые истории: сообщения каждого психолога хранятся под его id.
  const [histories, setHistories] = useState<Record<string, ChatMessage[]>>({});
  const [isTyping, setIsTyping] = useState(false);

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

  return (
    <div className="psychologist-space">
      {/* Верхняя часть (30vh): портрет; свайп влево/вправо переключает психолога */}
      <div
        className="psychologist-portrait-area"
        style={{ touchAction: 'pan-y' }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <button
          type="button"
          className="psychologist-back-btn"
          aria-label="Назад к эмоциям"
          onClick={onGoBack}
        >
          ←
        </button>
        <img src={psychologist.image} alt={psychologist.name} className="psychologist-avatar" />
      </div>

      {/* Нижняя часть (70vh): чат с историей именно текущего психолога */}
      <div className="psychologist-chat-area">
        <ChatWidget
          emotion={emotion}
          messages={histories[activeId] || []}
          onSendMessage={handleSendMessage}
          isTyping={isTyping}
        />
      </div>
    </div>
  );
}