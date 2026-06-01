# Technology Stack

**Analysis Date:** 2026-06-01

## Languages

**Primary:**
- TypeScript 5.9.x - All source code in `src/`

**Secondary:**
- JavaScript (compiled output) - `dist/` (generated, not edited directly)

## Runtime

**Environment:**
- Node.js >=18.0.0 (required; tested on v24.1.0)
- CommonJS module system (`"type": "commonjs"` in `package.json`)

**Package Manager:**
- npm 11.3.x
- Lockfile: `package-lock.json` (present)

## Frameworks

**Core:**
- None — plain Node.js CLI tool, no web framework

**Testing:**
- None — no test suite. Validation is done by running the tool against a real YouTrack issue.

**Build/Dev:**
- TypeScript compiler (`tsc`) — compiles `src/` → `dist/`
  - Config: `tsconfig.json`
  - Target: ES2022
  - Module: Node16 / moduleResolution: Node16
  - Strict mode enabled
  - Source maps and declaration files generated

## Key Dependencies

**Critical:**
- `typescript` ^5.9.3 (devDependency) — sole build toolchain; no bundler used
- `@types/node` ^25.2.2 (devDependency) — Node.js type definitions

**Infrastructure:**
- Node.js built-in `fetch` (Node 18+) — used for YouTrack and Bitbucket REST API calls
- Node.js built-in `child_process.execFileSync` — used to shell out to `gh` CLI for GitHub
- Node.js built-in `fs`, `path` — file I/O for `.env` loading and report saving
- `Atomics.wait` + `SharedArrayBuffer` — synchronous sleep in `src/github/client.ts` for retry delays

**No runtime npm dependencies** — `dependencies` field is absent from `package.json`. All external communication goes through built-in Node APIs or external CLI tools.

## Configuration

**Environment:**
- Loaded manually from `.env` in `src/index.ts` (custom parser, not dotenv library)
- Key variables (names only — see `.env.example`):
  - `YOUTRACK_TOKEN` — required; Bearer token for YouTrack REST API
  - `BITBUCKET_EMAIL` — required; Bitbucket account email for Basic auth
  - `BITBUCKET_TOKEN` — required; Bitbucket app password
  - `GITHUB_TOKEN` — optional; used by the `gh` CLI for higher rate limits

**Build:**
- `tsconfig.json` — TypeScript compiler options (rootDir: `src/`, outDir: `dist/`)
- `package.json` scripts: `build` (tsc), `dev` (tsc && node dist/index.js), `start` (node dist/index.js)

## External CLI Dependencies

- `gh` (GitHub CLI) — must be installed and authenticated on the host; used in `src/github/client.ts` via `execFileSync`
- `curl` and `jq` — referenced in CLAUDE.md as external deps, but current source code uses native `fetch` + JSON.parse for Bitbucket; `gh` uses them internally

## Platform Requirements

**Development:**
- Node.js >=18.0.0
- `gh` CLI installed and authenticated
- `.env` file with credentials

**Production:**
- CLI binary: `dist/index.js` (entry point), exposed as `release-helper` bin in `package.json`
- No server, no database, no persistent state — purely single-pass execution

---

*Stack analysis: 2026-06-01*
