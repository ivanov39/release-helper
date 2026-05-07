import { PullRequest, SearchError } from '../types.js';
import { GitHubClient } from '../github/client.js';
import { BitbucketClient } from '../bitbucket/client.js';
import { GITHUB_REPOS, BITBUCKET_REPOS } from '../config.js';

/** Max concurrent Bitbucket API requests */
const BB_CONCURRENCY = 5;

/** Parsed linked PR reference from description/comments */
interface LinkedPRRef {
  platform: 'github' | 'bitbucket';
  owner: string;
  repo: string;
  number: number;
  url: string;
}

/** Extract linked PR URLs from text */
function extractLinkedPRRefs(text: string): LinkedPRRef[] {
  const refs: LinkedPRRef[] = [];

  // GitHub: https://github.com/{owner}/{repo}/pull/{number}
  const ghRegex = /https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = ghRegex.exec(text)) !== null) {
    refs.push({
      platform: 'github',
      owner: match[1],
      repo: match[2],
      number: parseInt(match[3], 10),
      url: match[0],
    });
  }

  // Bitbucket: https://bitbucket.org/{owner}/{repo}/pull-requests/{number}
  const bbRegex = /https:\/\/bitbucket\.org\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)/g;
  while ((match = bbRegex.exec(text)) !== null) {
    refs.push({
      platform: 'bitbucket',
      owner: match[1],
      repo: match[2],
      number: parseInt(match[3], 10),
      url: match[0],
    });
  }

  return refs;
}

