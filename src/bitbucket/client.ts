import {
  PullRequest,
  Approval,
  CheckStatus,
  CheckState,
  PRState,
  SpecialFiles,
} from '../types.js';
import { BITBUCKET_API_URL, BITBUCKET_ORG, REPO_SHORT_NAMES, COMPOSER_PATTERNS, PARAMS_PATTERNS } from '../config.js';

interface BBPRListItem {
  id: number;
  title: string;
  state: string;
  source: { branch: { name: string } };
  author: { display_name: string };
  links: { html: { href: string } };
  description: string;
  participants: Array<{
    approved: boolean;
    user: { display_name: string };
    role: string;
  }>;
}

interface BBPRResponse {
  values: BBPRListItem[];
  next?: string;
}

function mapBBState(state: string): PRState {
  switch (state.toUpperCase()) {
    case 'MERGED':
      return 'MERGED';
    case 'OPEN':
      return 'OPEN';
    case 'DECLINED':
      return 'DECLINED';
    default:
      return 'CLOSED';
  }
}

function mapBBCheckState(state: string): CheckState {
  switch (state.toUpperCase()) {
    case 'SUCCESSFUL':
      return 'SUCCESS';
    case 'FAILED':
      return 'FAILURE';
    case 'INPROGRESS':
      return 'PENDING';
    case 'STOPPED':
      return 'STOPPED';
    default:
      return 'PENDING';
  }
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
  const ghMatches = text.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/g);
  if (ghMatches) urls.push(...ghMatches);
  const bbMatches = text.match(/https:\/\/bitbucket\.org\/[^/]+\/[^/]+\/pull-requests\/\d+/g);
  if (bbMatches) urls.push(...bbMatches);
  return [...new Set(urls)];
}

export class BitbucketClient {
  private authHeader: string;

  constructor(email: string, token: string) {
    this.authHeader = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
  }

  private async fetchApi<T>(endpoint: string): Promise<T> {
    const url = `${BITBUCKET_API_URL}${endpoint}`;
    const maxAttempts = 3;
    let lastErr: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { Authorization: this.authHeader, Accept: 'application/json' },
        });
        clearTimeout(timer);

        if (response.status >= 500 && response.status < 600 && attempt < maxAttempts) {
          lastErr = new Error(`Bitbucket API ${response.status} ${response.statusText}`);
          await new Promise((r) => setTimeout(r, 500 * attempt));
          continue;
        }

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(`Bitbucket API error ${response.status}: ${response.statusText} - ${body}`);
        }

        return (await response.json()) as T;
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
        const isTransient =
          err instanceof Error &&
          (err.name === 'AbortError' ||
            err.message === 'fetch failed' ||
            err.message === 'terminated');
        if (!isTransient || attempt === maxAttempts) throw err;
        process.stderr.write(
          `    Warning: BB ${endpoint} failed (attempt ${attempt}/${maxAttempts}), retrying...\n`,
        );
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }

    throw new Error(`Bitbucket request ${endpoint} failed after ${maxAttempts} attempts: ${lastErr}`);
  }

  async searchPRs(
    repo: string,
    taskId: string,
  ): Promise<Array<{ id: number; title: string; state: string }>> {
    const data = await this.fetchApi<BBPRResponse>(
      `/repositories/${BITBUCKET_ORG}/${repo}/pullrequests?state=ALL&pagelen=50`,
    );

    const pattern = taskId.toLowerCase();
    return (data.values ?? [])
      .filter(
        (pr) =>
          pr.source.branch.name.toLowerCase().includes(pattern) ||
          pr.title.toLowerCase().includes(pattern),
      )
      .map((pr) => ({
        id: pr.id,
        title: pr.title,
        state: pr.state,
      }));
  }

  async getPRDetails(repo: string, prId: number): Promise<PullRequest> {
    const data = await this.fetchApi<BBPRListItem>(
      `/repositories/${BITBUCKET_ORG}/${repo}/pullrequests/${prId}`,
    );

    // Get approvals from participants
    const approvals: Approval[] = (data.participants ?? [])
      .filter((p) => p.approved)
      .map((p) => ({
        name: p.user.display_name,
        state: 'APPROVED' as const,
      }));

    // Get commit count
    let commitCount = 1;
    try {
      commitCount = await this.getPRCommitCount(repo, prId);
    } catch {
      process.stderr.write(`    Warning: Could not get commit count for BB ${repo} #${prId}\n`);
    }

    // Get changed files
    let files: string[] = [];
    try {
      files = await this.getPRFiles(repo, prId);
    } catch {
      process.stderr.write(`    Warning: Could not get files for BB ${repo} #${prId}\n`);
    }

    // Get build statuses
    let checks: CheckStatus[] = [];
    try {
      checks = await this.getPRBuildStatuses(repo, prId);
    } catch {
      // No statuses available
    }

    const linkedPRUrls = extractLinkedPRUrls(data.description ?? '');

    return {
      platform: 'bitbucket',
      repo,
      repoShortName: REPO_SHORT_NAMES[repo] ?? repo,
      number: prId,
      title: data.title,
      url: data.links.html.href,
      author: data.author.display_name,
      state: mapBBState(data.state),
      approvals,
      commitCount,
      checks,
      files,
      specialFiles: detectSpecialFiles(files),
      description: data.description ?? '',
      linkedPRUrls,
      isLinked: false,
    };
  }

  async getPRCommitCount(repo: string, prId: number): Promise<number> {
    const data = await this.fetchApi<{ values: unknown[] }>(
      `/repositories/${BITBUCKET_ORG}/${repo}/pullrequests/${prId}/commits?pagelen=100`,
    );
    return (data.values ?? []).length;
  }

  async getPRFiles(repo: string, prId: number): Promise<string[]> {
    const data = await this.fetchApi<{
      values: Array<{
        new?: { path: string };
        old?: { path: string };
      }>;
    }>(`/repositories/${BITBUCKET_ORG}/${repo}/pullrequests/${prId}/diffstat?pagelen=100`);

    return (data.values ?? [])
      .map((v) => v.new?.path ?? v.old?.path ?? '')
      .filter((p) => p !== '');
  }

  async getPRBuildStatuses(repo: string, prId: number): Promise<CheckStatus[]> {
    const data = await this.fetchApi<{
      values: Array<{ state: string; name: string }>;
    }>(`/repositories/${BITBUCKET_ORG}/${repo}/pullrequests/${prId}/statuses`);

    return (data.values ?? []).map((v) => ({
      name: v.name,
      state: mapBBCheckState(v.state),
    }));
  }
}
