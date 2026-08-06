import {
  ReleaseReport,
  TaskReport,
  PullRequest,
  PRState,
  CheckStatus,
  Approval,
  LinkedTask,
  LinkType,
  Warning,
  ReportOptions,
  ReleaseBranchInfo,
} from '../types.js';
import { YOUTRACK_BASE_URL, isCancelledStatus } from '../config.js';

/**
 * YouTrack status per task id. Cancelled tasks are struck through wherever the
 * report mentions them, so a reader never mistakes a dropped task for one that
 * still needs work.
 */
type StatusMap = Map<string, string>;

function issueLink(id: string): string {
  return `[${id}](${YOUTRACK_BASE_URL}/issue/${id})`;
}

/** The task's status when it is cancelled, undefined otherwise */
function cancelledStatus(id: string, statuses: StatusMap): string | undefined {
  const status = statuses.get(id);
  return status && isCancelledStatus(status) ? status : undefined;
}

/** Task reference: struck through and labelled with its status when cancelled */
function taskRef(id: string, statuses: StatusMap): string {
  const cancelled = cancelledStatus(id, statuses);
  return cancelled ? `~~${issueLink(id)}~~ (${cancelled})` : issueLink(id);
}

/**
 * Section heading for one task — id and summary struck through together when
 * cancelled. The status itself goes into the trailing note, so a heading that
 * already carries link info does not end up with two bracketed groups.
 */
function taskHeading(id: string, summary: string, statuses: StatusMap): string {
  const heading = `${issueLink(id)}: ${summary}`;
  return cancelledStatus(id, statuses) ? `~~${heading}~~` : heading;
}

/** Trailing `(...)` note after a task heading; empty when there is nothing to say */
function headingNote(parts: Array<string | undefined>): string {
  const present = parts.filter((p): p is string => Boolean(p));
  return present.length > 0 ? ` (${present.join(' · ')})` : '';
}

/**
 * Linkify task ids mentioned inside warning text. Cancelled tasks are struck
 * through but carry no status label — mid-sentence it would only add noise.
 */
function linkifyText(text: string, statuses: StatusMap): string {
  return text.replace(/\b(ESN?-\d+)\b/g, (_, id: string) =>
    cancelledStatus(id, statuses) ? `~~${issueLink(id)}~~` : issueLink(id),
  );
}

/**
 * Statuses of every task the report can mention. Tasks whose own report could
 * not be built fall back to the status captured during dependency analysis.
 */
function buildStatusMap(data: ReleaseReport): StatusMap {
  const statuses: StatusMap = new Map();
  for (const report of [...data.taskReports, ...data.missingLinkedTaskReports]) {
    if (report.task.state) statuses.set(report.task.id, report.task.state);
  }
  for (const lt of data.missingLinkedTasks) {
    if (lt.linkedTaskState && !statuses.has(lt.linkedTaskId)) {
      statuses.set(lt.linkedTaskId, lt.linkedTaskState);
    }
  }
  return statuses;
}

function stateIcon(state: PRState): string {
  switch (state) {
    case 'MERGED':
      return '✅ MERGED';
    case 'OPEN':
      return '⚠️ OPEN';
    case 'CLOSED':
      return '❌ CLOSED';
    case 'DECLINED':
      return '❌ DECLINED';
    default:
      return '❌ ' + state;
  }
}

function approvalText(approvals: Approval[]): string {
  const approved = approvals.filter((a) => a.state === 'APPROVED');
  if (approved.length === 0) return '❌ 0';
  const names = approved.map((a) => a.name).join('<br>');
  return `✅ ${approved.length}<br>${names}`;
}

function commitText(count: number): string {
  if (count === 1) return '✅ 1';
  if (count === 0) return '⚠️ 0';
  return `⚠️ ${count}`;
}

function checksText(checks: CheckStatus[]): string {
  if (checks.length === 0) return '-';
  const hasFailure = checks.some((c) => c.state === 'FAILURE');
  const hasPending = checks.some((c) => c.state === 'PENDING');
  const hasCancelled = checks.some((c) => c.state === 'CANCELLED');
  const allSuccessOrCancelled = checks.every(
    (c) => c.state === 'SUCCESS' || c.state === 'CANCELLED',
  );

  if (hasFailure) return '❌';
  if (hasPending) return '⏳';
  if (hasCancelled && !allSuccessOrCancelled) return '⚠️';
  if (hasCancelled) return '⚠️';
  return '✅';
}

