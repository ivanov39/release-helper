# External Integrations

**Analysis Date:** 2026-06-01

## APIs & External Services

**Issue Tracker:**
- YouTrack (self-hosted at `https://tm.ertdev.com`)
  - Purpose: Fetch release issues, linked tasks, issue details; post analysis report as comments
  - Client: `src/youtrack/client.ts` (`YouTrackClient` class)
  - Auth: Bearer token (`Authorization: Bearer <token>`)
  - Env var: `YOUTRACK_TOKEN`
  - API base: `https://tm.ertdev.com/api`
  - Transport: Node.js built-in `fetch()` with 15s timeout, up to 3 retries
  - Key endpoints used:
    - `GET /api/issues/{id}` — fetch single issue with custom fields and links
    - `GET /api/issues?query=links:{id}` — search linked issues (limit 300)
    - `GET /api/issues/{id}/comments` — read existing comments
    - `POST /api/issues/{id}/comments` — create new comment
    - `POST /api/issues/{id}/comments/{commentId}` — update existing comment

**Version Control / Code Review (GitHub):**
- GitHub (cloud, `https://github.com`)
  - Purpose: Search PRs by task ID, fetch PR details (approvals, CI checks, file diffs, merge status, review threads)
  - Client: `src/github/client.ts` (`GitHubClient` class)
  - Auth: delegated to `gh` CLI (must be pre-authenticated on host machine)
  - Env var: `GITHUB_TOKEN` (optional, improves `gh` rate limits)
  - Transport: `child_process.execFileSync('gh', [...])` — synchronous shell-out with 30s timeout and 3 retries
  - Repos searched: `omi-enjoy/es-next`, `omi-enjoy/es-application`, `omi-enjoy/es-pass` (defined in `src/config.ts`)
  - Key `gh` sub-commands used:
    - `gh pr list -R <repo> --state all --search <taskId> --json ...`
    - `gh pr view <num> -R <repo> --json number,title,body,state,url,author,reviews,commits,comments,statusCheckRollup,files`
    - `gh pr view <num> -R <repo> --json mergeable,mergeStateStatus` (merge status, retried while UNKNOWN)
    - `gh api graphql` — count unresolved review threads via GraphQL
    - `gh api repos/<repo>/collaborators` — fetch repo collaborators

**Version Control / Code Review (Bitbucket):**
- Bitbucket Cloud (`https://api.bitbucket.org/2.0`)
  - Purpose: Search PRs by task ID, fetch PR details (approvals, commit count, file diffs, build statuses)
  - Client: `src/bitbucket/client.ts` (`BitbucketClient` class)
  - Auth: HTTP Basic auth (`Authorization: Basic base64(email:token)`)
  - Env vars: `BITBUCKET_EMAIL`, `BITBUCKET_TOKEN` (Bitbucket app password)
  - Transport: Node.js built-in `fetch()` with 15s timeout, up to 3 retries; up to 5 concurrent requests (concurrency=5 in `src/analyzer/pr-finder.ts`)
  - Org: `omi-russia`
  - Repos searched: 21 repos defined in `src/config.ts` (`BITBUCKET_REPOS`)
  - Key endpoints used:
    - `GET /repositories/omi-russia/{repo}/pullrequests?state=ALL&pagelen=50`
    - `GET /repositories/omi-russia/{repo}/pullrequests/{id}`
    - `GET /repositories/omi-russia/{repo}/pullrequests/{id}/commits?pagelen=100`
    - `GET /repositories/omi-russia/{repo}/pullrequests/{id}/diffstat?pagelen=100`
    - `GET /repositories/omi-russia/{repo}/pullrequests/{id}/statuses`

## Data Storage

**Databases:**
- None — no database connection of any kind

**File Storage:**
- Local filesystem only
  - Reports saved to `.spec/review/release-<ID>.md` relative to `process.cwd()`
  - Directory created automatically via `fs.mkdirSync(..., { recursive: true })`

**Caching:**
- None — every run re-fetches all data from APIs

## Authentication & Identity

**YouTrack:**
- Implementation: Bearer token in `Authorization` header
- Token loaded from `YOUTRACK_TOKEN` env var via `src/config.ts` `getYouTrackToken()`

**GitHub:**
- Implementation: Delegated to `gh` CLI session (OAuth device flow or token stored by `gh`)
- Optional `GITHUB_TOKEN` env var improves rate limits when passed to `gh`

**Bitbucket:**
- Implementation: HTTP Basic auth with email + app password
- Credentials loaded from `BITBUCKET_EMAIL` / `BITBUCKET_TOKEN` env vars via `src/config.ts` `loadBitbucketCredentials()`
- Base64-encoded and stored in-memory as `authHeader` field on `BitbucketClient`

## Monitoring & Observability

**Error Tracking:**
- None — errors are printed to `process.stderr` and the process exits with code 1

**Logs:**
- `process.stderr` for progress messages and warnings
- `process.stdout` (via `console.log`) for final YouTrack comment result
- Report saved as Markdown file (`.spec/review/release-<ID>.md`)

## CI/CD & Deployment

**Hosting:**
- No server deployment — the tool runs locally as a CLI

**CI Pipeline:**
- `.github/workflows/auto-assign-pr-creator.yml` — GitHub Actions workflow that auto-assigns the PR creator when a PR is opened; uses `GH_TOKEN` secret (built-in `github.token`)

## Environment Configuration

**Required env vars:**
- `YOUTRACK_TOKEN` — YouTrack personal access token (permanent token format `perm-...`)
- `BITBUCKET_EMAIL` — Bitbucket account email address
- `BITBUCKET_TOKEN` — Bitbucket app password (format `ATBB-...`)

**Optional env vars:**
- `GITHUB_TOKEN` — GitHub token to supplement `gh` CLI auth (reduces rate-limit risk)

**Secrets location:**
- `.env` file in project root (loaded manually at startup in `src/index.ts`)
- `.env.example` documents all variable names and where to obtain values
- `.env` is not committed (implied by standard practice; not in repo)

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- None (the tool posts comments to YouTrack on completion, but this is a direct API write, not a webhook)

## Linked PR Resolution

Both GitHub and Bitbucket PR descriptions are scanned for cross-platform PR URLs using regex patterns in `src/github/client.ts` and `src/bitbucket/client.ts`. Discovered URLs are recursively fetched at depth 1 in `src/analyzer/pr-finder.ts` to surface linked PRs from other repos/platforms.

---

*Integration audit: 2026-06-01*
