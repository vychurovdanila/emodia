/**
 * Психологи, доступные для общения в приложении.
 * image — путь к портрету в public, например '/psychologists/vera.png'.
 */
export interface Psychologist {
  id: string;
  name: string;
  /** Цвет психолога из палитры приложения (используется в чате как --emotion-color). */
  color: string;
  /** Путь к картинке-портрету. */
  image: string;
  /** Краткий титул или роль (например, "Хранительница тепла"). */
  annotation: string;
  /** Подробное описание, чем может помочь. */
  description: string;
}

export const PSYCHOLOGISTS: Psychologist[] = [
  {
    id: 'vera',
    name: 'Вера',
    color: '#ECA17C',
    image: '/psychologists/vera.png',
    annotation: 'Хранительница тепла',
    description: 'Материнская поддержка, работа с горем, потерями и самооценкой.',
  },
  {
    id: 'lina',
    name: 'Лина',
    color: '#327440',
    image: '/psychologists/lina.png',
    annotation: 'Хранительница границ',
    description: 'Прямота и бережность. Работа с гневом, выгоранием и токсичными отношениями.',
  },
  {
    id: 'nina',
    name: 'Нина',
    color: '#f2a427',
    image: '/psychologists/nina.png',
    annotation: 'Хранительница очага',
    description: 'Тепло с юмором. Темы родительства, семьи и баланса работы и жизни.',
  },
  {
    id: 'liya',
    name: 'Лия',
    color: '#f8617a',
    image: '/psychologists/liya.png',
    annotation: 'Хранительница тела',
    description: 'Мягкость и чувственность. Принятие телесности, близости и женственности.',
  },
  {
    id: 'aya',
    name: 'Ая',
    color: '#40BBD5',
    image: '/psychologists/aya.png',
    annotation: 'Цифровой друг',
    description: 'Современный подход. Тревога, FOMO, перфекционизм и жизнь в соцсетях.',
  },
  {
    id: 'yuna',
    name: 'Юна',
    color: '#95b96f',
    image: '/psychologists/yuna.png',
    annotation: 'Хранительница практик',
    description: 'Медитативный подход. Работа с паническими атаками и заземлением.',
  },
  {
    id: 'mark',
    name: 'Марк',
    color: '#8d7d54',
    image: '/psychologists/mark.png',
    annotation: 'Философ-практик',
    description: 'Поиск смысла, кризисы середины жизни и экзистенциальные вопросы.',
  },
  {
    id: 'maxim',
    name: 'Максим',
    color: '#0085D7',
    image: '/psychologists/maxim.png',
    annotation: 'Коуч-стратег',
    description: 'Структура и цели. Карьера, мотивация и преодоление прокрастинации.',
  },
  {
    id: 'daniil',
    name: 'Даниил',
    color: '#595E5F',
    image: '/psychologists/daniil.png',
    annotation: 'Про близость',
    description: 'Честный разговор. Отношения, интимность, ревность и страхи.',
  },
  {
    id: 'artem',
    name: 'Артём',
    color: '#ed2229',
    image: '/psychologists/artem.png',
    annotation: 'Про силу',
    description: 'Спокойная уверенность. Мужская уязвимость, гнев, отцовство и границы.',
  },
  {
    id: 'kirill',
    name: 'Кирилл',
    color: '#A8BD27',
    image: '/psychologists/kirill.png',
    annotation: 'Свой парень',
    description: 'Неформальное общение. Одиночество и тревога у молодых людей.',
  },
  {
    id: 'ilya',
    name: 'Илья',
    color: '#809F9F',
    image: '/psychologists/ilya.png',
    annotation: 'Старший друг',
    description: 'Надежная опора без морализаторства. Потери, кризисы, переходные периоды.',
  },
];