function checksDetailText(checks: CheckStatus[]): string {
  if (checks.length === 0) return '- (no checks)';
  const hasFailure = checks.some((c) => c.state === 'FAILURE');
  const hasPending = checks.some((c) => c.state === 'PENDING');

  const names = checks
    .filter((c) => c.name && c.name.trim() !== '')
    .map((c) => {
      if (c.state === 'FAILURE') return `${c.name} FAILED`;
      if (c.state === 'CANCELLED') return `${c.name} CANCELLED`;
      if (c.state === 'PENDING') return `${c.name} PENDING`;
      return c.name;
    });

  const icon = hasFailure ? '❌' : hasPending ? '⏳' : '✅';
  return `${icon} ${names.join(', ')}`;
}

function platformTag(pr: PullRequest): string {
  return pr.platform === 'github' ? 'GH' : 'BB';
}

function repoDisplay(pr: PullRequest): string {
  return `${pr.repoShortName} (${platformTag(pr)})`;
}

function prLink(pr: PullRequest): string {
  return `[#${pr.number}](${pr.url})`;
}

/** Task-column cell: task reference plus the PR's target branch on a new line */
function taskCell(taskRef: string, pr: PullRequest): string {
  return pr.targetBranch ? `${taskRef}<br>→ \`${pr.targetBranch}\`` : taskRef;
}

function linkPrefix(linkType: LinkType): string {
  switch (linkType) {
    case 'subtask of':
      return '🔗 subtask';
    case 'parent for':
      return '🔗 parent';
    case 'depends on':
    case 'is required for':
      return '🔗 dep';
    case 'relates to':
      return '🔗 related';
    case 'duplicates':
    case 'is duplicated by':
      return '🔗 dup';
    default:
      return '🔗';
  }
}

function truncateDescription(text: string, maxLen: number = 200): string {
  if (!text) return '';
  // Remove markdown links, images
  let clean = text.replace(/!\[.*?\]\(.*?\)/g, '').replace(/\[([^\]]*)\]\(.*?\)/g, '$1');
  // Remove HTML tags
  clean = clean.replace(/<[^>]+>/g, '');
  // Collapse whitespace
  clean = clean.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen) + '...';
}

function composerCell(pr: PullRequest): string {
  return pr.specialFiles.composer ? '⚠️' : '-';
}

function paramsCell(pr: PullRequest): string {
  return pr.specialFiles.params ? '⚠️' : '-';
}

function canMergeCell(pr: PullRequest): string {
  const ms = pr.mergeStatus;
  if (!ms) return '-';
  if (ms.canMerge) return '✅';
  if (ms.mergeStateStatus === 'UNKNOWN') return '❓';
  return '❌';
}

function inReleaseCell(pr: PullRequest): string {
  const rb = pr.releaseBranch;
  if (!rb) return '-';
  if (rb.state === 'IN_RELEASE') return '✅';
  if (rb.state === 'UNKNOWN') return '❓';
  return '🚨';
}

/** One release task that did not make it into the release branch */
interface NotInRelease {
  taskId: string;
  /** undefined when the task has no PR at all */
  pr?: PullRequest;
  reason: string;
  unverified: boolean;
}

/**
 * Collect release tasks whose changes are not (provably) in the release branch.
 * Only the release's own tasks are considered — PRs of missing linked tasks belong
 * to other product releases and are reported as a separate class of problem.
 */
function collectNotInRelease(taskReports: TaskReport[], releaseBranch: string): NotInRelease[] {
  const out: NotInRelease[] = [];

  for (const report of taskReports) {
    if (report.prs.length === 0) {
      if ((report.searchErrors?.length ?? 0) > 0) {
        out.push({
          taskId: report.task.id,
          reason: 'поиск PR не удался — вхождение в релиз не проверено',
          unverified: true,
        });
      } else {
        out.push({
          taskId: report.task.id,
          reason: `PR не найден — задача не может быть в \`${releaseBranch}\``,
          unverified: false,
        });
      }
      continue;
    }

    for (const pr of report.prs) {
      const rb = pr.releaseBranch;
      if (!rb || rb.state === 'IN_RELEASE') continue;
      out.push({
        taskId: report.task.id,
        pr,
        reason: rb.reason,
        unverified: rb.state === 'UNKNOWN',
      });
    }
  }

  return out;
}

/**
 * Repositories checked against their default branch because no release branch
 * exists there. Expected for satellite repos deployed from master, but also the
 * signal that a release branch was never cut (or was already deleted) — in which
 * case a green verdict says much less than it appears to.
 */
