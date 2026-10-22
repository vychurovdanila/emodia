import {
  DialogActiveIcon,
  DialogIcon,
  ExploreIcon,
  MainActiveIcon,
  MainColoredIcon,
  MainIcon,
  UserIcon,
} from './NavIcons';

/** Состояние иконок нижней навигации, которое присылает текущий экран. */
export interface NavState {
  /** Цвет колец главной иконки (эмоция в фокусе/захвате на экране эмоций). */
  mainColor?: string;
  /** Цвет иконки «Разговоры» (эмоция в фокусе либо текущий психолог). */
  dialogColor?: string;
  /** На экране эмоций открыт чат эмоции — показываем иконку «истории». */
  showStory: boolean;
}

interface BottomNavProps extends Partial<NavState> {
  /** Активная вкладка. */
  activeTab: 'emotions' | 'dialog' | 'explore' | 'user';
  onMainClick?: () => void;
  onDialogClick?: () => void;
}

/**
 * Нижняя навигация приложения. Рендерится один раз на уровне App
 * (position: fixed), поэтому не перемонтируется и не анимируется
 * при переключении экранов.
 */
export function BottomNav({
  activeTab,
  mainColor,
  dialogColor,
  showStory,
  onMainClick,
  onDialogClick,
}: BottomNavProps) {
  return (
    <nav className="bottom-nav" data-active-tab={activeTab}>
      <button
        type="button"
        className="nav-icon"
        data-icon="main"
        aria-label="Матрица эмоций"
        onClick={onMainClick}
      >
        {activeTab === 'dialog' ? (
          // На экране психолога — пассивная серая иконка
          <MainIcon />
        ) : mainColor ? (
          <MainColoredIcon style={{ color: mainColor }} />
        ) : (
          <MainActiveIcon />
        )}
      </button>

      <button
        type="button"
        className="nav-icon"
        data-icon="dialog"
        aria-label="Разговоры"
        onClick={onDialogClick}
      >
        {activeTab === 'dialog' ? (
          // На экране психолога — активная иконка «Разговоры» в цвете психолога
          <DialogActiveIcon style={{ width: 26, height: 26, color: dialogColor }} />
        ) : showStory ? (
          // В режиме чата эмоции — иконка «истории»
          <img
            src="/story.svg"
            alt="История"
            style={{
              width: 26,
              height: 26,
              opacity: 0.6,
              filter: `drop-shadow(0px 1000px 0 ${dialogColor ?? '#1a1a1a'})`,
              transform: 'translateY(-1000px)',
            }}
          />
        ) : (
          <DialogIcon
            style={{ width: 26, height: 26, color: dialogColor, opacity: dialogColor ? 0.6 : undefined }}
          />
        )}
      </button>

      <button type="button" className="nav-icon" data-icon="explore" aria-label="Исследовать">
        <ExploreIcon />
      </button>

      <button type="button" className="nav-icon" data-icon="user" aria-label="Профиль">
        <UserIcon />
      </button>
    </nav>
  );
}