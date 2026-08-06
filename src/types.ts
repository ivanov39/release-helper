export interface ReleaseIssue {
  id: string;
  summary: string;
  url: string;
  description: string;
  linkedIssueCounts: Record<string, number>;
}

export interface TaskIssue {
  id: string;
  summary: string;
  type: string;
  /** YouTrack `Status` field: "In Work", "Ready to release", "Canceled", ... */
  state: string;
  linkedIssueCounts: Record<string, number>;
}

export type LinkType =
  | 'subtask of'
  | 'parent for'
  | 'depends on'
  | 'is required for'
  | 'relates to'
  | 'duplicates'
  | 'is duplicated by';

export interface LinkedTask {
  parentTaskId: string;
  linkedTaskId: string;
  linkedTaskSummary: string;
  linkedTaskState: string;
  linkType: LinkType;
}

export type Platform = 'github' | 'bitbucket';

export type PRState = 'MERGED' | 'OPEN' | 'CLOSED' | 'DECLINED';

export interface Approval {
  name: string;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED';
}

export type CheckState = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'CANCELLED' | 'STOPPED';

export interface CheckStatus {
  name: string;
  state: CheckState;
}

export interface SpecialFiles {
  composer: boolean;
  params: boolean;
  composerFiles: string[];
  paramsFiles: string[];
}

/** GitHub `mergeable` field — whether the PR has conflicts */
export type MergeableState = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';

/** GitHub `mergeStateStatus` field — overall merge readiness */
export type MergeStateStatus =
  | 'CLEAN'
  | 'BLOCKED'
  | 'BEHIND'
  | 'DIRTY'
  | 'UNSTABLE'
  | 'DRAFT'
  | 'HAS_HOOKS'
  | 'UNKNOWN';

/** Whether a PR is allowed to be merged, with human-readable reasons if not */
export interface MergeStatus {
  mergeable: MergeableState;
  mergeStateStatus: MergeStateStatus;
  /** Derived: true only when GitHub reports the PR is cleanly mergeable */
  canMerge: boolean;
  /** Reasons the PR cannot be merged (empty when canMerge is true) */
  reasons: string[];
  /** Unresolved review threads (from GraphQL); undefined when not queried */
  unresolvedThreads?: number;
}

/** Whether a PR's changes actually landed in the release branch */
export type ReleaseBranchState = 'IN_RELEASE' | 'NOT_IN_RELEASE' | 'NOT_MERGED' | 'UNKNOWN';

/** Result of checking one PR against the release branch of its repository */
export interface ReleaseBranchCheck {
  /** Branch the PR was compared against */
  branch: string;
  /** false when the repo has no release/<version> branch and its default branch was used */
  isReleaseBranch: boolean;
  state: ReleaseBranchState;
  /** Human-readable explanation rendered in the report */
  reason: string;
}

export interface PullRequest {
  platform: Platform;
  repo: string;
  repoShortName: string;
  number: number;
  title: string;
  url: string;
  author: string;
  /** Target/base branch the PR merges into (GitHub baseRefName / Bitbucket destination) */
  targetBranch: string;
  state: PRState;
  approvals: Approval[];
  commitCount: number;
  checks: CheckStatus[];
  files: string[];
  specialFiles: SpecialFiles;
  description: string;
  linkedPRUrls: string[];
  isLinked: boolean;
  /** GitHub merge readiness; undefined for non-OPEN PRs and Bitbucket (not queried) */
  mergeStatus?: MergeStatus;
  /** Commit the PR landed on its target branch; undefined until the PR is merged */
  mergeCommitOid?: string;
  /** Release-branch containment; undefined when the PR was not checked */
  releaseBranch?: ReleaseBranchCheck;
}

export interface SearchError {
  platform: Platform;
  repo: string;
  message: string;
}

export interface TaskReport {
  task: TaskIssue;
  prs: PullRequest[];
  linkedPrs: PullRequest[];
  searchErrors?: SearchError[];
}

export interface Warning {
  type:
    | 'missing_linked'
    | 'pr_issue'
    | 'composer'
    | 'params'
    | 'search_failed'
    | 'not_in_release_branch';
  taskId: string;
  message: string;
}

/** The release branch the report was checked against */
export interface ReleaseBranchInfo {
  /** Version parsed from the release summary, e.g. "3.161.0" */
  version: string;
  /** Canonical branch name, e.g. "release/3.161.0" */
  branch: string;
  source: 'summary' | 'flag';
}

export interface ReleaseReport {
  release: ReleaseIssue;
  taskReports: TaskReport[];
  missingLinkedTasks: LinkedTask[];
  missingLinkedTaskReports: TaskReport[];
  warnings: Warning[];
  checkedAt: string;
  /** undefined when the release branch could not be determined and the check was skipped */
  releaseBranchInfo?: ReleaseBranchInfo;
}

export interface ReportOptions {
  short?: boolean;   // hide Task Details section
  overview?: boolean; // show only header + PR Overview
}