function collectFallbackRepos(taskReports: TaskReport[]): Array<{ repo: string; branch: string }> {
  const seen = new Map<string, string>();
  for (const report of taskReports) {
    for (const pr of report.prs) {
      const rb = pr.releaseBranch;
      if (rb && !rb.isReleaseBranch && !seen.has(pr.repoShortName)) {
        seen.set(pr.repoShortName, rb.branch);
      }
    }
  }
  return [...seen].map(([repo, branch]) => ({ repo, branch }));
}

/** Number of release tasks fully contained in the release branch */
function countTasksInRelease(taskReports: TaskReport[]): number {
  return taskReports.filter(
    (r) => r.prs.length > 0 && r.prs.every((pr) => pr.releaseBranch?.state === 'IN_RELEASE'),
  ).length;
}

/** One entry of the banner / section list: task, its PR when there is one, and why */
function notInReleaseLine(item: NotInRelease, statuses: StatusMap): string {
  const where = item.pr ? ` · ${repoDisplay(item.pr)} ${prLink(item.pr)}` : '';
  return `- **${taskRef(item.taskId, statuses)}**${where} — ${item.reason}`;
}

/**
 * The verdict block under the report header: does everything in this release
 * actually sit in the release branch? Written as a blockquote so it stands out
 * from the tables that follow.
 */
function addReleaseBanner(
  add: (line?: string) => void,
  info: ReleaseBranchInfo | undefined,
  taskReports: TaskReport[],
  notInRelease: NotInRelease[],
  statuses: StatusMap,
): void {
  if (!info) {
    add('> ## ❓ Вхождение задач в релизную ветку не проверялось');
    add('>');
    add('> Не удалось определить версию релиза из summary задачи.');
    add('> Укажите ветку вручную: `--branch=release/X.Y.Z`');
    add();
    return;
  }

  const total = taskReports.length;
  const fallbackRepos = collectFallbackRepos(taskReports);
  const checkedRepos = new Set(
    taskReports.flatMap((r) => r.prs.filter((pr) => pr.releaseBranch).map((pr) => pr.repoShortName)),
  );
  // No repo carries the release branch: it was never cut, or already deleted.
  const branchMissingEverywhere = checkedRepos.size > 0 && fallbackRepos.length === checkedRepos.size;

  const fallbackNote = (): void => {
    if (fallbackRepos.length === 0) return;
    add('>');
    add(
      branchMissingEverywhere
        ? `> ⚠️ Ветка \`${info.branch}\` не найдена ни в одном репозитории — проверка выполнена по веткам по умолчанию. Убедитесь, что релизная ветка отрезана.`
        : `> ⚠️ Релизной ветки нет в: ${fallbackRepos.map((f) => `${f.repo} (проверено по \`${f.branch}\`)`).join(', ')}`,
    );
  };

  if (notInRelease.length === 0) {
    add(
      branchMissingEverywhere
        ? `> ## ⚠️ Все задачи (${total}) на месте, но ветка \`${info.branch}\` не найдена`
        : `> ## ✅ Все задачи (${total}) в релизной ветке \`${info.branch}\``,
    );
    fallbackNote();
    add();
    return;
  }

  const blocked = notInRelease.filter((n) => !n.unverified);
  const unverified = notInRelease.filter((n) => n.unverified);
  const affectedTasks = new Set(notInRelease.map((n) => n.taskId)).size;

  add(`> ## 🚨 НЕ В РЕЛИЗНОЙ ВЕТКЕ: ${affectedTasks} из ${total} задач`);
  add('>');
  add(`> Релизная ветка: \`${info.branch}\``);
  fallbackNote();

  if (blocked.length > 0) {
    add('>');
    for (const item of blocked) {
      add(`> ${notInReleaseLine(item, statuses)}`);
    }
  }

  if (unverified.length > 0) {
    add('>');
    add('> **Не удалось проверить:**');
    for (const item of unverified) {
      add(`> ${notInReleaseLine(item, statuses)}`);
    }
  }

  add();
}

