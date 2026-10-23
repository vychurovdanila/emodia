import { useCallback, useEffect, useRef, useState } from 'react';
import { BottomNav, type NavState } from './components/BottomNav';
import { EmotionSpace } from './screens/EmotionSpace';
import { PsychologistSpace } from './screens/PsychologistSpace';

type Screen = 'emotions' | 'psychologists';

export function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('emotions');
  const [navState, setNavState] = useState<NavState>({ showStory: false });

  // Экранная клавиатура. Благодаря interactive-widget=resizes-content она уменьшает
  // innerHeight, поэтому открытие вычисляем по «просадке» высоты вьюпорта.
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  // EmotionSpace регистрирует здесь свой «сброс фокуса» для кнопки главной.
  const emotionResetRef = useRef<() => void>(() => {});
  // И обработчик «открыть чат эмоции» для кнопки «Разговоры».
  const toggleEmotionChatRef = useRef<() => void>(() => {});

  useEffect(() => {
    /** Насколько должна «просесть» высота, чтобы считать, что клавиатура открыта. */
    const KEYBOARD_THRESHOLD = 120;
    /** Компактная (мобильная) ширина: на десктопе клавиатуры нет, ресайз окна не считаем. */
    const COMPACT_WIDTH = 900;

    // Видимая высота: на iOS клавиатура уменьшает visualViewport, в Chrome — innerHeight.
    const visibleHeight = () => Math.min(window.innerHeight, window.visualViewport?.height ?? window.innerHeight);

    let baseline = visibleHeight();
    let baselineWidth = window.innerWidth;

    const update = () => {
      const height = visibleHeight();
      // Поворот экрана/смена ширины — пересчитываем опорную высоту, а не считаем клавиатурой.
      if (Math.abs(window.innerWidth - baselineWidth) > 80) {
        baselineWidth = window.innerWidth;
        baseline = height;
      } else if (height > baseline) {
        baseline = height;
      }
      const compact = window.innerWidth <= COMPACT_WIDTH;
      setKeyboardOpen(compact && baseline - height > KEYBOARD_THRESHOLD);
    };

    update();
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);

  // Пока клавиатура открыта — CSS прячет нижнюю навигацию и прижимает поле ввода к ней.
  useEffect(() => {
    document.documentElement.classList.toggle('keyboard-open', keyboardOpen);
  }, [keyboardOpen]);

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
        <PsychologistSpace onNavStateChange={handleNavStateChange} />
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