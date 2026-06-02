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

- ✓ 21 репозиторий с Bitbucket перенесён в `GITHUB_REPOS` под `omi-enjoy` с теми же именами (итого 24 GitHub-репо) — v1.0
- ✓ `REPO_SHORT_NAMES` перекеплён под полные GitHub-пути перенесённых репозиториев — v1.0
- ✓ Поиск PR идёт только по GitHub — Bitbucket убран из активного пайплайна — v1.0
- ✓ Код Bitbucket (`src/bitbucket/client.ts`, BB-константы в `config.ts`) помечен `@deprecated`, не удалён — v1.0
- ✓ Проверка `BITBUCKET_EMAIL`/`BITBUCKET_TOKEN` при старте убрана — креды Bitbucket больше не требуются — v1.0
- ✓ README.md и `.env.example` приведены к GitHub-only (требования/архитектура/окружение/списки репо) — v1.0

### Active

<!-- Следующий виток ещё не определён — задаётся через /gsd:new-milestone. -->

- [ ] (следующий milestone — кандидат: CLEAN-01, полное удаление `@deprecated` Bitbucket-кода после того как GitHub-only миграция устоялась)

### Out of Scope

- Полное удаление кода Bitbucket — пока оставляем как `@deprecated` на случай отката
- Перенос репозиториев под другую организацию или с переименованием — все идут в `omi-enjoy` с теми же именами
- Рефакторинг дублирования (`detectSpecialFiles`, `extractLinkedPRUrls`) и других пунктов из CONCERNS.md — отдельная работа, не входит в эту миграцию
- Добавление тестового набора — вне объёма этого витка

## Context

- **Brownfield.** Инструмент уже существует и работает; карта кодовой базы — в `.planning/codebase/`.
- **Shipped v1.0 (2026-06-02):** инструмент теперь GitHub-only. Все 24 репозитория (`omi-enjoy/<name>`: 3 оригинальных + 21 перенесённый) ищутся через GitHub; Bitbucket убран из активного пайплайна; BB-креды при старте не требуются.
- Архитектура: единый однопроходный CLI-пайплайн. Активен только GitHub-клиент (через `gh` CLI) + YouTrack REST. Bitbucket-клиент (`src/bitbucket/client.ts`, BB-константы, `loadBitbucketCredentials`) сохранён `@deprecated` как путь отката — компилируется, но не подключён к пайплайну. Полное удаление отложено в v2 (CLEAN-01).
- Вся конфигурация (списки репозиториев, URL, паттерны) централизована в `src/config.ts`.
- Tech stack без изменений: TypeScript 5.9 / Node ≥18, CommonJS, без рантайм-зависимостей. Тестового набора нет — валидация прогоном на реальной задаче YouTrack.
- **Известный tech debt (из код-ревью фазы 01, несрочно):** устаревший текст легенды Markdown-отчёта (WR-01), двойные `gh pr view` из-за расхождения ключей `prCache` (WR-02), мёртвый BB-код в `extractLinkedPRUrls`/`platformTag` (WR-03, IN-03 — закроется вместе с CLEAN-01).

## Constraints

- **Tech stack**: TypeScript 5.9 / Node ≥18, CommonJS, без рантайм-зависимостей — придерживаемся существующего стиля.
- **Testing**: тестового набора нет; валидация — прогон инструмента на реальной релизной задаче YouTrack (`node dist/index.js <ID>`).
- **Совместимость**: код Bitbucket удалять нельзя — только `@deprecated`, чтобы оставить возможность отката.
- **Сборка**: `npm run build` (`tsc` → `dist/`); запуск из `dist/`.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Перенесённые репозитории идут в `omi-enjoy` с теми же именами (24 в `GITHUB_REPOS`) | Так фактически выполнена миграция библиотек на GitHub | ✓ Good — v1.0, live-прогон нашёл PR из перенесённых репо |
| Bitbucket-код помечаем `@deprecated`, не удаляем | Сохранить возможность отката, пока миграция не устоялась | ✓ Good — v1.0; полное удаление → v2 (CLEAN-01) |
| Креды `BITBUCKET_EMAIL`/`BITBUCKET_TOKEN` больше не требуются при старте | После отключения BB-вызовов требовать их бессмысленно | ✓ Good — v1.0, старт без BB-кредов подтверждён |
| 1 фаза на всю миграцию (granularity=coarse) | 9 требований — единая атомарная миграция без внутренних зависимостей доставки | ✓ Good — v1.0, фаза верифицирована 5/5 |

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
*Last updated: 2026-06-02 after v1.0 «Bitbucket → GitHub» milestone*