/** Collect all PRs (primary + linked) that GitHub reports cannot be merged */
function collectUnmergeable(
  taskReports: TaskReport[],
  missingReports: TaskReport[],
): Array<{ taskId: string; pr: PullRequest; reasons: string[] }> {
  const out: Array<{ taskId: string; pr: PullRequest; reasons: string[] }> = [];
  const seen = new Set<string>();

  for (const report of [...taskReports, ...missingReports]) {
    for (const pr of [...report.prs, ...report.linkedPrs]) {
      if (!pr.mergeStatus || pr.mergeStatus.canMerge) continue;
      const key = `${pr.platform}:${pr.repo}:${pr.number}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ taskId: report.task.id, pr, reasons: pr.mergeStatus.reasons });
    }
  }

  return out;
}

/** Detect deploy notes from PR description */
function detectDeployNotes(description: string): string[] {
  if (!description) return [];
  const notes: string[] = [];
  const keywords = [
    'не забыть',
    'depends on',
    'добавить в крон',
    'cron',
    'composer update',
    'migration',
    'параметр',
    'parameters',
  ];
  const lines = description.split('\n');
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (keywords.some((kw) => lower.includes(kw))) {
      const trimmed = line.trim().replace(/^[-*]\s*/, '');
      if (trimmed) notes.push(trimmed);
    }
  }
  return notes;
}

/**
 * Check if a task is "ready" (all checks pass).
 *
 * A PR that is merged but whose commit is not in the release branch is not ready —
 * that is exactly the case this report exists to catch. UNKNOWN blocks readiness
 * too: an unverified release must not look green. An absent check (`undefined`)
 * means the check never ran (no release branch could be determined) and does not
 * block, so behaviour is unchanged when the release summary carries no version.
 */
function isTaskReady(report: TaskReport): boolean {
  if (report.prs.length === 0) return false;
  for (const pr of report.prs) {
    if (pr.state !== 'MERGED') return false;
    if (pr.approvals.filter((a) => a.state === 'APPROVED').length === 0) return false;
    if (pr.releaseBranch && pr.releaseBranch.state !== 'IN_RELEASE') return false;
  }
  return true;
}

/** Count summary statuses */
function countStatuses(
  taskReports: TaskReport[],
  missingCount: number,
): { ready: number; issues: number; noPR: number; searchFailed: number; missingLinked: number } {
  let ready = 0;
  let issues = 0;
  let noPR = 0;
  let searchFailed = 0;

  for (const report of taskReports) {
    if ((report.searchErrors?.length ?? 0) > 0) {
      searchFailed++;
    }
    if (report.prs.length === 0 && (report.searchErrors?.length ?? 0) === 0) {
      noPR++;
    } else if (report.prs.length > 0 && isTaskReady(report)) {
      ready++;
    } else if (report.prs.length > 0) {
      issues++;
    }
  }

  return { ready, issues, noPR, searchFailed, missingLinked: missingCount };
}

/** Suggest deploy order based on repo types */
function suggestDeployOrder(
  taskReports: TaskReport[],
  missingReports: TaskReport[],
  statuses: StatusMap,
): string[] {
  const allReports = [...taskReports, ...missingReports];
  const repoOrder: Record<string, number> = {
    'es-migrations': 1,
    'es-pass': 2,
    'es-auth': 3,
    'es-admin-api-client': 4,
    'es-pass-api-client': 4,
    'epd-api-client': 4,
    'epc-api-client': 4,
    'ef-api-client': 4,
    'em-api-client': 4,
    'es-application': 5,
    'es-next': 6,
  };

  // Collect unique repo PRs
  const repoSteps = new Map<string, { order: number; prs: string[] }>();
  for (const report of allReports) {
    for (const pr of [...report.prs, ...report.linkedPrs]) {
      const repo = pr.repoShortName;
      const order = repoOrder[repo] ?? 4;
      if (!repoSteps.has(repo)) {
        repoSteps.set(repo, { order, prs: [] });
      }
      const label = `${pr.repoShortName} #${pr.number} (${taskRef(report.task.id, statuses)})`;
      const step = repoSteps.get(repo)!;
      if (!step.prs.includes(label)) {
        step.prs.push(label);
      }
    }
  }

  // Sort by order
  const sorted = [...repoSteps.entries()].sort((a, b) => a[1].order - b[1].order);
  const steps: string[] = [];
  let stepNum = 1;
  for (const [repo, data] of sorted) {
    steps.push(`${stepNum}. **${repo}** — ${data.prs.join(', ')}`);
    stepNum++;
  }

  return steps;
}

