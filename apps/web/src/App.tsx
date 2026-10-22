import { useCallback, useRef, useState } from 'react';
import { BottomNav, type NavState } from './components/BottomNav';
import { EmotionSpace } from './screens/EmotionSpace';
import { PsychologistSpace } from './screens/PsychologistSpace';

type Screen = 'emotions' | 'psychologists';

export function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('emotions');
  const [navState, setNavState] = useState<NavState>({ showStory: false });

  // EmotionSpace регистрирует здесь свой «сброс фокуса» для кнопки главной.
  const emotionResetRef = useRef<() => void>(() => {});
  // И обработчик «открыть чат эмоции» для кнопки «Разговоры».
  const toggleEmotionChatRef = useRef<() => void>(() => {});

  const handleNavStateChange = useCallback((state: NavState) => {
    setNavState(state);
  }, []);

  const handleRegisterMainReset = useCallback((handler: () => void) => {
    emotionResetRef.current = handler;
  }, []);

  const handleRegisterToggleEmotionChat = useCallback((handler: () => void) => {
    toggleEmotionChatRef.current = handler;
  }, []);

  const handleMainClick = useCallback(() => {
    if (currentScreen === 'psychologists') {
      setCurrentScreen('emotions');
      return;
    }
    // На экране эмоций «главная» сбрасывает фокус/захват/чат.
    emotionResetRef.current();
  }, [currentScreen]);

  const handleDialogClick = useCallback(() => {
    // На экране психологов раздел «Разговоры» уже открыт — ничего не делаем.
    if (currentScreen !== 'emotions') return;
    if (navState.dialogColor) {
      // Фокус эмоции активен → переключаем: история эмоции ⇄ её чат (иконка «истории» возвращает в историю).
      toggleEmotionChatRef.current();
    } else {
      // Без фокуса → переход к чату с психологом.
      setCurrentScreen('psychologists');
    }
  }, [currentScreen, navState.dialogColor]);

  return (
    <>
      {currentScreen === 'emotions' ? (
        <EmotionSpace
          onNavStateChange={handleNavStateChange}
          onRegisterMainReset={handleRegisterMainReset}
          onRegisterToggleEmotionChat={handleRegisterToggleEmotionChat}
        />
      ) : (
        <PsychologistSpace
          onGoBack={() => setCurrentScreen('emotions')}
          onNavStateChange={handleNavStateChange}
        />
      )}

      {/* Нижняя навигация одна на всё приложение — закреплена и не перемонтируется */}
      <BottomNav
        activeTab={currentScreen === 'emotions' ? 'emotions' : 'dialog'}
        mainColor={navState.mainColor}
        dialogColor={navState.dialogColor}
        showStory={navState.showStory}
        onMainClick={handleMainClick}
        onDialogClick={handleDialogClick}
      />
    </>
  );
}