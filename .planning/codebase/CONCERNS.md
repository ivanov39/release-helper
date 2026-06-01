# Codebase Concerns

**Analysis Date:** 2026-06-01

## Tech Debt

**Hardcoded version string in report:**
- Issue: `*Tool: release-helper v1.0.0*` is a string literal that never changes, even as the tool evolves.
- Files: `src/report/generator.ts` line 654
- Impact: Every generated report forever claims version `1.0.0`; misleading when debugging old reports.
- Fix approach: Read `version` from `package.json` at startup and pass it into `generateReport()` or `ReleaseReport`.

**Stale comment mismatch — GITHUB_REPOS has 3 repos, comment says 2:**
- Issue: `src/analyzer/pr-finder.ts` line 110 says `// Search GitHub repos (sequential — only 2 repos, gh CLI is fast)` but `GITHUB_REPOS` in `src/config.ts` contains 3 entries (`es-next`, `es-application`, `es-pass`).
- Files: `src/analyzer/pr-finder.ts` line 110, `src/config.ts` lines 4-8
- Impact: Low — functional correctness is fine, but comment misleads future maintainers about loop scope.
- Fix approach: Update the comment to reflect the actual count, or make it dynamic.

**`REPO_SHORT_NAMES` key mismatch for GitHub `es-pass`:**
- Issue: `GITHUB_REPOS` contains `'omi-enjoy/es-pass'` (full repo path) but `REPO_SHORT_NAMES` has the key `'es-pass'` (without org prefix). The lookup in `src/github/client.ts` line 311 falls back to `repo.split('/').pop()`, so the final value is accidentally correct, but this is fragile.
- Files: `src/config.ts` lines 7, 41; `src/github/client.ts` line 311
- Impact: If the fallback is ever removed or changed, `es-pass` GitHub PRs will display the full repo path as the short name.
- Fix approach: Add `'omi-enjoy/es-pass': 'es-pass'` to `REPO_SHORT_NAMES` to make it explicit.

**Retry count inconsistency across API clients:**
- Issue: YouTrack client (`src/youtrack/client.ts` line 56) loops `attempt = 0..maxRetries` (4 total iterations for `maxRetries=3`). Bitbucket and GitHub clients loop `attempt = 1..maxAttempts` (3 total for `maxAttempts=3`). The error message in YouTrack says "after `maxRetries + 1` attempts" to compensate, but the pattern is inconsistent.
- Files: `src/youtrack/client.ts` lines 54-95; `src/bitbucket/client.ts` lines 103-145; `src/github/client.ts` lines 46-66
- Impact: YouTrack requests get one extra attempt than Bitbucket/GitHub requests, with no documented reason. Makes the retry behavior harder to reason about.
- Fix approach: Standardize on a single pattern (e.g., `attempt = 1..maxAttempts`) across all three clients.

**Bitbucket PR search is not paginated:**
- Issue: `searchPRs` in `src/bitbucket/client.ts` line 152 fetches `/pullrequests?state=ALL&pagelen=50` but does not follow the `next` cursor even though `BBPRResponse.next` is declared (line 28). For busy repos with many old PRs, the task ID may only appear in PRs beyond page 1.
- Files: `src/bitbucket/client.ts` lines 28, 147-167
- Impact: PRs older than 50 positions in a repo's history are silently missed. No warning is produced.
- Fix approach: Follow `next` links up to a reasonable cap (e.g., 5 pages / 250 PRs) or document the limitation explicitly.

