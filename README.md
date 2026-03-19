# Release Helper

Утилита для проверки готовности задач к релизу — анализирует PR, апрувы, связанные задачи и зависимости.

## Возможности

- 🔍 Анализ всех задач в релизе YouTrack
- 🔗 Обнаружение **missing linked tasks** (subtasks, dependencies, related)
- 📋 Поиск PR в **GitHub** и **Bitbucket** (22+ репозитория)
- ✅ Проверка approvals, commits, CI/CD статусов
- 🔧 Детекция изменений в `composer.json` и `parameters.yml`
- 📊 Генерация подробного отчёта в Markdown с рекомендациями

## Требования

- **Node.js 18+** (для native `fetch()`)
- **gh CLI** — для работы с GitHub API ([установка](https://cli.github.com/))
- **YouTrack API token**
- **Bitbucket API credentials**
- **GitHub token** (опционально, для rate limits)

## Установка

```bash
# Клонировать репозиторий
git clone https://github.com/ivanov39/release-helper.git
cd release-helper

# Установить зависимости
npm install

# Собрать проект
npm run build
```

## Настройка

### 1. Создать файл `.env` в корне проекта

```bash
cp .env.example .env
```

### 2. Получить и добавить API токены

#### YouTrack Token

1. Перейти в YouTrack: https://issues.enjoydev.io/users/me?tab=authentication
2. Нажать **New token...**
3. Выбрать **Scope**: `YouTrack` (read access)
4. Скопировать токен и добавить в `.env`:
   ```
   YOUTRACK_TOKEN=perm-xxxxxx...
   ```

#### Bitbucket Credentials

1. Перейти в Bitbucket: https://bitbucket.org/account/settings/app-passwords/
2. Нажать **Create app password**
3. Выбрать права: **Repositories** → Read, **Pull requests** → Read
4. Скопировать токен и добавить в `.env`:
   ```
   BITBUCKET_EMAIL=your-email@example.com
   BITBUCKET_TOKEN=ATBBxxxxxxxx...
   ```

#### GitHub Token (опционально)

**Автоматически (через gh CLI):**
```bash
gh auth login
```

**Вручную:**
1. Перейти: https://github.com/settings/tokens/new
2. Выбрать права: `repo` (Full control of private repositories)
3. Скопировать токен и добавить в `.env`:
   ```
   GITHUB_TOKEN=ghp_xxxxxx...
   ```

### 3. Пример `.env` файла

```env
# YouTrack API Token
# Получить: https://issues.enjoydev.io/users/me?tab=authentication
YOUTRACK_TOKEN=perm-your-token-here

# GitHub Token (опционально, для rate limits)
# Получить: gh auth token ИЛИ https://github.com/settings/tokens/new
GITHUB_TOKEN=ghp_your-token-here

# Bitbucket API Credentials
# Получить: https://bitbucket.org/account/settings/app-passwords/
BITBUCKET_EMAIL=your-email@example.com
BITBUCKET_TOKEN=ATBB-your-token-here
```

## Использование

```bash
# Запуск по ID задачи
node dist/index.js ESN-2274

# Запуск по URL
node dist/index.js https://issues.enjoydev.io/issue/ESN-2274

# Сокращённый ID
node dist/index.js ES-3310
```

### Флаги

| Флаг | Описание |
|------|----------|
| `--short` | Скрывает раздел **Task Details** — удобно для быстрого обзора статуса PR |
| `--overview` | Показывает только заголовок отчёта и таблицу **PR Overview** — минимальный вид |

```bash
# Полный отчёт (по умолчанию)
node dist/index.js ESN-2274

# Без раздела Task Details
node dist/index.js ESN-2274 --short

# Только заголовок + таблица PR
node dist/index.js ESN-2274 --overview

# Флаги работают с URL
node dist/index.js https://issues.enjoydev.io/issue/ESN-2274 --short
```

### Результат

Отчёт сохраняется в `.spec/review/release-{ISSUE_ID}.md`

Пример вывода:
```
🔍 Release Helper - Checking ESN-2274

📋 Step 1/6: Fetching release issue...
   Release: Release 3.126.0
🔗 Step 2/6: Searching linked tasks...
   Found 11 tasks in release
🔍 Step 3/6: Analyzing task dependencies...
   Found 3 missing linked tasks
🔎 Step 4/6: Searching PRs...
   Found 14 primary + 4 linked PRs
📊 Step 5/6: Analyzing PRs...
📝 Step 6/6: Generating report...

✅ Report saved to .spec/review/release-ESN-2274.md
   Total tasks: 11
   Missing linked: 3
   Warnings: 22
```

**Время работы:** ~3 минуты (зависит от количества задач и репозиториев)

## Структура отчёта

Сгенерированный отчёт включает:

1. **Summary** — статистика готовности задач
2. **PR Overview** — таблица всех PR с ключевыми метриками
3. **Task Details** — детальная информация по каждой задаче
4. **Missing Linked Tasks Details** — задачи-зависимости, не включённые в релиз
5. **Warnings** — проблемы (missing approvals, open PRs, failed CI)
6. **Recommendations** — рекомендации по включению задач и порядку деплоя

## Что проверяется

### Pull Requests
- ✅ **State**: MERGED / OPEN / CLOSED
- ✅ **Approvals**: наличие и количество апрувов
- ✅ **Commits**: количество коммитов (желательно 1)
- ✅ **CI/CD Checks**: статусы проверок (SUCCESS / FAILURE / PENDING)

### Специальные файлы
- ⚠️ **Composer**: изменения в `composer.json` / `composer.lock` → требуется `composer update` после деплоя
- ⚠️ **Parameters**: изменения в `parameters*.yml.dist` → требуется обновление конфига перед деплоем

### Связанные задачи
- 🔗 **Subtasks**: подзадачи (`subtask of` / `parent for`)
- 🔗 **Dependencies**: зависимости (`depends on` / `is required for`)
- 🔗 **Related**: связанные задачи (`relates to`)
- 🔗 **Duplicates**: дубликаты (`duplicates` / `is duplicated by`)

## Репозитории

### GitHub
- `omi-enjoy/es-next`
- `omi-enjoy/es-application`

### Bitbucket (omi-russia)
- `es-pass`, `es-admin-api-client`, `es-pass-api-client`
- `es-migrations`, `es-auth`, `es-autotester`, `es-autotester-api-client`
- `epd-api-client`, `epc-api-client`, `ef-api-client`, `em-api-client`
- `ed-*` — shared libraries (api-bundle, api-client, codeception-modules, codestyle, doctrine-extension, fixtures, frontend-api-bundle, mq-event, query-dsl, rbac-bundle, validation-bundle)

## Разработка

```bash
# Разработка с пересборкой
npm run dev

# Только сборка
npm run build

# Запуск собранной утилиты
npm start ESN-2274
```

## Структура проекта

```
src/
  index.ts                  - CLI entry point, оркестрация
  config.ts                 - конфигурация репозиториев и API
  types.ts                  - TypeScript интерфейсы
  youtrack/client.ts        - YouTrack REST API клиент
  github/client.ts          - GitHub API через gh CLI
  bitbucket/client.ts       - Bitbucket REST API клиент
  analyzer/
    linked-tasks.ts         - анализатор зависимостей задач
    pr-finder.ts            - поиск PR (с параллелизацией)
  report/generator.ts       - генератор Markdown отчёта
```

## Troubleshooting

### `gh` команда не найдена
```bash
# macOS
brew install gh

# Ubuntu/Debian
sudo apt install gh

# Другие ОС: https://cli.github.com/
```

### YOUTRACK_TOKEN не найден
Убедитесь, что `.env` файл содержит токен и находится в корне проекта.

### Bitbucket API ошибки
Проверьте:
- Email и токен в `.env` корректны
- Токен имеет права `Repositories: Read` и `Pull requests: Read`
- Токен не истёк

### GitHub rate limit
Добавьте `GITHUB_TOKEN` в `.env` для увеличения лимита запросов.

## Лицензия

ISC

## Контакты

При возникновении вопросов или проблем создавайте [issue](https://github.com/ivanov39/release-helper/issues).
