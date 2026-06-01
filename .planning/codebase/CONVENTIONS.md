# Coding Conventions

**Analysis Date:** 2026-06-01

## Naming Patterns

**Files:**
- `camelCase` for multi-word module files: `linked-tasks.ts`, `pr-finder.ts`, `comment-publisher.ts`
- `client.ts` as the canonical filename for each API wrapper module (one per directory: `youtrack/client.ts`, `github/client.ts`, `bitbucket/client.ts`)
- `generator.ts` for the single output-producing module in `report/`
- `index.ts` as the CLI entry point

**Functions:**
- `camelCase` for all functions: `generateReport`, `analyzeLinkedTasks`, `findPRsForTasks`, `parseIssueId`
- `SCREAMING_SNAKE_CASE` for module-level constants: `YOUTRACK_BASE_URL`, `BITBUCKET_REPOS`, `GH_MAX_ATTEMPTS`, `BB_CONCURRENCY`
- Verb-noun pattern for exported functions: `getIssue`, `searchPRs`, `getPRDetails`, `buildMergeStatus`, `detectSpecialFiles`
- Internal helper functions use descriptive verb-noun names without access modifiers: `mapGHState`, `mapCheckConclusion`, `extractLinkedPRUrls`, `truncateDescription`

**Variables:**
- `camelCase` throughout: `taskId`, `prMap`, `linkedPRUrls`, `checkedAt`
- Single-letter loop variables avoided; descriptive names used: `report`, `task`, `pr`, `attempt`
- Plural names for arrays: `taskReports`, `warnings`, `searchErrors`, `linkedPrs`

**Types and Interfaces:**
- `PascalCase` for all exported interfaces and types: `ReleaseIssue`, `TaskIssue`, `PullRequest`, `PRState`
- `PascalCase` for internal (non-exported) interfaces prefixed by platform abbreviation: `YTCustomField`, `YTLink`, `YTIssueResponse`, `GHPRListItem`, `BBPRListItem`
- Union string literal types used for domain enums (no TypeScript `enum` keyword): `PRState = 'MERGED' | 'OPEN' | 'CLOSED' | 'DECLINED'`

## Code Style

**Formatting:**
- No formatter config detected (no `.prettierrc`, `biome.json`, or `.eslintrc`). Style is enforced by convention and TypeScript compiler only.
- 2-space indentation throughout all source files.
- Single quotes for string literals consistently.
- Trailing commas present in multi-line arrays and object literals.

**TypeScript:**
- `strict: true` in `tsconfig.json` — all strict checks enabled including `strictNullChecks`.
- Target `ES2022` with `Node16` module resolution.
- `as const` used where literal type narrowing needed: `state: 'APPROVED' as const`.
- Generics used for API fetch wrappers: `fetchApi<T>(endpoint: string): Promise<T>`.
- `unknown` catch binding followed by `instanceof Error` narrowing: `err instanceof Error ? err.message : String(err)`.
- Bare `catch {}` blocks (without binding) used when the error is intentionally swallowed: `} catch { /* silent */ }`.

**No linter config is present.** Do not assume ESLint rules are enforced automatically.

## Import Organization

**Order (observed pattern):**
1. Node built-in modules: `import { execFileSync } from 'child_process'`, `import * as fs from 'fs'`
2. Local types: `import { ReleaseIssue, TaskIssue } from '../types.js'`
3. Local config: `import { YOUTRACK_API_URL } from '../config.js'`
4. Local client/service modules: `import { YouTrackClient } from '../youtrack/client.js'`
5. Local analyzer/report modules

**Path Aliases:**
- None configured. All imports use relative paths.
- All local imports use `.js` extension (required by Node16 ESM resolution even though source is `.ts`): `import { foo } from './config.js'`.

**Namespace imports:**
- Node built-ins imported as namespace: `import * as fs from 'fs'`, `import * as path from 'path'`.
- Everything else uses named imports: `import { execFileSync } from 'child_process'`.

## Error Handling

**Fatal errors (process exit):**
- Used in `src/index.ts` for unrecoverable startup failures (missing credentials, unparseable issue ID, failed release fetch). Pattern:
```typescript
console.error(`Error: Could not fetch release issue ${issueId}: ${err}`);
process.exit(1);
```

**Non-fatal errors (continue pipeline):**
- Used in analyzers and clients for per-item failures. Logged to `stderr` with `Warning:` prefix and execution continues:
```typescript
process.stderr.write(`  Warning: Could not fetch ${task.id}: ${err}\n`);
continue;
```

