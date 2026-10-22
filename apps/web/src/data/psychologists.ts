/**
 * Психологи, доступные для общения в приложении.
 * image — путь к портрету в public, например '/psychologists/vera.jpeg'.
 */
export interface Psychologist {
  id: string;
  name: string;
  /** Цвет психолога из палитры приложения (используется в чате как --emotion-color). */
  color: string;
  /** Путь к картинке-портрету, например '/psychologists/vera.jpeg'. */
  image: string;
}

export const PSYCHOLOGISTS: Psychologist[] = [
  {
    id: 'vera',
    name: 'Вера',
    color: '#ECA17C', // персиковый (gratitude)
    image: '/psychologists/vera.jpeg',
  },
  {
    id: 'lina',
    name: 'Лина',
    color: '#B77DD8', // лавандовый (serenity)
    image: '/psychologists/lina.jpeg',
  },
  {
    id: 'maxim',
    name: 'Максим',
    color: '#0085D7', // синий (inspiration)
    image: '/psychologists/maxim.jpeg',
  },
];