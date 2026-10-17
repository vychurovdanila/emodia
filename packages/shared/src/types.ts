/** Эмоциональная группа: позитивная, нейтральная или негативная. */
export type EmotionKind = 'positive' | 'neutral' | 'negative';

/**
 * Тип движения шарика в покое.
 * calm — плавное «дыхание», tense — нервная дрожь, heavy — тяжёлое покачивание.
 */
export type EmotionMotion = 'calm' | 'tense' | 'heavy';

/** Сценарий «отпускания» эмоции. */
export type EmotionRelease = 'rise' | 'dissolve' | 'fall';

/** Позиция шарика в матрице 3x6. Нумерация с единицы. */
export interface GridPosition {
  row: number;
  col: number;
}

/** Описание одной эмоции (один шарик на экране). */
export interface Emotion {
  id: string;
  name: string;
  /** Краткое описание эмоции для аннотации в фокусе (3–6 слов). */
  annotation: string;
  kind: EmotionKind;
  color: string;
  motion: EmotionMotion;
  release: EmotionRelease;
  gridPosition: GridPosition;
}
