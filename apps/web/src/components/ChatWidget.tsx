import { useState, useRef, useEffect } from 'react';
import type { Emotion } from '@emodia/shared';

interface ChatWidgetProps {
  emotion: Emotion;
  messages: { role: 'user' | 'emotion'; text: string }[];
  onSendMessage: (text: string) => void;
  isTyping: boolean;
  /** Приветствие в пустом чате. По умолчанию — текст от эмоции. */
  greeting?: React.ReactNode;
}

/** Приветствие по умолчанию — чат с эмоцией. */
const DEFAULT_GREETING = (
  <>
    Привет, я твоя эмоция!<br /><br />
    Напиши мне что нибудь текстом или запиши голосовое (зажми свое окно текста пальцем). Еще ты можешь взять меня, если ощущаешь прямо сейчас, проговорить и отпустить...
  </>
);

export function ChatWidget({ emotion, messages, onSendMessage, isTyping, greeting }: ChatWidgetProps) {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Автоскролл вниз при новых сообщениях.
  // На пустой истории не скроллим: длинное приветствие должно читаться с начала.
  useEffect(() => {
    if (messages.length === 0 && !isTyping) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSend = () => {
    if (!inputText.trim()) return;
    onSendMessage(inputText);
    setInputText('');
  };

  const hasText = inputText.trim().length > 0;

    return (
    <div 
      className="chat-container" 
      style={{ '--emotion-color': emotion.color } as React.CSSProperties}
    >
      {/* Список сообщений */}
      <div className="chat-messages">
        {/* Приветственное сообщение, если истории еще нет */}
        {messages.length === 0 && (
          <div className="chat-bubble chat-bubble--emotion">
            {greeting ?? DEFAULT_GREETING}
          </div>
        )}
        
        {messages.map((msg, idx) => (
          <div key={idx} className={`chat-bubble chat-bubble--${msg.role}`}>
            {msg.text}
          </div>
        ))}

        {/* Индикатор "Думает..." */}
        {isTyping && (
          <div className="chat-typing">
            {emotion.name} думает...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Поле ввода */}
      <div className="chat-input-wrapper">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Сообщение"
          className="chat-input"
        />
                <button 
          className="chat-send-btn" 
          onClick={handleSend} 
          disabled={!hasText}
        >
          <img 
            src="/fly.svg" 
            alt="Отправить" 
            style={{ 
              width: 24, 
              height: 24,
              opacity: hasText ? 1 : 0.3,
              filter: hasText ? `drop-shadow(0px 1000px 0 ${emotion.color})` : 'grayscale(1)',
              transform: hasText ? 'translateY(-1000px)' : 'none'
            }} 
          />
        </button>
      </div>
    </div>
  );
}