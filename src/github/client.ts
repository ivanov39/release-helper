import { execFileSync } from 'child_process';
import {
  PullRequest,
  Approval,
  CheckStatus,
  CheckState,
  PRState,
  SpecialFiles,
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

function runGH(args: string[]): string | null {
  try {
    return execFileSync('gh', args, {
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    process.stderr.write(`    Warning: gh ${args.slice(0, 3).join(' ')} failed: ${err}\n`);
    return null;
  }
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

export class GitHubClient {
  async searchPRs(
    repo: string,
    taskId: string,
  ): Promise<Array<{ number: number; title: string; branch: string; url: string; state: string }>> {
    const output = runGH([
      'pr',
      'list',
      '-R',
      repo,
      '--state',
      'all',
      '--limit',
      '100',
      '--json',
      'number,title,headRefName,url,state',
    ]);

    if (!output) return [];

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

    if (!output) {
      throw new Error(`Could not fetch PR #${prNumber} from ${repo}`);
    }

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

    return {
      platform: 'github',
      repo,
      repoShortName,
      number: data.number,
      title: data.title,
      url: data.url,
      author: data.author.login,
      state: mapGHState(data.state),
      approvals,
      commitCount: (data.commits ?? []).length,
      checks,
      files,
      specialFiles: detectSpecialFiles(files),
      description: data.body ?? '',
      linkedPRUrls: [...new Set(linkedPRUrls)],
      isLinked: false,
    };
  }

  async getCollaborators(repo: string): Promise<string[]> {
    const output = runGH([
      'api',
      `repos/${repo}/collaborators`,
      '--jq',
      '[.[] | select(.permissions.push == true) | .login]',
    ]);

    if (!output) return [];

    try {
      return JSON.parse(output);
    } catch {
      return [];
    }
  }
}
