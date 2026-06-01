# Codebase Structure

**Analysis Date:** 2026-06-01

## Directory Layout

```
release-helper/
├── src/                        # TypeScript source (compiled to dist/)
│   ├── index.ts                # CLI entry point — 7-step pipeline orchestrator
│   ├── config.ts               # All constants, repo lists, patterns, helper fns
│   ├── types.ts                # Shared interfaces and type aliases
│   ├── youtrack/
│   │   ├── client.ts           # YouTrack REST API client
│   │   └── comment-publisher.ts # Upsert report as YouTrack comment
│   ├── github/
│   │   └── client.ts           # GitHub client wrapping gh CLI
│   ├── bitbucket/
│   │   └── client.ts           # Bitbucket REST API client
│   ├── analyzer/
│   │   ├── linked-tasks.ts     # Find linked tasks missing from release
│   │   └── pr-finder.ts        # Search PRs across GitHub + Bitbucket
│   └── report/
│       └── generator.ts        # Render ReleaseReport → Markdown string
├── dist/                       # Compiled JS output (gitignored, generated)
│   ├── index.js
│   ├── config.js
│   ├── types.js
│   ├── youtrack/
│   ├── github/
│   ├── bitbucket/
│   ├── analyzer/
│   └── report/
├── .spec/                      # Generated artifacts (committed)
│   ├── docs/
│   │   └── plans/              # Implementation plans
│   └── review/                 # Release check reports (release-<ID>.md)
├── .planning/                  # GSD planning documents
│   └── codebase/               # Codebase map documents (ARCHITECTURE.md etc.)
├── .claude/
│   └── commands/
│       └── my/                 # Project-specific Claude slash commands
├── .github/
│   └── workflows/              # CI workflow definitions
├── .env                        # Local credentials (gitignored)
├── .env.example                # Template for .env
├── package.json                # npm metadata, scripts, deps
├── package-lock.json           # Lockfile
├── tsconfig.json               # TypeScript compiler config
├── CLAUDE.md                   # Project instructions for Claude
└── README.md                   # Project documentation
```

## Directory Purposes

**`src/`:**
- Purpose: All TypeScript source code
- Contains: 10 `.ts` files organized by domain subdirectory
- Key files: `index.ts` (entry), `config.ts` (configuration), `types.ts` (shared types)

**`src/youtrack/`:**
- Purpose: Everything related to YouTrack — fetching issues and publishing comments
- Contains: `client.ts` (REST API), `comment-publisher.ts` (upsert logic)

**`src/github/`:**
- Purpose: GitHub integration via the `gh` CLI
- Contains: `client.ts` — search PRs, fetch details, merge status, review threads

**`src/bitbucket/`:**
- Purpose: Bitbucket integration via REST API with Basic auth
- Contains: `client.ts` — search PRs, fetch details, commits, files, build statuses

**`src/analyzer/`:**
- Purpose: Domain analysis logic — dependency gap detection and PR discovery
- Contains: `linked-tasks.ts`, `pr-finder.ts`
- Key characteristic: Both files depend on API clients but have no dependency on each other

**`src/report/`:**
- Purpose: Pure rendering — converts assembled data into Markdown
- Contains: `generator.ts` — all formatting helpers, deploy-order logic, warning grouping

**`dist/`:**
- Purpose: Compiled JavaScript output from `tsc`
- Generated: Yes
- Committed: No (gitignored)

**`.spec/review/`:**
- Purpose: Saved release check reports produced by each run
- Generated: Yes, by `src/index.ts` at runtime
- Committed: Yes (tracked in git per CLAUDE.md)
- Naming: `release-<ISSUE-ID>.md` (e.g., `release-ESN-2274.md`)

**`.spec/docs/plans/`:**
- Purpose: Implementation plans and documentation
- Generated: Manually / by GSD planning commands
- Committed: Yes

## Key File Locations

**Entry Points:**
- `src/index.ts`: CLI entry — `#!/usr/bin/env node`, loads `.env`, orchestrates pipeline

**Configuration:**
- `src/config.ts`: All repo lists (`GITHUB_REPOS`, `BITBUCKET_REPOS`), base URLs, file patterns, credential loaders, `parseIssueId()`
- `.env`: Runtime credentials (`YOUTRACK_TOKEN`, `BITBUCKET_EMAIL`, `BITBUCKET_TOKEN`, `GITHUB_TOKEN`)
- `.env.example`: Template showing all required env vars
- `tsconfig.json`: TypeScript compiler settings (target ES2022, Node16 modules, strict)
- `package.json`: Project metadata, `build`/`dev`/`start` scripts

**Core Logic:**
- `src/analyzer/pr-finder.ts`: Most complex file — parallel BB search, PR caching, linked PR resolution
- `src/analyzer/linked-tasks.ts`: Iterates tasks, calls YouTrack search per link type
- `src/report/generator.ts`: Markdown rendering, deploy order heuristics

