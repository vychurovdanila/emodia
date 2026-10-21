import { useState, useEffect, useRef, useCallback } from 'react';

export interface ChatMessage {
  role: 'user' | 'psychologist';
  text: string;
}

export function useEmotionChat(emotionId: string) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  
  const timeoutRef = useRef<number | null>(null);

  // Таймер бездействия (1 час)
  const resetTimer = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      setIsExpanded(false);
      setMessages([]); // Возвращаемся к тексту эмоции
    }, 3600000); // 1 час
  }, []);

  // Сброс при смене эмоции
  useEffect(() => {
    setIsExpanded(false);
    setMessages([]);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [emotionId]);

  const handleUserMessage = (text: string) => {
    if (!text.trim()) return;
    
    setMessages((prev) => [...prev, { role: 'user', text }]);
    resetTimer();

    // Имитация ответа психолога (ИИ подключим на следующем шаге)
    setTimeout(() => {
      setMessages((prev) => [
        ...prev, 
        { role: 'psychologist', text: 'Я слышу тебя. Это важно. Расскажи, что именно тебя беспокоит в этой ситуации?' }
      ]);
    }, 1200);
  };

  return {
    isExpanded,
    setIsExpanded,
    messages,
    isRecording,
    setIsRecording,
    handleUserMessage,
    resetTimer,
  };
}