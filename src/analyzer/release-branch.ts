import { TaskReport, PullRequest, ReleaseBranchCheck } from '../types.js';
import { GitHubClient } from '../github/client.js';
import { releaseBranchCandidates } from '../config.js';

/** Branch a repository's PRs are checked against */
interface ResolvedBranch {
  branch: string;
  /** false when no release branch exists in the repo and its default branch was used */
  isReleaseBranch: boolean;
}

/**
 * Resolve the branch to check a repository against: the release branch when the
 * repo has one, otherwise the repo's default branch. Satellite repos (es-pass,
 * the api-clients) carry no release branches and are deployed from master, so
 * comparing their PRs against master is the meaningful check there.
 */
function resolveBranch(
  github: GitHubClient,
  repo: string,
  candidates: string[],
  cache: Map<string, ResolvedBranch>,
): ResolvedBranch {
  const cached = cache.get(repo);
  if (cached) return cached;

  const found = github.findExistingBranch(repo, candidates);
  const resolved: ResolvedBranch = found
    ? { branch: found, isReleaseBranch: true }
    : { branch: github.getDefaultBranch(repo), isReleaseBranch: false };

  cache.set(repo, resolved);
  process.stderr.write(
    `  ${repo} → ${resolved.branch}${resolved.isReleaseBranch ? '' : ' (no release branch, using default)'}\n`,
  );
  return resolved;
}

/** Check one PR against its repository's release branch */
function checkPR(github: GitHubClient, pr: PullRequest, resolved: ResolvedBranch): ReleaseBranchCheck {
  const { branch, isReleaseBranch } = resolved;
  const suffix = isReleaseBranch
    ? ''
    : ` (релизной ветки в репозитории нет, проверено по \`${branch}\`)`;

  if (pr.platform !== 'github') {
    return {
      branch,
      isReleaseBranch,
      state: 'UNKNOWN',
      reason: 'проверка вхождения доступна только для GitHub — проверить вручную',
    };
  }

  if (pr.state !== 'MERGED') {
    return {
      branch,
      isReleaseBranch,
      state: 'NOT_MERGED',
      reason: `PR ещё не смержен (${pr.state})`,
    };
  }

  if (!pr.mergeCommitOid) {
    return {
      branch,
      isReleaseBranch,
      state: 'UNKNOWN',
      reason: `не удалось получить merge-коммит PR — вхождение в \`${branch}\` не проверено`,
    };
  }

  const contained = github.isCommitInBranch(pr.repo, branch, pr.mergeCommitOid);
  if (contained === 'yes') {
    return {
      branch,
      isReleaseBranch,
      state: 'IN_RELEASE',
      reason: `коммит есть в \`${branch}\`${suffix}`,
    };
  }
  if (contained === 'no') {
    return {
      branch,
      isReleaseBranch,
      state: 'NOT_IN_RELEASE',
      reason: `смержен в \`${pr.targetBranch}\`, но коммита нет в \`${branch}\`${suffix}`,
    };
  }
  return {
    branch,
    isReleaseBranch,
    state: 'UNKNOWN',
    reason: `GitHub не ответил на сравнение с \`${branch}\` — проверить вручную`,
  };
}

/**
 * Verify that every release task's changes actually landed in the release branch.
 *
 * Only primary PRs of the release's own tasks are checked. PRs of missing linked
 * tasks and PRs referenced from descriptions belong to other product releases
 * (an ESN release routinely links es-application PRs targeting release/6.x), so
 * judging them against this release's branch would produce false alarms.
 *
 * Verdicts are written onto the PR objects themselves. Those objects are shared
 * through the pr-finder cache, so a PR reachable from several tasks is checked once.
 */
export async function checkReleaseBranch(
  github: GitHubClient,
  taskReports: TaskReport[],
  version: string,
  override?: string,
): Promise<void> {
  const candidates = override ? [override] : releaseBranchCandidates(version);
  const branchCache = new Map<string, ResolvedBranch>();

  for (const report of taskReports) {
    for (const pr of report.prs) {
      if (pr.releaseBranch) continue; // shared PR object, already checked
      const resolved = resolveBranch(github, pr.repo, candidates, branchCache);
      pr.releaseBranch = checkPR(github, pr, resolved);
      const icon =
        pr.releaseBranch.state === 'IN_RELEASE'
          ? '✅'
          : pr.releaseBranch.state === 'UNKNOWN'
            ? '❓'
            : '🚨';
      process.stderr.write(
        `  ${icon} ${report.task.id} · ${pr.repoShortName} #${pr.number} — ${pr.releaseBranch.reason}\n`,
      );
    }
  }
}
