# Testing Patterns

**Analysis Date:** 2026-06-01

## Test Framework

**Runner:**
- None. No test framework is installed or configured.
- No `jest`, `vitest`, `mocha`, or any other test runner present in `package.json` dependencies.
- No test config files (`jest.config.*`, `vitest.config.*`) exist in the repo.

**Assertion Library:**
- None.

**Run Commands:**
```bash
# There are no test commands. The only scripts defined in package.json are:
npm run build          # tsc
npm run dev            # tsc && node dist/index.js
npm start              # node dist/index.js
```

## Test File Organization

**Location:**
- No test files exist in the repository. No `*.test.ts`, `*.spec.ts`, or `__tests__/` directories were found.

**From CLAUDE.md:**
> There is no test suite. Validate changes by running the tool against a real YouTrack issue.

## Validation Approach

The project uses manual end-to-end validation as its sole quality gate. The expected validation workflow is:

```bash
# 1. Build TypeScript
npm run build

# 2. Run against a real issue and inspect the generated report
node dist/index.js ESN-2274
# or
node dist/index.js https://tm.ertdev.com/issue/ESN-2274

# 3. Review the generated report at:
# .spec/review/release-<ISSUE-ID>.md

# 4. Run with flags to validate flag behavior
node dist/index.js ESN-2274 --short
node dist/index.js ESN-2274 --overview
node dist/index.js ESN-2274 --no-comment
```

Generated reports are committed to `.spec/review/` as a side-effect archive (25+ files present).

## TypeScript as Quality Gate

TypeScript strict mode serves as the primary static correctness check:

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "Node16"
  }
}
```

`npm run build` (`tsc`) failing means code is wrong. This is the only automated check that runs.

## What to Test If Adding Tests

The codebase has several pure or near-pure functions in `src/report/generator.ts` and `src/github/client.ts` that are good unit test candidates without requiring API mocks:

**Pure formatting helpers in `src/report/generator.ts`:**
- `stateIcon(state: PRState): string`
- `approvalText(approvals: Approval[]): string`
- `commitText(count: number): string`
- `checksText(checks: CheckStatus[]): string`
- `checksDetailText(checks: CheckStatus[]): string`
- `truncateDescription(text: string, maxLen: number): string`
- `detectDeployNotes(description: string): string[]`
- `isTaskReady(report: TaskReport): boolean`
- `countStatuses(taskReports, missingCount): { ready, issues, noPR, searchFailed, missingLinked }`
- `suggestDeployOrder(taskReports, missingReports): string[]`

**Pure helpers in `src/github/client.ts`:**
- `mapGHState(state: string): PRState`
- `mapCheckConclusion(conclusion: string | null, status: string): CheckState`
- `detectSpecialFiles(files: string[]): SpecialFiles`
- `extractLinkedPRUrls(text: string): string[]`
- `normalizeMergeable(value: string | null | undefined): MergeableState`
- `normalizeMergeState(value: string | null | undefined): MergeStateStatus`

**Pure helpers in `src/bitbucket/client.ts`:**
- `mapBBState(state: string): PRState`
- `mapBBCheckState(state: string): CheckState`
- `detectSpecialFiles(files: string[]): SpecialFiles` (duplicated from github/client.ts)
- `extractLinkedPRUrls(text: string): string[]` (duplicated from github/client.ts)

**Config utilities in `src/config.ts`:**
- `parseIssueId(input: string): string | null`
- `loadBitbucketCredentials()` — testable with env var injection

**Concurrency utility in `src/analyzer/pr-finder.ts`:**
- `runWithConcurrency<T>(tasks, concurrency): Promise<T[]>` — pure async utility

## Mocking

**No mocking infrastructure exists.** If tests were added, the following would need mocking:

**External APIs:**
- `YouTrackClient` methods (`getIssue`, `searchIssues`, `getReleaseIssue`) — wraps `fetch()`
- `BitbucketClient` methods — wraps `fetch()`
- `GitHubClient` methods — wraps `execFileSync('gh', ...)` (the `gh` CLI)

**File system:**
- `fs.readFileSync` / `fs.writeFileSync` — used in `src/index.ts` for `.env` loading and report saving

## Coverage

**Requirements:** None enforced.

**Current coverage:** Zero automated coverage. All paths validated manually.

## Notes for Future Test Addition

If a test framework is added, these conventions should be followed based on the existing codebase patterns:

1. **Framework choice:** Vitest is the natural fit for a modern TypeScript/Node project without bundler. Jest is also viable.
2. **Test location:** Co-locate with source — `src/report/generator.test.ts`, `src/config.test.ts`.
3. **Pure functions first:** Start with the formatting helpers in `src/report/generator.ts` — no mocking needed.
4. **Avoid mocking the `gh` CLI:** Integration-test `GitHubClient` end-to-end or extract its parsing logic into pure functions that can be unit-tested separately.
5. **The `detectSpecialFiles` function is duplicated** between `src/github/client.ts` and `src/bitbucket/client.ts` — consolidating into `src/config.ts` or a shared utility would make testing easier.

---

*Testing analysis: 2026-06-01*
