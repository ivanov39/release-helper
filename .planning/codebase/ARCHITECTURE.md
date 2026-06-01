<!-- refreshed: 2026-06-01 -->
# Architecture

**Analysis Date:** 2026-06-01

## System Overview

```text
┌─────────────────────────────────────────────────────────────────┐
│                    CLI Entry Point                               │
│                    `src/index.ts`                                │
│        Parses args, orchestrates 7-step pipeline                 │
└──────┬─────────────────┬─────────────┬───────────────────┬──────┘
       │                 │             │                   │
       ▼                 ▼             ▼                   ▼
┌────────────┐  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  YouTrack  │  │   Analyzer   │ │   Analyzer   │ │   Report     │
│  Client    │  │ linked-tasks │ │  pr-finder   │ │  generator   │
│`youtrack/  │  │`analyzer/    │ │`analyzer/    │ │`report/      │
│ client.ts` │  │linked-tasks` │ │ pr-finder.ts`│ │generator.ts` │
└──────┬─────┘  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │               │                │                  │
       │               └────────────────┘                  │
       │         Depends on YouTrack Client                 │
       ▼                                                    ▼
┌──────────────────────────────────┐         ┌─────────────────────┐
│        API Clients               │         │  YouTrack Comment   │
│  `github/client.ts` (gh CLI)     │         │  Publisher          │
│  `bitbucket/client.ts` (fetch)   │         │ `youtrack/comment-  │
└──────────────────────────────────┘         │  publisher.ts`      │
                                             └─────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│  Output                                                          │
│  - `.spec/review/release-<ID>.md`  (local file)                 │
│  - YouTrack comment (upserted via REST API)                      │
└─────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Entry point / orchestrator | Parses CLI args, runs 7-step pipeline, builds `ReleaseReport` | `src/index.ts` |
| Configuration | Repo lists, URL constants, patterns, credential loading, ID parsing | `src/config.ts` |
| Type definitions | All shared interfaces and type aliases | `src/types.ts` |
| YouTrack client | Fetch issue details, search linked issues, post/update comments | `src/youtrack/client.ts` |
| YouTrack comment publisher | Upsert formatted report as YouTrack comment | `src/youtrack/comment-publisher.ts` |
| GitHub client | Wrap `gh` CLI for PR search, details, merge status, review threads | `src/github/client.ts` |
| Bitbucket client | REST API with Basic auth for PR search, details, commits, files, builds | `src/bitbucket/client.ts` |
| Linked-task analyzer | Detect release tasks whose linked issues (subtasks, deps, etc.) are absent | `src/analyzer/linked-tasks.ts` |
| PR finder | Search GitHub + Bitbucket for PRs per task, resolve linked PRs from descriptions | `src/analyzer/pr-finder.ts` |
| Report generator | Build Markdown report string from `ReleaseReport` | `src/report/generator.ts` |

## Pattern Overview

**Overall:** Single-pass CLI pipeline (no server, no persistent state)

**Key Characteristics:**
- Sequential orchestration in `src/index.ts`; no event loop, no HTTP server
- Three distinct API layers (YouTrack REST, GitHub via `gh` CLI, Bitbucket REST) behind a common `PullRequest` interface
- All configuration (repo lists, URL bases, special-file patterns) centralized in `src/config.ts`
- Results accumulate in-memory, then emitted to stdout (Markdown) and `.spec/review/` file at end
- Progress/debug logging goes to `process.stderr`; the final report goes to `process.stdout` (via file write + YouTrack comment)

## Layers

**Configuration Layer:**
- Purpose: Single source of truth for all constants and credential loading
- Location: `src/config.ts`
- Contains: Repo lists, URL constants, regex patterns, `parseIssueId()`, `loadBitbucketCredentials()`, `getYouTrackToken()`
- Depends on: `process.env` only
- Used by: All other modules

**Type Layer:**
- Purpose: Shared interfaces used across the codebase
- Location: `src/types.ts`
- Contains: `ReleaseIssue`, `TaskIssue`, `PullRequest`, `LinkedTask`, `TaskReport`, `ReleaseReport`, `Warning`, `ReportOptions`, and related enums
- Depends on: Nothing
- Used by: All other modules

**API Client Layer:**
- Purpose: Communicate with external services; return normalized domain types
- Location: `src/youtrack/client.ts`, `src/github/client.ts`, `src/bitbucket/client.ts`
- Contains: HTTP/CLI wrappers, retry logic, response normalization
- Depends on: `src/types.ts`, `src/config.ts`
- Used by: `src/index.ts`, `src/analyzer/linked-tasks.ts`, `src/analyzer/pr-finder.ts`, `src/youtrack/comment-publisher.ts`

**Analyzer Layer:**
- Purpose: Domain logic — determine which linked tasks are missing and find PRs for all tasks
- Location: `src/analyzer/linked-tasks.ts`, `src/analyzer/pr-finder.ts`
- Contains: Dependency-gap detection, parallel PR search with concurrency limiting, PR deduplication, linked-PR extraction from descriptions
- Depends on: API client layer, `src/types.ts`, `src/config.ts`
- Used by: `src/index.ts`

**Report Layer:**
- Purpose: Render `ReleaseReport` as a Markdown string
- Location: `src/report/generator.ts`, `src/youtrack/comment-publisher.ts`
- Contains: All formatting helpers, deploy-order inference, warning grouping
- Depends on: `src/types.ts`, `src/config.ts`
- Used by: `src/index.ts`

## Data Flow

### Primary Pipeline (7 steps)

1. **Parse CLI args** — extract issue ID from URL or raw ID (`src/index.ts:48-77`, uses `parseIssueId()` from `src/config.ts`)
2. **Fetch release issue** — `YouTrackClient.getReleaseIssue(issueId)` → `ReleaseIssue` (`src/youtrack/client.ts:143`)
3. **Collect tasks** — `YouTrackClient.searchIssues("links: <id>")` + parse description for additional task IDs → `TaskIssue[]` (`src/index.ts:113-148`)
4. **Analyze dependencies** — `analyzeLinkedTasks(youtrack, filteredTasks)` → `LinkedTask[]` (`src/analyzer/linked-tasks.ts:26`)
5. **Find PRs** — `findPRsForTasks(github, bitbucket, allTaskIds)` → `Map<taskId, {primary, linked, searchErrors}>` (`src/analyzer/pr-finder.ts:93`)
6. **Build reports + warnings** — iterate tasks, assemble `TaskReport[]` and `Warning[]` in `src/index.ts:165-287`
7. **Generate + publish** — `generateReport(reportData, options)` → Markdown string saved to `.spec/review/release-<ID>.md`; `publishReportComment()` upserts YouTrack comment

### PR Resolution Sub-flow (inside Step 5)

1. Search GitHub repos sequentially via `gh pr list --search <taskId>` (`src/github/client.ts:226`)
2. Search Bitbucket repos in parallel (concurrency=5) via REST API (`src/analyzer/pr-finder.ts:131-134`)
3. Fetch full PR details for each match (cached in `prCache` Map to avoid duplicate fetches)
4. Parse PR descriptions for linked PR URLs; fetch those PRs at depth=1 (`src/analyzer/pr-finder.ts:171-202`)
5. Filter out CLOSED/DECLINED PRs when a MERGED PR exists for the same repo (`src/analyzer/pr-finder.ts:206-218`)

**State Management:**
- No persistent state; all data accumulated in local variables within `main()` in `src/index.ts`
- PR details deduplicated via `prCache: Map<string, PullRequest>` local to `findPRsForTasks()` (`src/analyzer/pr-finder.ts:102`)

## Key Abstractions

**`PullRequest` (unified PR interface):**
- Purpose: Single type representing a PR from either GitHub or Bitbucket
- Location: `src/types.ts:83`
- Pattern: Both `GitHubClient.getPRDetails()` and `BitbucketClient.getPRDetails()` return `PullRequest`; consumers never branch on platform for rendering

**`ReleaseReport` (aggregate report DTO):**
- Purpose: All data collected during the pipeline, passed to the generator
- Location: `src/types.ts:123`
- Fields: `release`, `taskReports`, `missingLinkedTasks`, `missingLinkedTaskReports`, `warnings`, `checkedAt`

**`TaskReport`:**
- Purpose: One task's complete picture — task metadata + primary PRs + linked PRs + search errors
- Location: `src/types.ts:110`

**`Warning`:**
- Purpose: Structured warning with `type` discriminant (`missing_linked` | `pr_issue` | `composer` | `params` | `search_failed`) and `taskId`
- Location: `src/types.ts:117`

## Entry Points

**CLI entry:**
- Location: `src/index.ts`
- Triggers: `node dist/index.js <issue-id-or-url> [--short] [--overview] [--no-comment]`
- Responsibilities: `.env` loading, arg parsing, client initialization, pipeline orchestration, file output

## Architectural Constraints

- **Threading:** Node.js single-threaded event loop. Bitbucket parallelism achieved via `Promise.all` with a hand-rolled concurrency limiter (`runWithConcurrency` in `src/analyzer/pr-finder.ts:51`). GitHub calls are synchronous via `execFileSync` (blocks the event loop)
- **Global state:** None — no module-level singletons or shared mutable state. `YouTrackClient` stores its token in an instance field; clients are instantiated once in `main()`
- **Circular imports:** None detected
- **Output channels:** All progress/warnings go to `process.stderr`; the report Markdown is written to a file. Final stdout is used by `console.log` in `comment-publisher.ts` for UX feedback only
- **No test suite:** Validation is done by running against a real YouTrack issue (per CLAUDE.md)

## Anti-Patterns

### `detectSpecialFiles` duplicated in two clients

**What happens:** Identical function defined in both `src/github/client.ts:91` and `src/bitbucket/client.ts:59`
**Why it's wrong:** Changes to special-file detection patterns must be made in two places; they can drift
**Do this instead:** Extract to a shared module (e.g., `src/utils/files.ts`) and import in both clients

### `extractLinkedPRUrls` duplicated in two clients

**What happens:** Identical regex-based function defined in both `src/github/client.ts:116` and `src/bitbucket/client.ts:84`
**Why it's wrong:** Same duplication issue as above
**Do this instead:** Extract to `src/utils/urls.ts`

### Synchronous `execFileSync` in GitHub client blocks event loop

**What happens:** `runGH()` in `src/github/client.ts:44` uses `execFileSync` with `sleepSync` (Atomics.wait)
**Why it's wrong:** Blocks the Node.js event loop for every GitHub API call; no concurrent GitHub+Bitbucket overlap possible
**Do this instead:** Use `execFile` with a Promise wrapper for async execution

## Error Handling

**Strategy:** Fail-fast for critical setup (missing credentials, invalid issue ID); soft-fail with warnings for individual PR/task fetch errors

**Patterns:**
- Critical errors: `console.error` + `process.exit(1)` (credentials, issue not found)
- Non-critical errors: Catch locally, emit `process.stderr.write(Warning)`, continue pipeline; surface as `SearchError` in the report
- API clients retry up to 3 times on transient network errors (timeout, `AbortError`, `fetch failed`) with delay between attempts

## Cross-Cutting Concerns

**Logging:** `process.stderr.write()` directly (no logging library). Progress lines use emoji prefixes for human readability
**Validation:** Input validation at `src/index.ts` entry; no runtime schema validation of API responses (TypeScript types cast with `as`)
**Authentication:** YouTrack uses Bearer token (`YOUTRACK_TOKEN` env var); Bitbucket uses Basic auth base64-encoded in constructor; GitHub delegates to the `gh` CLI's credential store

---

*Architecture analysis: 2026-06-01*