**Surfaced errors (returned in data):**
- PR search failures are captured as `SearchError` objects and returned in the `TaskReport`, then surfaced in the generated Markdown report:
```typescript
searchErrors.push({ platform: 'github', repo, message });
```

**Retry pattern:**
- Both `YouTrackClient.fetchApi` and `BitbucketClient.fetchApi` retry up to 3 times on transient failures (`AbortError`, `fetch failed`, `terminated`, HTTP 5xx).
- `GitHubClient.runGH` retries `GH_MAX_ATTEMPTS` (3) times with synchronous `Atomics.wait` sleep between attempts.
- Each retry logs to `stderr` with attempt number.

**Error type narrowing:**
- Always narrow `unknown` caught errors before use:
```typescript
const message = err instanceof Error ? err.message : String(err);
```

## Logging

**Output channels:**
- `process.stderr.write(...)` — progress/debug output during execution (step labels, API calls, warnings). This is what users see while the tool runs.
- `console.error(...)` — fatal error messages before `process.exit(1)` (usage errors, missing credentials).
- `console.log(...)` — success confirmations at end of operations (YouTrack comment published/updated).
- `process.stdout` — not written to directly; generated Markdown report is written to file via `fs.writeFileSync`.

**Progress logging convention in `src/index.ts`:**
```typescript
function log(msg: string): void {
  process.stderr.write(msg + '\n');
}
// Usage:
log('📋 Step 1/7: Fetching release issue...');
```

**API call logging in `YouTrackClient`:**
```typescript
process.stderr.write(`  → ${options?.method ?? 'GET'} ${url}\n`);
```

**Warning convention in analyzers/clients:**
```typescript
process.stderr.write(`  Warning: Could not fetch ${task.id}: ${err}\n`);
process.stderr.write(`    Warning: Could not get commit count for BB ${repo} #${prId}\n`);
```

## Comments

**When to Comment:**
- JSDoc (`/** ... */`) used on exported types and interfaces in `src/types.ts` to clarify non-obvious fields, not for all members.
- JSDoc used on exported functions in `src/github/client.ts` when behavior needs explanation (e.g., retry logic rationale).
- Inline `//` comments mark logical phases within longer functions (`// Step 1: Parse input`, `// Filter by type`).
- Multi-line `/** ... */` block comments mark data-structure definitions in analyzer files.

**JSDoc Usage:**
- No `@param`/`@returns` tags used. JSDoc is descriptive prose only:
```typescript
/** Derive can-merge verdict and human-readable reasons from GitHub merge fields */
function buildMergeStatus(...): MergeStatus { ... }

/** GitHub `mergeable` field — whether the PR has conflicts */
export type MergeableState = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
```

## Function Design

**Size:** Functions range from 3 lines (`log`, `issueLink`) to ~100 lines (`generateReport` inner loop, `getPRDetails`). Large functions in `src/report/generator.ts` and `src/index.ts` are acceptable since they're linear pipelines, not reusable logic.

**Parameters:**
- Prefer structured objects for optional config: `options: ReportOptions = {}` rather than multiple boolean flags.
- Pass dependencies explicitly (no globals): `analyzeLinkedTasks(youtrack, releaseTasks)`, `findPRsForTasks(github, bitbucket, taskIds)`.

**Return Values:**
- Functions that can fail return typed values or throw — no `null | T` mixed returns at the module boundary.
- Internal helpers return empty defaults when data is missing: `return []`, `return ''`.
- `generateReport` accumulates output into a `string[]` array then joins at the end:
```typescript
const lines: string[] = [];
const add = (line: string = '') => lines.push(line);
// ...
return lines.join('\n');
```

## Module Design

**Exports:**
- Each module exports exactly what callers need. No barrel files (`index.ts` in subdirectories).
- API clients exported as classes: `export class YouTrackClient`, `export class GitHubClient`, `export class BitbucketClient`.
- Analyzers and report generator exported as standalone async functions: `export async function analyzeLinkedTasks(...)`, `export function generateReport(...)`.
- Config exported as named constants and utility functions from `src/config.ts`.
- All shared types live exclusively in `src/types.ts`.

**Internal types:**
- API response shapes (not part of the domain model) are defined as non-exported interfaces at the top of each client file: `interface YTIssueResponse`, `interface GHPRDetails`, `interface BBPRListItem`.

**No circular dependencies detected.** Import graph flows: `types` ← `config` ← `clients` ← `analyzers` ← `report` ← `index`.

---

*Convention analysis: 2026-06-01*
