import { execFileSync } from 'child_process';
import {
  PullRequest,
  Approval,
  CheckStatus,
  CheckState,
  PRState,
  SpecialFiles,
  MergeableState,
  MergeStateStatus,
  MergeStatus,
} from '../types.js';
import { REPO_SHORT_NAMES, COMPOSER_PATTERNS, PARAMS_PATTERNS } from '../config.js';

interface GHPRListItem {
  number: number;
  title: string;
  headRefName: string;
  url: string;
  state: string;
}

interface GHPRDetails {
  number: number;
  title: string;
  body: string;
  state: string;
  url: string;
  author: { login: string };
  reviews: Array<{ state: string; author: { login: string } }>;
  commits: Array<unknown>;
  comments: Array<{ body: string }>;
  statusCheckRollup: Array<{ name: string; conclusion: string | null; status: string }> | null;
  files: Array<{ path: string }>;
}

const GH_MAX_ATTEMPTS = 3;
export { GH_MAX_ATTEMPTS };

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runGH(args: string[]): string {
  const label = `gh ${args.slice(0, 3).join(' ')}`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= GH_MAX_ATTEMPTS; attempt++) {
    try {
      return execFileSync('gh', args, {
        encoding: 'utf-8',
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (err) {
      lastErr = err;
      if (attempt < GH_MAX_ATTEMPTS) {
        process.stderr.write(
          `    Warning: ${label} failed (attempt ${attempt}/${GH_MAX_ATTEMPTS}), retrying...\n`,
        );
        sleepSync(500 * attempt);
      }
    }
  }
  const summary = lastErr instanceof Error ? lastErr.message.split('\n')[0] : String(lastErr);
  throw new Error(`${label} failed after ${GH_MAX_ATTEMPTS} attempts: ${summary}`);
}

function mapGHState(state: string): PRState {
  switch (state.toUpperCase()) {
    case 'MERGED':
      return 'MERGED';
    case 'OPEN':
      return 'OPEN';
    case 'CLOSED':
      return 'CLOSED';
    default:
      return 'CLOSED';
  }
}

function mapCheckConclusion(conclusion: string | null, status: string): CheckState {
  if (conclusion === 'SUCCESS') return 'SUCCESS';
  if (conclusion === 'FAILURE') return 'FAILURE';
  if (conclusion === 'CANCELLED' || conclusion === 'SKIPPED') return 'CANCELLED';
  if (conclusion === 'ACTION_REQUIRED') return 'FAILURE';
  if (status === 'IN_PROGRESS' || status === 'QUEUED' || status === 'PENDING') return 'PENDING';
  if (conclusion === null || conclusion === '') return 'PENDING';
  return 'SUCCESS';
}

function detectSpecialFiles(files: string[]): SpecialFiles {
  const composerFiles: string[] = [];
  const paramsFiles: string[] = [];

  for (const f of files) {
    const basename = f.split('/').pop() ?? f;
    if (COMPOSER_PATTERNS.includes(basename)) {
      composerFiles.push(basename);
    }
    for (const pattern of PARAMS_PATTERNS) {
      if (pattern.test(f)) {
        paramsFiles.push(f);
        break;
      }
    }
  }

  return {
    composer: composerFiles.length > 0,
    params: paramsFiles.length > 0,
    composerFiles,
    paramsFiles,
  };
}

function extractLinkedPRUrls(text: string): string[] {
  if (!text) return [];
  const urls: string[] = [];

  // GitHub PR URLs
  const ghMatches = text.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/g);
  if (ghMatches) urls.push(...ghMatches);

  // Bitbucket PR URLs
  const bbMatches = text.match(/https:\/\/bitbucket\.org\/[^/]+\/[^/]+\/pull-requests\/\d+/g);
  if (bbMatches) urls.push(...bbMatches);

  return [...new Set(urls)];
}

function normalizeMergeable(value: string | null | undefined): MergeableState {
  switch ((value ?? '').toUpperCase()) {
    case 'MERGEABLE':
      return 'MERGEABLE';
    case 'CONFLICTING':
      return 'CONFLICTING';
    default:
      return 'UNKNOWN';
  }
}

function normalizeMergeState(value: string | null | undefined): MergeStateStatus {
  switch ((value ?? '').toUpperCase()) {
    case 'CLEAN':
      return 'CLEAN';
    case 'BLOCKED':
      return 'BLOCKED';
    case 'BEHIND':
      return 'BEHIND';
    case 'DIRTY':
      return 'DIRTY';
    case 'UNSTABLE':
      return 'UNSTABLE';
    case 'DRAFT':
      return 'DRAFT';
    case 'HAS_HOOKS':
      return 'HAS_HOOKS';
    default:
      return 'UNKNOWN';
  }
}

/** Derive can-merge verdict and human-readable reasons from GitHub merge fields */
function buildMergeStatus(
  raw: { mergeable: string; mergeStateStatus: string },
  approvals: Approval[],
  checks: CheckStatus[],
  unresolvedThreads: number | undefined,
): MergeStatus {
  const mergeable = normalizeMergeable(raw.mergeable);
  const mergeStateStatus = normalizeMergeState(raw.mergeStateStatus);
  const canMerge = mergeStateStatus === 'CLEAN';

  const reasons: string[] = [];
  if (!canMerge) {
    // Specifics inferred from already-fetched review/CI data
    const specifics: string[] = [];
    if (mergeable === 'CONFLICTING') specifics.push('конфликты с базовой веткой');
    if (approvals.length === 0) specifics.push('нет апрувов');
    if (checks.some((c) => c.state === 'FAILURE')) specifics.push('падают CI-проверки');
    else if (checks.some((c) => c.state === 'PENDING')) specifics.push('CI-проверки ещё идут');
    if (typeof unresolvedThreads === 'number' && unresolvedThreads > 0) {
      specifics.push(`${unresolvedThreads} нерешённых обсуждений (review threads)`);
    }

    switch (mergeStateStatus) {
      case 'BLOCKED':
        if (specifics.length > 0) reasons.push(...specifics);
        else reasons.push('заблокирован защитой ветки (нерешённые обсуждения или непройденные проверки)');
        break;
      case 'BEHIND':
        reasons.push('ветка отстаёт от базовой — нужно обновить (merge/rebase базовой ветки)');
        reasons.push(...specifics);
        break;
      case 'DIRTY':
        reasons.push('конфликты слияния — требуется ручное разрешение');
        break;
      case 'UNSTABLE':
        reasons.push('необязательные проверки падают или ещё идут');
        reasons.push(...specifics);
        break;
      case 'DRAFT':
        reasons.push('PR в статусе черновика (Draft)');
        break;
      case 'HAS_HOOKS':
        reasons.push('блокируется pre-receive хуками репозитория');
        break;
      case 'UNKNOWN':
        reasons.push('GitHub ещё не рассчитал состояние слияния (UNKNOWN)');
        break;
      default:
        reasons.push(...specifics);
    }
  }

  return {
    mergeable,
    mergeStateStatus,
    canMerge,
    reasons: [...new Set(reasons)],
    unresolvedThreads,
  };
}

export class GitHubClient {
  async searchPRs(
    repo: string,
    taskId: string,
  ): Promise<Array<{ number: number; title: string; branch: string; url: string; state: string }>> {
    // Use --search for server-side filtering — avoids missing old PRs
    // that fall outside a fixed --limit window
    const output = runGH([
      'pr',
      'list',
      '-R',
      repo,
      '--state',
      'all',
      '--search',
      taskId,
      '--limit',
      '50',
      '--json',
      'number,title,headRefName,url,state',
    ]);

    let items: GHPRListItem[];
    try {
      items = JSON.parse(output);
    } catch {
      return [];
    }

    const pattern = taskId.toLowerCase();
    return items
      .filter(
        (item) =>
          item.headRefName.toLowerCase().includes(pattern) ||
          item.title.toLowerCase().includes(pattern),
      )
      .map((item) => ({
        number: item.number,
        title: item.title,
        branch: item.headRefName,
        url: item.url,
        state: item.state,
      }));
  }

  async getPRDetails(repo: string, prNumber: number): Promise<PullRequest> {
    const output = runGH([
      'pr',
      'view',
      String(prNumber),
      '-R',
      repo,
      '--json',
      'number,title,body,state,url,author,reviews,commits,comments,statusCheckRollup,files',
    ]);

    const data: GHPRDetails = JSON.parse(output);

    // Parse approvals - unique APPROVED reviewers
    const approvedMap = new Map<string, Approval>();
    for (const review of data.reviews ?? []) {
      if (review.state === 'APPROVED') {
        approvedMap.set(review.author.login, {
          name: review.author.login,
          state: 'APPROVED',
        });
      }
    }
    const approvals = Array.from(approvedMap.values());

    // Parse checks
    const checks: CheckStatus[] = (data.statusCheckRollup ?? []).map((c) => ({
      name: c.name,
      state: mapCheckConclusion(c.conclusion, c.status),
    }));

    // File paths
    const files = (data.files ?? []).map((f) => f.path);

    // Linked PRs from body and comments
    const linkedPRUrls = extractLinkedPRUrls(data.body ?? '');
    const commentsToCheck = (data.comments ?? []).slice(0, 3);
    for (const comment of commentsToCheck) {
      linkedPRUrls.push(...extractLinkedPRUrls(comment.body));
    }

    const repoShortName = REPO_SHORT_NAMES[repo] ?? repo.split('/').pop() ?? repo;

    const state = mapGHState(data.state);

    // Merge readiness is only meaningful for OPEN PRs (others are settled).
    let mergeStatus: MergeStatus | undefined;
    if (state === 'OPEN') {
      const raw = this.getMergeRaw(repo, data.number);
      // Unresolved review threads only matter when not already cleanly mergeable.
      const unresolvedThreads =
        raw.mergeStateStatus.toUpperCase() === 'CLEAN'
          ? undefined
          : this.getUnresolvedThreadCount(repo, data.number);
      mergeStatus = buildMergeStatus(raw, approvals, checks, unresolvedThreads);
    }

    return {
      platform: 'github',
      repo,
      repoShortName,
      number: data.number,
      title: data.title,
      url: data.url,
      author: data.author.login,
      state,
      approvals,
      commitCount: (data.commits ?? []).length,
      checks,
      files,
      specialFiles: detectSpecialFiles(files),
      description: data.body ?? '',
      linkedPRUrls: [...new Set(linkedPRUrls)],
      isLinked: false,
      mergeStatus,
    };
  }

  /**
   * Fetch `mergeable` + `mergeStateStatus` for a PR. GitHub computes these
   * asynchronously, so retry while `mergeStateStatus` is UNKNOWN (per gh docs).
   */
  getMergeRaw(repo: string, prNumber: number): { mergeable: string; mergeStateStatus: string } {
    for (let attempt = 1; attempt <= GH_MAX_ATTEMPTS; attempt++) {
      const output = runGH([
        'pr',
        'view',
        String(prNumber),
        '-R',
        repo,
        '--json',
        'mergeable,mergeStateStatus',
      ]);
      let data: { mergeable?: string; mergeStateStatus?: string };
      try {
        data = JSON.parse(output);
      } catch {
        return { mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' };
      }
      const mergeable = data.mergeable ?? 'UNKNOWN';
      const mergeStateStatus = data.mergeStateStatus ?? 'UNKNOWN';
      if (mergeStateStatus.toUpperCase() !== 'UNKNOWN' || attempt === GH_MAX_ATTEMPTS) {
        return { mergeable, mergeStateStatus };
      }
      // Give GitHub a moment to finish recomputing, then retry.
      sleepSync(2000);
    }
    return { mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' };
  }

  /**
   * Count unresolved review threads via GraphQL (the REST/`gh pr view --json`
   * surface does not expose thread resolution). Best-effort: returns undefined
   * on any error so it never blocks the report.
   */
  getUnresolvedThreadCount(repo: string, prNumber: number): number | undefined {
    const [owner, name] = repo.split('/');
    if (!owner || !name) return undefined;
    try {
      const output = runGH([
        'api',
        'graphql',
        '-f',
        `owner=${owner}`,
        '-f',
        `name=${name}`,
        '-F',
        `number=${prNumber}`,
        '-f',
        'query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved}}}}}',
      ]);
      const data = JSON.parse(output);
      const nodes: Array<{ isResolved: boolean }> =
        data?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
      return nodes.filter((n) => !n.isResolved).length;
    } catch {
      return undefined;
    }
  }

  async getCollaborators(repo: string): Promise<string[]> {
    try {
      const output = runGH([
        'api',
        `repos/${repo}/collaborators`,
        '--jq',
        '[.[] | select(.permissions.push == true) | .login]',
      ]);
      return JSON.parse(output);
    } catch {
      return [];
    }
  }
}
