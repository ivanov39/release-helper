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

export interface PullRequest {
  platform: Platform;
  repo: string;
  repoShortName: string;
  number: number;
  title: string;
  url: string;
  author: string;
  state: PRState;
  approvals: Approval[];
  commitCount: number;
  checks: CheckStatus[];
  files: string[];
  specialFiles: SpecialFiles;
  description: string;
  linkedPRUrls: string[];
  isLinked: boolean;
}

export interface TaskReport {
  task: TaskIssue;
  prs: PullRequest[];
  linkedPrs: PullRequest[];
}

export interface Warning {
  type: 'missing_linked' | 'pr_issue' | 'composer' | 'params';
  taskId: string;
  message: string;
}

export interface ReleaseReport {
  release: ReleaseIssue;
  taskReports: TaskReport[];
  missingLinkedTasks: LinkedTask[];
  missingLinkedTaskReports: TaskReport[];
  warnings: Warning[];
  checkedAt: string;
}