/** Run async tasks with limited concurrency */
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < tasks.length) {
      const currentIndex = index++;
      results[currentIndex] = await tasks[currentIndex]();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/** Search a single Bitbucket repo for a task ID, return found PR matches and any error */
async function searchBBRepo(
  bitbucket: BitbucketClient,
  repo: string,
  taskId: string,
): Promise<{
  repo: string;
  matches: Array<{ repo: string; id: number; title: string; state: string }>;
  error: string | null;
}> {
  try {
    const matches = await bitbucket.searchPRs(repo, taskId);
    return { repo, matches: matches.map((m) => ({ repo, ...m })), error: null };
  } catch (err) {
    return {
      repo,
      matches: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Find all PRs for a list of task IDs across GitHub and Bitbucket */
export async function findPRsForTasks(
  github: GitHubClient,
  bitbucket: BitbucketClient,
  taskIds: string[],
): Promise<Map<string, { primary: PullRequest[]; linked: PullRequest[]; searchErrors: SearchError[] }>> {
  const results = new Map<
    string,
    { primary: PullRequest[]; linked: PullRequest[]; searchErrors: SearchError[] }
  >();
  const prCache = new Map<string, PullRequest>();

  for (const taskId of taskIds) {
    process.stderr.write(`  Searching PRs for ${taskId}...\n`);
    const primaryPrs: PullRequest[] = [];
    const linkedPrs: PullRequest[] = [];
    const searchErrors: SearchError[] = [];

    // Search GitHub repos (sequential — only 2 repos, gh CLI is fast)
    for (const repo of GITHUB_REPOS) {
      try {
        const matches = await github.searchPRs(repo, taskId);
        for (const match of matches) {
          const cacheKey = `gh:${repo}:${match.number}`;
          let pr = prCache.get(cacheKey);
          if (!pr) {
            pr = await github.getPRDetails(repo, match.number);
            prCache.set(cacheKey, pr);
          }
          primaryPrs.push(pr);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        searchErrors.push({ platform: 'github', repo, message });
        process.stderr.write(`    ❌ GitHub fetch failed for ${repo}/${taskId}: ${message}\n`);
      }
    }

    // Search Bitbucket repos — parallel with concurrency limit
    const bbSearchTasks = BITBUCKET_REPOS.map(
      (repo) => () => searchBBRepo(bitbucket, repo, taskId),
    );
    const bbResults = await runWithConcurrency(bbSearchTasks, BB_CONCURRENCY);

    const bbMatches: Array<{ repo: string; id: number; title: string; state: string }> = [];
    for (const r of bbResults) {
      if (r.error) {
        searchErrors.push({ platform: 'bitbucket', repo: r.repo, message: r.error });
        process.stderr.write(
          `    ❌ Bitbucket fetch failed for ${r.repo}/${taskId}: ${r.error}\n`,
        );
      }
      bbMatches.push(...r.matches);
    }

    // Fetch details for matched BB PRs (also parallel)
    const bbDetailTasks = bbMatches.map(
      (match) => async () => {
        const cacheKey = `bb:${match.repo}:${match.id}`;
        let pr = prCache.get(cacheKey);
        if (!pr) {
          try {
            pr = await bitbucket.getPRDetails(match.repo, match.id);
            prCache.set(cacheKey, pr);
          } catch (err) {
            process.stderr.write(
              `    Warning: Could not fetch BB PR ${match.repo}#${match.id}: ${err}\n`,
            );
            return null;
          }
        }
        return pr;
      },
    );
    const bbPrs = (await runWithConcurrency(bbDetailTasks, BB_CONCURRENCY)).filter(
      (pr): pr is PullRequest => pr !== null,
    );
    primaryPrs.push(...bbPrs);

    // Collect linked PR refs from all primary PRs
    const allLinkedRefs: LinkedPRRef[] = [];
    for (const pr of primaryPrs) {
      allLinkedRefs.push(...extractLinkedPRRefs(pr.description));
    }

    // Fetch linked PRs (deduplicated)
    const seenRefKeys = new Set<string>();
    for (const ref of allLinkedRefs) {
      const refKey = `${ref.platform}:${ref.owner}/${ref.repo}:${ref.number}`;
      if (seenRefKeys.has(refKey)) continue;
      seenRefKeys.add(refKey);

      let linkedPr = prCache.get(refKey);
      if (!linkedPr) {
        try {
          if (ref.platform === 'github') {
            linkedPr = await github.getPRDetails(`${ref.owner}/${ref.repo}`, ref.number);
          } else {
            linkedPr = await bitbucket.getPRDetails(ref.repo, ref.number);
          }
          if (linkedPr) {
            linkedPr.isLinked = true;
            prCache.set(refKey, linkedPr);
          }
        } catch (err) {
          process.stderr.write(`    Warning: Could not fetch linked PR ${ref.url}: ${err}\n`);
        }
      }
      if (linkedPr) {
        linkedPrs.push({ ...linkedPr, isLinked: true });
      }
    }

    // Filter out CLOSED/DECLINED PRs if there is a MERGED PR in the same repo
    const hasMergedInRepo = new Set<string>();
    for (const pr of primaryPrs) {
      if (pr.state === 'MERGED') {
        hasMergedInRepo.add(`${pr.platform}:${pr.repo}`);
      }
    }
    const filteredPrimary = primaryPrs.filter((pr) => {
      if (pr.state === 'CLOSED' || pr.state === 'DECLINED') {
        const repoKey = `${pr.platform}:${pr.repo}`;
        if (hasMergedInRepo.has(repoKey)) return false;
      }
      return true;
    });

    // Deduplicate linked PRs
    const seenLinked = new Set<string>();
    const dedupedLinked = linkedPrs.filter((pr) => {
      const key = `${pr.platform}:${pr.repo}:${pr.number}`;
      if (seenLinked.has(key)) return false;
      const isPrimary = filteredPrimary.some(
        (p) => p.platform === pr.platform && p.repo === pr.repo && p.number === pr.number,
      );
      if (isPrimary) return false;
      seenLinked.add(key);
      return true;
    });

    results.set(taskId, { primary: filteredPrimary, linked: dedupedLinked, searchErrors });
    const errorSuffix = searchErrors.length > 0 ? ` (${searchErrors.length} repo error(s))` : '';
    process.stderr.write(
      `    Found ${filteredPrimary.length} primary + ${dedupedLinked.length} linked PRs${errorSuffix}\n`,
    );
  }

  return results;
}
