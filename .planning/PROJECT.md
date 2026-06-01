# release-helper

## What This Is

CLI-инструмент на TypeScript/Node, который проверяет готовность задач к релизу. По релизной задаче из YouTrack он собирает связанные задачи, ищет относящиеся к ним pull request'ы во внешних репозиториях, проверяет апрувы, статус CI и возможность мержа, выявляет пропущенные связанные задачи и формирует Markdown-отчёт — он сохраняется локально (`.spec/review/release-<ID>.md`) и публикуется комментарием в YouTrack. Инструментом пользуется команда при подготовке релизов.

## Core Value

Релиз-менеджер видит полную и достоверную картину готовности релиза: для каждой задачи найдены все её PR'ы с их статусом (апрувы, CI, мерж), а пропущенные зависимости подсвечены. Если поиск PR неполный — ценность инструмента теряется.

## Requirements

### Validated

<!-- Выведено из существующего кода (brownfield). Эти возможности уже работают. -->

- ✓ Парсинг ID релизной задачи из URL или прямого ввода — existing
- ✓ Получение релизной задачи и связанных задач из YouTrack (REST, Bearer-токен) — existing
- ✓ Извлечение дополнительных ID задач из описания релиза — existing
- ✓ Анализ пропущенных связанных задач (subtasks, depends, related, duplicates) — existing
- ✓ Поиск PR по задачам в GitHub (через `gh` CLI) — existing
- ✓ Проверка апрувов, статуса CI и возможности мержа («Can merge») для PR — existing
- ✓ Рекурсивное разрешение связанных PR из описаний (глубина 1) — existing
- ✓ Генерация Markdown-отчёта со сводкой, таблицей PR, деталями задач, предупреждениями и рекомендациями по деплою — existing
- ✓ Публикация/обновление отчёта комментарием в YouTrack — existing

### Active

<!-- Объём текущего витка: миграция Bitbucket → GitHub. -->

- [ ] Все 21 репозиторий из `BITBUCKET_REPOS` перенесены в `GITHUB_REPOS` под `omi-enjoy` с теми же именами (итого 24 GitHub-репозитория)
- [ ] `REPO_SHORT_NAMES` обновлён под GitHub-пути перенесённых репозиториев
- [ ] Поиск PR идёт только по GitHub — обращения к Bitbucket убраны из активного пайплайна
- [ ] Код Bitbucket (`src/bitbucket/client.ts`, BB-константы в `config.ts`) помечен `@deprecated`, но не удалён
- [ ] Проверка `BITBUCKET_EMAIL`/`BITBUCKET_TOKEN` при старте убрана — креды Bitbucket больше не требуются
- [ ] README.md приведён в соответствие: убран Bitbucket из требований/архитектуры/окружения, обновлены списки репозиториев и переменных

### Out of Scope

- Полное удаление кода Bitbucket — пока оставляем как `@deprecated` на случай отката
- Перенос репозиториев под другую организацию или с переименованием — все идут в `omi-enjoy` с теми же именами
- Рефакторинг дублирования (`detectSpecialFiles`, `extractLinkedPRUrls`) и других пунктов из CONCERNS.md — отдельная работа, не входит в эту миграцию
- Добавление тестового набора — вне объёма этого витка

## Context

- **Brownfield.** Инструмент уже существует и работает; карта кодовой базы — в `.planning/codebase/`.
- Все библиотеки команды переехали с Bitbucket (`omi-russia`, ~21 репо) на GitHub (`omi-enjoy`) с сохранением имён. Поэтому слой Bitbucket в инструменте больше не нужен.
- Архитектура: единый однопроходный CLI-пайплайн, три слоя API-клиентов (YouTrack REST, GitHub через `gh` CLI, Bitbucket REST) за общим интерфейсом `PullRequest`. После миграции активным останется только GitHub-клиент.
- Вся конфигурация (списки репозиториев, URL, паттерны) централизована в `src/config.ts`.
- Bitbucket-клиент сейчас вызывается из `src/analyzer/pr-finder.ts` (параллельный поиск, concurrency=5) и инициализируется в `src/index.ts`.

## Constraints

- **Tech stack**: TypeScript 5.9 / Node ≥18, CommonJS, без рантайм-зависимостей — придерживаемся существующего стиля.
- **Testing**: тестового набора нет; валидация — прогон инструмента на реальной релизной задаче YouTrack (`node dist/index.js <ID>`).
- **Совместимость**: код Bitbucket удалять нельзя — только `@deprecated`, чтобы оставить возможность отката.
- **Сборка**: `npm run build` (`tsc` → `dist/`); запуск из `dist/`.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Перенесённые репозитории идут в `omi-enjoy` с теми же именами | Так фактически выполнена миграция библиотек на GitHub | — Pending |
| Bitbucket-код помечаем `@deprecated`, не удаляем | Сохранить возможность отката, пока миграция не устоялась | — Pending |
| Креды `BITBUCKET_EMAIL`/`BITBUCKET_TOKEN` больше не требуются при старте | После отключения BB-вызовов требовать их бессмысленно | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-01 after initialization*