**YouTrack linked-task search is not paginated (`$top=300`):**
- Issue: `searchIssues` in `src/youtrack/client.ts` line 191 uses `$top=300`. If a release contains more than 300 linked issues or a task has more than 300 related issues, items beyond the limit are silently dropped.
- Files: `src/youtrack/client.ts` line 191
- Impact: Silent data loss on very large releases.
- Fix approach: Use `$top=-1` (YouTrack's "all" sentinel) or implement cursor-based pagination using `$skip`.

**Bitbucket PR commit count capped at 100:**
- Issue: `getPRCommitCount` in `src/bitbucket/client.ts` line 230 uses `pagelen=100` without pagination. PRs with more than 100 commits will report exactly `100`.
- Files: `src/bitbucket/client.ts` lines 228-233
- Impact: The "not squashed" warning (`commitCount > 1`) still fires, but the displayed count is wrong for large PRs.
- Fix approach: Follow `next` pages to get the true total, or at least cap the warning to "100+" so it's visually clear.

**Deploy-notes keyword list is hardcoded in `generator.ts`:**
- Issue: The deploy-notes extraction keywords (`'не забыть'`, `'migration'`, etc.) at `src/report/generator.ts` lines 169-178 are a plain array literal with no extension point.
- Files: `src/report/generator.ts` lines 166-188
- Impact: Adding a new keyword requires editing the generator; no central config location exists for ops-facing keywords.
- Fix approach: Move the keyword list to `src/config.ts` alongside `COMPOSER_PATTERNS` and `PARAMS_PATTERNS`.

**Linked-PR resolution depth is fixed at 1 and undocumented:**
- Issue: `findPRsForTasks` in `src/analyzer/pr-finder.ts` collects linked PR URLs only from primary PR descriptions (not from linked PRs' descriptions), giving a single level of recursion. This is correct behaviour but is not documented in code or README.
- Files: `src/analyzer/pr-finder.ts` lines 172-203
- Impact: Chains of linked PRs (A → B → C) will miss the tail. Silent omission.
- Fix approach: Document the depth limit with an inline comment; optionally make depth configurable.

## Known Bugs

**Linked-PR Bitbucket cache key inconsistency:**
- Symptoms: A Bitbucket linked PR is cached under key `bitbucket:{owner}/{repo}:{number}` (`ref.owner/ref.repo`) but the primary PR cache uses `bb:{repo}:{id}` (just `repo`, without org). A linked PR that was previously fetched as a primary PR will be fetched again instead of reusing the cache.
- Files: `src/analyzer/pr-finder.ts` lines 115-116, 180, 184, 190-194
- Trigger: Any task whose primary Bitbucket PR also appears as a linked PR reference in another primary PR.
- Workaround: Low-impact (duplicate network call), no data corruption.

**Missing-linked-task warning is not generated when a missing task has no PRs:**
- Symptoms: When a missing linked task is found but has zero PRs and zero search errors, no `pr_issue` warning about "No PR found" is emitted. Primary release tasks do get this warning (see `src/index.ts` lines 188-193) but the equivalent check is absent for missing-linked-task PR data (lines 277-286).
- Files: `src/index.ts` lines 277-286
- Trigger: Missing linked task that genuinely has no PR yet.
- Workaround: The "Missing linked task" warning itself is still shown; the secondary "No PR found" warning is just absent.

**`loadEnvFile` does not strip surrounding quotes from values:**
- Symptoms: If `.env` contains `YOUTRACK_TOKEN="perm:abc123"` (with quotes, common in some dotenv generators), the token value becomes `"perm:abc123"` (with literal quotes) instead of `perm:abc123`, causing API authentication to fail with a non-obvious error.
- Files: `src/index.ts` lines 7-21
- Trigger: `.env` values wrapped in double or single quotes.
- Workaround: Write values without quotes in `.env`.

## Security Considerations

**`.bitbucket.env.bak` file committed to `.gitignore` but still present on disk:**
- Risk: A backup file containing Bitbucket credentials (`.bitbucket.env.bak`) exists in the working tree. It is excluded by `.gitignore` but if `.gitignore` rules are accidentally relaxed or `git add -f` is used, credentials could be committed.
- Files: `.bitbucket.env.bak` (repo root), `.gitignore` line 5
- Current mitigation: `.gitignore` entry prevents accidental commit.
- Recommendations: Delete the backup file from disk entirely; rotate the credentials if in doubt.

**YouTrack Bearer token visible in verbose stderr output:**
- Risk: `fetchApi` in `src/youtrack/client.ts` line 53 logs the full URL including the `fields=` query string to stderr. While the token itself is sent in the `Authorization` header (not the URL), someone with stderr access can infer which API endpoint and fields are queried. The token value is not logged directly.
- Files: `src/youtrack/client.ts` line 53
- Current mitigation: Token is passed via header only; URL logging reveals no secret.
- Recommendations: Low severity; acceptable for a local dev tool. Consider adding a `--verbose` flag to gate this output.

**Credentials sourced via a hand-rolled `.env` parser, not a hardened library:**
- Risk: `loadEnvFile` in `src/index.ts` lines 7-21 is a minimal parser. It does not handle multi-line values, shell escaping, or quoted values. A malformed `.env` could silently load wrong credentials.
- Files: `src/index.ts` lines 7-21
- Current mitigation: In practice the `.env` is simple and operator-controlled.
- Recommendations: Replace with a well-tested library such as `dotenv` (zero-dependency npm package), or at minimum add quote-stripping and skip blank/comment lines robustly.

**No validation that fetched GitHub JSON matches expected shape:**
- Risk: `getPRDetails` in `src/github/client.ts` line 281 calls `JSON.parse(output)` and casts to `GHPRDetails` without runtime validation. If `gh` CLI changes its output schema or returns an unexpected error object, the cast succeeds silently and downstream code accesses `undefined` fields.
- Files: `src/github/client.ts` lines 270-346
- Current mitigation: TypeScript compile-time typing only; no runtime guard.
- Recommendations: Add a minimal shape check (e.g., assert `typeof data.number === 'number'`) before using the parsed object.

## Performance Bottlenecks

**GitHub searches are fully sequential across repos and tasks:**
- Problem: `src/analyzer/pr-finder.ts` lines 111-128 loop over `GITHUB_REPOS` sequentially inside a sequential loop over `taskIds`. For a release with 50 tasks and 3 GitHub repos, this is 150 sequential `gh` CLI invocations plus up to 150 more for `getPRDetails`.
- Files: `src/analyzer/pr-finder.ts` lines 104-128
- Cause: `gh` CLI is synchronous (`execFileSync`); the current design processes one GitHub repo at a time.
- Improvement path: Parallelize GitHub repo searches per task using `Promise.all`, similar to the Bitbucket concurrency model. Requires switching GitHub calls to async `execFile` or `spawn`.

**`sleepSync` blocks the event loop on GitHub retries:**
- Problem: `sleepSync` in `src/github/client.ts` lines 40-42 uses `Atomics.wait` to block the Node.js main thread. During retry delays (500ms × attempt) and merge-status polling (2000ms), no other async I/O can proceed.
- Files: `src/github/client.ts` lines 40-42, 60, 375
- Cause: `gh` CLI calls use `execFileSync` (synchronous), so `await new Promise(r => setTimeout(r, ms))` would not help without refactoring to async `execFile`.
- Improvement path: Migrate `runGH` to use `execFile` with a promise wrapper; replace `sleepSync` with `await sleep()`.

**`analyzeLinkedTasks` makes one YouTrack API call per task per link type:**
- Problem: For a release with 50 tasks each having 4 link types, up to 200 sequential YouTrack API calls are made in `src/analyzer/linked-tasks.ts` (the inner loop at lines 48-88).
- Files: `src/analyzer/linked-tasks.ts` lines 34-88
- Cause: Sequential `for` loops; no concurrency.
- Improvement path: Batch tasks or run link-type lookups in parallel (e.g., `Promise.all` over link types per task) with a concurrency limiter.

## Fragile Areas

**`config.ts` repo lists are all static, no runtime discovery:**
- Files: `src/config.ts` lines 4-34
- Why fragile: Adding or removing a repo from the project requires editing source code and rebuilding. If a new Bitbucket repo is added to the org, it is invisible to the tool until `BITBUCKET_REPOS` is manually updated.
- Safe modification: Edit `BITBUCKET_REPOS` or `GITHUB_REPOS` arrays and run `npm run build`. Verify with a real issue run.
- Test coverage: None — no tests exist for any module.

**`detectSpecialFiles` is duplicated across two clients:**
- Files: `src/bitbucket/client.ts` lines 59-82; `src/github/client.ts` lines 91-114
- Why fragile: Bug fixes or pattern additions must be made in both places. They are currently identical but can diverge silently.
- Safe modification: Extract to a shared utility module (e.g., `src/utils/special-files.ts`) and import from both clients.

**`extractLinkedPRUrls` is also duplicated:**
- Files: `src/bitbucket/client.ts` lines 84-92; `src/github/client.ts` lines 116-129; `src/analyzer/pr-finder.ts` lines 19-48 (slightly different — returns structured `LinkedPRRef` objects)
- Why fragile: Three separate regex implementations for the same URL patterns. Pattern changes must be replicated; the `pr-finder.ts` version diverges in return type.
- Safe modification: Consolidate the raw regex into `src/config.ts` or a shared utility; `pr-finder.ts` variant can wrap the shared version.

**`runWithConcurrency` is a hand-rolled concurrency limiter with shared mutable index:**
- Files: `src/analyzer/pr-finder.ts` lines 51-68
- Why fragile: The `index` variable is shared across all worker closures via closure capture. This relies on single-threaded JavaScript semantics and breaks if ever moved to a multi-threaded context (e.g., worker threads).
- Safe modification: The implementation is correct in Node.js single-threaded mode; add a comment noting the assumption.

**`generateReport` is a 658-line function with no sub-functions for major sections:**
- Files: `src/report/generator.ts` lines 275-658
- Why fragile: The entire report is generated by a single function. Any change to one section risks accidentally affecting another via the shared `lines` array. Adding a new section requires navigating the full function.
- Safe modification: Extract section renderers (e.g., `renderSummary`, `renderTaskDetails`, `renderWarnings`) as private functions with their own `lines` arrays, then join at the top level.

## Scaling Limits

**Bitbucket PR search window (50 PRs per repo):**
- Current capacity: 50 most-recent PRs per repo fetched for matching (no pagination).
- Limit: PRs older than position 50 in a given repo are never matched.
- Scaling path: Add pagination in `searchPRs` following the `next` cursor.

**YouTrack linked-issue search cap (300 issues):**
- Current capacity: 300 results per `searchIssues` call.
- Limit: Releases with more than 300 linked issues or tasks with more than 300 dependent tasks will silently drop overflow results.
- Scaling path: Switch to `$top=-1` or implement skip-based pagination in `YouTrackClient.searchIssues`.

## Dependencies at Risk

**No runtime dependencies — `gh` CLI is an undeclared external dependency:**
- Risk: The tool hard-requires the `gh` GitHub CLI to be installed, authenticated, and on `$PATH`, but this is not declared in `package.json` and not validated at startup.
- Impact: Running without `gh` produces a cryptic `execFileSync` error rather than a clear "gh CLI not found" message.
- Migration plan: Add a startup preflight check (`gh --version`) and print a helpful install message if it fails. Document `gh` as a hard prerequisite in `README.md` and `package.json` `engines` or `peerDependencies`.

**TypeScript `^5.9.3` and `@types/node ^25.2.2` are very new:**
- Risk: Both are pre-release or very recent versions pinned with `^`. A patch or minor bump could introduce breaking changes in the dev toolchain.
- Impact: `npm install` on a fresh machine could silently upgrade to a newer incompatible version.
- Migration plan: Consider locking with `package-lock.json` (already present) and consider pinning exact versions in `devDependencies` for stability.

## Missing Critical Features

**No startup validation that `gh` CLI is authenticated:**
- Problem: The tool checks for `YOUTRACK_TOKEN` and Bitbucket credentials at startup but never verifies that `gh` is installed or that its auth token is valid.
- Blocks: Any GitHub PR search silently returns an empty list or crashes mid-run when `gh` is missing or unauthenticated.

**No test suite of any kind:**
- Problem: The CLAUDE.md explicitly states "There is no test suite." All validation is done by running against a real YouTrack issue.
- Blocks: Safe refactoring of `generator.ts`, `config.ts` patterns, or client retry logic is impossible without manual regression testing.
- Priority: High — the report generator's Markdown output and the PR matching logic are complex enough to benefit from snapshot/unit tests.

**No `--dry-run` or offline mode:**
- Problem: Every run makes live network requests to YouTrack, GitHub, and Bitbucket. There is no way to test report generation with cached data.
- Blocks: Development and debugging require real credentials and internet access; report formatting changes cannot be tested locally without a live release issue.

## Test Coverage Gaps

**Entire codebase is untested:**
- What's not tested: All of `src/` — PR matching logic, report generation, linked-task analysis, retry behaviour, `.env` parsing, pagination, special-file detection.
- Files: All `src/**/*.ts`
- Risk: Any refactoring can silently break report output or PR matching without detection.
- Priority: High for `src/report/generator.ts` (complex Markdown generation) and `src/analyzer/pr-finder.ts` (PR deduplication and linked-PR resolution logic).

---

*Concerns audit: 2026-06-01*
