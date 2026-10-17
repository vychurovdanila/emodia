# Эмоза

Приложение для эмоциональной гигиены. Пользователь видит 18 цветных шариков (эмоций)
в матрице 3×6. При нажатии на шарик он увеличивается, остальные уходят в блюр:
сверху появляется название эмоции, снизу — текст психолога об этой эмоции.
Пользователь может задать вопрос текстом или голосом, ответ психолога приходит в чате.

## Стек

| Часть | Технологии |
| --- | --- |
| `apps/web` | React, Vite, TypeScript, Tailwind CSS, PixiJS, PWA (vite-plugin-pwa) |
| `apps/server` | Node.js, Express, TypeScript, SQLite (better-sqlite3) |
| `packages/shared` | общие типы и данные 18 эмоций |
| LLM | Groq API |

## Структура

```
emoza/
├── apps/
│   ├── web/          # фронтенд (PWA)
│   └── server/       # API-сервер
├── packages/
│   └── shared/       # общий код: типы и эмоции
├── .gitignore
├── package.json      # npm workspaces
└── README.md
```

Общий код подключается как workspace-пакет `@emoza/shared`.

## Требования

- Node.js 20+
- npm 10+

## Установка

```bash
npm install
```

Команда выполняется из корня репозитория и ставит зависимости всех workspace-пакетов.

## Запуск

```bash
npm run dev:web     # фронтенд: http://localhost:5173
npm run dev:server  # API: http://localhost:3000
```

## Сборка

```bash
npm run build
```

## Проверка API

```bash
curl http://localhost:3000/api/health
# {"status":"ok"}
```

Порт API задаётся переменной окружения `PORT` (по умолчанию 3000).
Файл `.env` не попадает в git — в нём будут храниться ключи (например, `GROQ_API_KEY`).
