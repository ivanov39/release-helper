import { PullRequest, SearchError } from '../types.js';
import { GitHubClient } from '../github/client.js';
import { GITHUB_REPOS } from '../config.js';

/** Parsed linked PR reference from description/comments */
interface LinkedPRRef {
  platform: 'github';
  owner: string;
  repo: string;
  number: number;
  url: string;
}

/** Extract linked GitHub PR URLs from text */
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

  return refs;
}

/** Find all PRs for a list of task IDs across GitHub repos */
export async function findPRsForTasks(
  github: GitHubClient,
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

    // Search GitHub repos (sequential — gh CLI is fast)
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
          linkedPr = await github.getPRDetails(`${ref.owner}/${ref.repo}`, ref.number);
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