**API Clients:**
- `src/youtrack/client.ts`: `YouTrackClient` class — `getReleaseIssue`, `getIssue`, `searchIssues`, `getIssueComments`, `addIssueComment`, `updateIssueComment`
- `src/github/client.ts`: `GitHubClient` class — `searchPRs`, `getPRDetails`, `getMergeRaw`, `getUnresolvedThreadCount`
- `src/bitbucket/client.ts`: `BitbucketClient` class — `searchPRs`, `getPRDetails`, `getPRCommitCount`, `getPRFiles`, `getPRBuildStatuses`

**Types:**
- `src/types.ts`: All shared types — `ReleaseIssue`, `TaskIssue`, `PullRequest`, `LinkedTask`, `TaskReport`, `ReleaseReport`, `Warning`, `ReportOptions`

## Naming Conventions

**Files:**
- Kebab-case: `linked-tasks.ts`, `pr-finder.ts`, `comment-publisher.ts`
- Single-word for simple modules: `client.ts`, `generator.ts`, `config.ts`, `types.ts`

**Directories:**
- Lowercase single-word domain names: `youtrack/`, `github/`, `bitbucket/`, `analyzer/`, `report/`

**Classes:**
- PascalCase with `Client` suffix for API wrappers: `YouTrackClient`, `GitHubClient`, `BitbucketClient`

**Functions:**
- camelCase verbs for exported functions: `analyzeLinkedTasks`, `findPRsForTasks`, `generateReport`, `publishReportComment`, `parseIssueId`
- camelCase verbs for internal helpers: `detectSpecialFiles`, `extractLinkedPRUrls`, `runWithConcurrency`, `mapGHState`, `mapBBState`

**Interfaces:**
- PascalCase: `ReleaseIssue`, `TaskIssue`, `PullRequest`, `TaskReport`, `ReleaseReport`, `Warning`
- Prefixed with platform abbreviation for API response shapes: `YTIssueResponse`, `YTLink`, `GHPRDetails`, `BBPRListItem`

**Constants:**
- SCREAMING_SNAKE_CASE: `YOUTRACK_BASE_URL`, `GITHUB_REPOS`, `BITBUCKET_REPOS`, `BB_CONCURRENCY`, `GH_MAX_ATTEMPTS`

**Report files:**
- Pattern: `release-<ISSUE-ID>.md` in `.spec/review/` (e.g., `release-ESN-2274.md`)

## Where to Add New Code

**New external API integration (e.g., GitLab):**
- Create `src/gitlab/client.ts` following the pattern of `src/github/client.ts` or `src/bitbucket/client.ts`
- Return `PullRequest` objects from `src/types.ts`; add platform tag to `Platform` type in `src/types.ts`
- Add repo list constant to `src/config.ts`
- Wire up in `src/analyzer/pr-finder.ts`

**New analyzer / check:**
- Create `src/analyzer/<name>.ts`; export a single async function accepting client(s) and task list
- Call it from `src/index.ts` pipeline, pass results into `ReleaseReport`

**New report section:**
- Add rendering logic to `src/report/generator.ts` in `generateReport()`
- Add any new data fields to relevant types in `src/types.ts`

**New CLI flag:**
- Parse in `src/index.ts` arg-parsing block (lines 51-54)
- Add to `ReportOptions` in `src/types.ts` if it affects report rendering
- Pass into `generateReport()` call

**New YouTrack interaction:**
- Add method to `src/youtrack/client.ts` using the existing `fetchApi()` private helper
- For comment-related features, extend `src/youtrack/comment-publisher.ts`

**Configuration changes (new repos, new patterns):**
- All additions go in `src/config.ts` — repo arrays, URL constants, file patterns
- Add `REPO_SHORT_NAMES` entry for any new repo

**Shared utilities:**
- Currently no `src/utils/` directory; if extracting shared code (e.g., `detectSpecialFiles` or `extractLinkedPRUrls` which are currently duplicated across clients), create `src/utils/files.ts` or `src/utils/urls.ts`

## Special Directories

**`dist/`:**
- Purpose: TypeScript compilation output (`tsc` mirrors `src/` structure)
- Generated: Yes (`npm run build`)
- Committed: No

**`.spec/review/`:**
- Purpose: Stores release check reports generated by each tool run
- Generated: Yes (runtime output of `src/index.ts`)
- Committed: Yes

**`.spec/docs/`:**
- Purpose: Plans and documentation artifacts
- Generated: Manually
- Committed: Yes

**`.planning/codebase/`:**
- Purpose: GSD codebase map documents used by `/gsd:plan-phase` and `/gsd:execute-phase`
- Generated: By GSD mapping commands
- Committed: Yes

---

*Structure analysis: 2026-06-01*