export function generateReport(data: ReleaseReport, options: ReportOptions = {}): string {
  const {
    release,
    taskReports,
    missingLinkedTasks,
    missingLinkedTaskReports,
    warnings,
    checkedAt,
    releaseBranchInfo,
  } = data;

  const isShort = options.short ?? false;
  const isOverview = options.overview ?? false;

  const lines: string[] = [];
  const add = (line: string = '') => lines.push(line);

  // Build linked task lookup for display
  const linkedTaskMap = new Map<string, LinkedTask>();
  for (const lt of missingLinkedTasks) {
    linkedTaskMap.set(lt.linkedTaskId, lt);
  }

  const statuses = buildStatusMap(data);

  // --- Header ---
  add(`# Release Check Report: ${issueLink(release.id)}`);
  add();
  add(`**Release:** ${release.summary}`);
  add(`**URL:** ${release.url}`);
  add(`**Checked at:** ${checkedAt}`);
  if (releaseBranchInfo) {
    const src = releaseBranchInfo.source === 'flag' ? ' (задана флагом `--branch`)' : '';
    add(`**Release branch:** \`${releaseBranchInfo.branch}\`${src}`);
  } else {
    add('**Release branch:** не определена — проверка вхождения в релиз не выполнялась');
  }
  const missingUniqueCount = new Set(missingLinkedTasks.map((t) => t.linkedTaskId)).size;
  add(`**Total tasks:** ${taskReports.length} (+ ${missingUniqueCount} missing linked tasks detected)`);
  add();

  // --- Release-branch banner ---
  // Rendered in every mode, --short included: the YouTrack comment is published
  // with { short: true } and this is the verdict the release manager must see.
  const notInRelease = releaseBranchInfo
    ? collectNotInRelease(taskReports, releaseBranchInfo.branch)
    : [];
  addReleaseBanner(add, releaseBranchInfo, taskReports, notInRelease, statuses);

  add('---');
  add();

  // --- Summary ---
  if (!isOverview) {
    const counts = countStatuses(taskReports, missingUniqueCount);
    add('## Summary');
    add();
    add('| Status | Count |');
    add('|--------|-------|');
    add(`| ✅ Ready | ${counts.ready} |`);
    add(`| ⚠️ Issues | ${counts.issues} |`);
    add(`| ❌ PR not found | ${counts.noPR} |`);
    add(`| 🌐 Search failed | ${counts.searchFailed} |`);
    add(`| 🔗 Missing linked tasks | ${counts.missingLinked} |`);
    if (releaseBranchInfo) {
      add(`| ✅ In release branch | ${countTasksInRelease(taskReports)} |`);
      add(`| 🚨 Not in release branch | ${new Set(notInRelease.map((n) => n.taskId)).size} |`);
    }
    add();
    add('---');
    add();
  }

  // --- PR Overview Table ---
  add('## PR Overview');
  add();
  add('| Task | Repository | PR | Author | State | Approvals | Commits | Checks | Can merge | In release | Composer | Inventory |');
  add('|------|------------|-----|--------|-------|-----------|---------|--------|-----------|------------|----------|--------|');

  for (const report of taskReports) {
    for (const pr of report.prs) {
      add(
        `| ${taskCell(taskRef(report.task.id, statuses), pr)} | ${repoDisplay(pr)} | ${prLink(pr)} | ${pr.author} | ${stateIcon(pr.state)} | ${approvalText(pr.approvals)} | ${commitText(pr.commitCount)} | ${checksText(pr.checks)} | ${canMergeCell(pr)} | ${inReleaseCell(pr)} | ${composerCell(pr)} | ${paramsCell(pr)} |`,
      );
    }
    // Linked PRs from description
    for (const pr of report.linkedPrs) {
      add(
        `| ${taskCell('└─ linked', pr)} | ${repoDisplay(pr)} | ${prLink(pr)} | ${pr.author} | ${stateIcon(pr.state)} | ${approvalText(pr.approvals)} | ${commitText(pr.commitCount)} | ${checksText(pr.checks)} | ${canMergeCell(pr)} | ${inReleaseCell(pr)} | ${composerCell(pr)} | ${paramsCell(pr)} |`,
      );
    }
    if (report.prs.length === 0) {
      if ((report.searchErrors?.length ?? 0) > 0) {
        const repos = report.searchErrors!
          .map((e) => `${e.repo} (${e.platform === 'github' ? 'GH' : 'BB'})`)
          .join(', ');
        add(`| ${taskRef(report.task.id, statuses)} | ${repos} | 🌐 PR search failed | - | - | - | - | - | - | - | - | - |`);
      } else {
        add(`| ${taskRef(report.task.id, statuses)} | - | ❌ PR not found | - | - | - | - | - | - | - | - | - |`);
      }
    }
  }

  // Missing linked task PRs
  for (const report of missingLinkedTaskReports) {
    const lt = linkedTaskMap.get(report.task.id);
    const ref = taskRef(report.task.id, statuses);
    const prefix = lt ? `${linkPrefix(lt.linkType)}: ${ref}` : `🔗 ${ref}`;
    for (const pr of report.prs) {
      add(
        `| ${taskCell(prefix, pr)} | ${repoDisplay(pr)} | ${prLink(pr)} | ${pr.author} | ${stateIcon(pr.state)} | ${approvalText(pr.approvals)} | ${commitText(pr.commitCount)} | ${checksText(pr.checks)} | ${canMergeCell(pr)} | ${inReleaseCell(pr)} | ${composerCell(pr)} | ${paramsCell(pr)} |`,
      );
    }
    for (const pr of report.linkedPrs) {
      add(
        `| ${taskCell('└─ linked', pr)} | ${repoDisplay(pr)} | ${prLink(pr)} | ${pr.author} | ${stateIcon(pr.state)} | ${approvalText(pr.approvals)} | ${commitText(pr.commitCount)} | ${checksText(pr.checks)} | ${canMergeCell(pr)} | ${inReleaseCell(pr)} | ${composerCell(pr)} | ${paramsCell(pr)} |`,
      );
    }
    if (report.prs.length === 0) {
      if ((report.searchErrors?.length ?? 0) > 0) {
        const repos = report.searchErrors!
          .map((e) => `${e.repo} (${e.platform === 'github' ? 'GH' : 'BB'})`)
          .join(', ');
        add(`| ${prefix} | ${repos} | 🌐 PR search failed | - | - | - | - | - | - | - | - | - |`);
      }
    }
  }

  add();
  add('**Legend:** BB = Bitbucket, GH = GitHub | Checks: ✅ passed, ❌ failed, ⏳ pending, - none | Can merge: ✅ yes, ❌ no, ❓ GitHub still computing, - n/a (BB or not OPEN) | In release: ✅ коммит в релизной ветке, 🚨 нет, ❓ не удалось проверить, - не проверялось | Composer/Inventory: ⚠️ file changed | 🔗 subtask/dep = missing linked task not in release | ~~зачёркнутая задача~~ = отменена в YouTrack (статус в скобках)');
  add();

  // --- Tasks missing from the release branch (the most critical finding) ---
  if (notInRelease.length > 0 && releaseBranchInfo) {
    add(`### 🚨 Задачи, не попавшие в релизную ветку \`${releaseBranchInfo.branch}\``);
    add();
    for (const item of notInRelease) {
      add(notInReleaseLine(item, statuses));
    }
    add();
  }

  // --- Cannot-merge reasons (right under the overview table) ---
  const unmergeable = collectUnmergeable(taskReports, missingLinkedTaskReports);
  if (unmergeable.length > 0) {
    add('### ⛔ PRs that cannot be merged');
    add();
    for (const u of unmergeable) {
      const reasons = u.reasons.length > 0 ? u.reasons.join('; ') : 'merge blocked (no specific reason reported)';
      add(`- **${taskRef(u.taskId, statuses)}** · ${repoDisplay(u.pr)} ${prLink(u.pr)} — ${reasons}`);
    }
    add();
  }

  add('---');
  add();

  // --- Task Details ---
  if (!isShort && !isOverview) {
    add('## Task Details');
    add();

    for (const report of taskReports) {
      const note = headingNote([cancelledStatus(report.task.id, statuses)]);
      add(`### ${taskHeading(report.task.id, report.task.summary, statuses)}${note}`);
      add();

      if (report.prs.length === 0) {
        if ((report.searchErrors?.length ?? 0) > 0) {
          add('**PR:** 🌐 Search failed (max retries exceeded) — PR may exist but could not be confirmed.');
          add();
          add('| Repository | Platform | Error |');
          add('|------------|----------|-------|');
          for (const err of report.searchErrors!) {
            add(`| ${err.repo} | ${err.platform === 'github' ? 'GH' : 'BB'} | ${err.message} |`);
          }
          add();
        } else {
          add('**PR:** ❌ Not found');
          add();
        }
      }

      for (const pr of report.prs) {
        add(`**PR:** [${platformTag(pr)} #${pr.number}](${pr.url}) in ${pr.repoShortName} - ${pr.state}`);
        add(`**Author:** ${pr.author}`);
        add();
        add('| Check | Status |');
        add('|-------|--------|');
        add(`| Approvals | ${approvalText(pr.approvals)} |`);
        add(`| Commits | ${commitText(pr.commitCount)} commit${pr.commitCount !== 1 ? 's' : ''} |`);
        add(`| CI/Checks | ${checksDetailText(pr.checks)} |`);
        add();

        const desc = truncateDescription(pr.description);
        if (desc) {
          add('**Description:**');
          add(`> ${desc}`);
          add();
        }

        // Linked PRs
        if (report.linkedPrs.length > 0) {
          add('**Linked PRs:**');
          for (const lpr of report.linkedPrs) {
            add(`- [${platformTag(lpr)} #${lpr.number}](${lpr.url}) in ${lpr.repoShortName} - ${lpr.state}`);
          }
          add();
        } else {
          add('**Linked PRs:** None found in description.');
          add();
        }

        // Special files
        add('**Special Files:**');
        if (pr.specialFiles.composer) {
          add(`- **Composer:** ⚠️ Changed: \`${pr.specialFiles.composerFiles.join('`, `')}\``);
        } else {
          add('- **Composer:** ✅ No changes');
        }
        if (pr.specialFiles.params) {
          add(`- **Inventory:** ⚠️ Changed: \`${pr.specialFiles.paramsFiles.join('`, `')}\``);
        } else {
          add('- **Inventory:** ✅ No changes');
        }
        add();

        // Deploy notes
        const deployNotes = detectDeployNotes(pr.description);
        if (deployNotes.length > 0) {
          add('**Deploy notes (from PR body):**');
          for (const note of deployNotes) {
            add(`> - ${note}`);
          }
          add();
        }
      }

      add('---');
      add();
    }
  }

  // --- Missing Linked Tasks Details ---
  if (!isShort && !isOverview && missingLinkedTaskReports.length > 0) {
    add('## Missing Linked Tasks Details');
    add();

    for (const report of missingLinkedTaskReports) {
      const lt = linkedTaskMap.get(report.task.id);
      const note = headingNote([
        cancelledStatus(report.task.id, statuses),
        lt ? `${lt.linkType} ${taskRef(lt.parentTaskId, statuses)}` : undefined,
      ]);
      add(`### 🔗 ${taskHeading(report.task.id, report.task.summary, statuses)}${note}`);
      add();

      for (const pr of report.prs) {
        add(`**PR:** [${platformTag(pr)} #${pr.number}](${pr.url}) in ${pr.repoShortName} - ${pr.state}`);
        add(`**Author:** ${pr.author}`);
        add();
        add('| Check | Status |');
        add('|-------|--------|');
        add(`| Approvals | ${approvalText(pr.approvals)} |`);
        add(`| Commits | ${commitText(pr.commitCount)} commit${pr.commitCount !== 1 ? 's' : ''} |`);
        add(`| CI/Checks | ${checksDetailText(pr.checks)} |`);
        add();

        const desc = truncateDescription(pr.description);
        if (desc) {
          add('**Description:**');
          add(`> ${desc}`);
          add();
        }

        // Linked PRs from this missing task's PRs
        if (report.linkedPrs.length > 0) {
          add('**Linked PRs:**');
          for (const lpr of report.linkedPrs) {
            add(`- [${platformTag(lpr)} #${lpr.number}](${lpr.url}) in ${lpr.repoShortName} - ${lpr.state}`);
          }
          add();
        }

        add('**Special Files:**');
        if (pr.specialFiles.composer) {
          add(`- **Composer:** ⚠️ Changed: \`${pr.specialFiles.composerFiles.join('`, `')}\``);
        } else {
          add('- **Composer:** ✅ No changes');
        }
        if (pr.specialFiles.params) {
          add(`- **Inventory:** ⚠️ Changed: \`${pr.specialFiles.paramsFiles.join('`, `')}\``);
        } else {
          add('- **Inventory:** ✅ No changes');
        }
        add();
      }

      add('---');
      add();
    }
  }

  // --- Warnings ---
  if (!isOverview) {
    add('## Warnings');
    add();

    // Release-branch warnings first — nothing else matters if the code is not in the release
    const releaseBranchWarnings = warnings.filter((w) => w.type === 'not_in_release_branch');
    if (releaseBranchWarnings.length > 0) {
      add('### 🚨 Not In Release Branch');
      add(`These changes are **not** in \`${releaseBranchInfo?.branch ?? 'релизной ветке'}\` and will not ship with this release:`);
      for (const w of releaseBranchWarnings) {
        add(`- **${taskRef(w.taskId, statuses)}:** ${linkifyText(w.message, statuses)}`);
      }
      add();
    }

    // Missing Linked Tasks warnings
    const missingWarnings = warnings.filter((w) => w.type === 'missing_linked');
    if (missingWarnings.length > 0) {
      add('### Missing Linked Tasks');
      for (const w of missingWarnings) {
        add(`- **${taskRef(w.taskId, statuses)}:** ${linkifyText(w.message, statuses)}`);
      }
      add();
    }

    // Search Failures warnings
    const searchWarnings = warnings.filter((w) => w.type === 'search_failed');
    if (searchWarnings.length > 0) {
      add('### Search Failures');
      add('PR search exceeded the retry limit for these (task, repo) pairs. PRs may exist but were not confirmed — rerun the tool when the platform is healthy.');
      for (const w of searchWarnings) {
        add(`- **${taskRef(w.taskId, statuses)}:** ${linkifyText(w.message, statuses)}`);
      }
      add();
    }

    // PR Issues warnings
    const prWarnings = warnings.filter((w) => w.type === 'pr_issue');
    if (prWarnings.length > 0) {
      add('### PR Issues');
      for (const w of prWarnings) {
        add(`- **${taskRef(w.taskId, statuses)}:** ${linkifyText(w.message, statuses)}`);
      }
      add();
    }

    // Composer warnings
    const composerWarnings = warnings.filter((w) => w.type === 'composer');
    if (composerWarnings.length > 0) {
      add('### Composer Updates Required');
      add('The following PRs modify `composer.json`/`composer.lock` — **`composer update` will be needed on servers after deploy:**');
      for (const w of composerWarnings) {
        add(`- **${taskRef(w.taskId, statuses)}:** ${linkifyText(w.message, statuses)}`);
      }
      add();
    }

    // Inventory warnings
    const paramsWarnings = warnings.filter((w) => w.type === 'params');
    if (paramsWarnings.length > 0) {
      add('### Parameters Changes');
      for (const w of paramsWarnings) {
        add(`- **${taskRef(w.taskId, statuses)}:** ${linkifyText(w.message, statuses)}`);
      }
      add();
    }

    add('---');
    add();

    // --- Recommendations ---
    add('## Recommendations');
    add();

    if (missingLinkedTasks.length > 0) {
      add('### For Missing Linked Tasks');
      let recNum = 1;
      const uniqueMissing = new Map<string, LinkedTask>();
      for (const lt of missingLinkedTasks) {
        if (!uniqueMissing.has(lt.linkedTaskId)) {
          uniqueMissing.set(lt.linkedTaskId, lt);
        }
      }
      for (const [, lt] of uniqueMissing) {
        add(`${recNum}. **Include ${taskRef(lt.linkedTaskId, statuses)} in release** — ${lt.linkType} ${taskRef(lt.parentTaskId, statuses)}. ${linkifyText(lt.linkedTaskSummary, statuses)}`);
        recNum++;
      }
      add();
    }

    // Deploy order
    const deploySteps = suggestDeployOrder(taskReports, missingLinkedTaskReports, statuses);
    if (deploySteps.length > 0) {
      add('### Suggested Deploy Order');
      for (const step of deploySteps) {
        add(step);
      }
      add();
    }

    // Release-branch recommendations — the blocking action before anything else
    if (releaseBranchWarnings.length > 0) {
      add('### For Release Branch');
      let recNum = 1;
      for (const w of releaseBranchWarnings) {
        add(
          `${recNum}. **${taskRef(w.taskId, statuses)}:** смержить в \`${releaseBranchInfo?.branch ?? 'релизную ветку'}\` или исключить задачу из релиза — ${linkifyText(w.message, statuses)}`,
        );
        recNum++;
      }
      add();
    }

    // PR issue recommendations
    const prWarningsForRec = warnings.filter((w) => w.type === 'pr_issue');
    const actionableWarnings = prWarningsForRec.filter(
      (w) =>
        w.message.includes('no approvals') ||
        w.message.includes('OPEN') ||
        w.message.includes('failed CI'),
    );
    if (actionableWarnings.length > 0) {
      add('### For PR Issues');
      let recNum = 1;
      for (const w of actionableWarnings) {
        add(`${recNum}. **${taskRef(w.taskId, statuses)}:** ${linkifyText(w.message, statuses)}`);
        recNum++;
      }
      add();
    }

    add('---');
    add();
  }

  add(`*Report generated: ${checkedAt}*`);
  add('*Tool: release-helper v1.0.0*');
  add();

  return lines.join('\n');
}
