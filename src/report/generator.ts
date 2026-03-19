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
} from '../types.js';
import { YOUTRACK_BASE_URL } from '../config.js';

function issueLink(id: string): string {
  return `[${id}](${YOUTRACK_BASE_URL}/issue/${id})`;
}

function linkifyText(text: string): string {
  return text.replace(/\b(ESN?-\d+)\b/g, (_, id) => issueLink(id));
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
  const names = approved.map((a) => a.name).join(', ');
  return `✅ ${approved.length} (${names})`;
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

/** Check if a task is "ready" (all checks pass) */
function isTaskReady(report: TaskReport): boolean {
  if (report.prs.length === 0) return false;
  for (const pr of report.prs) {
    if (pr.state !== 'MERGED') return false;
    if (pr.approvals.filter((a) => a.state === 'APPROVED').length === 0) return false;
  }
  return true;
}

/** Count summary statuses */
function countStatuses(
  taskReports: TaskReport[],
  missingCount: number,
): { ready: number; issues: number; noPR: number; missingLinked: number } {
  let ready = 0;
  let issues = 0;
  let noPR = 0;

  for (const report of taskReports) {
    if (report.prs.length === 0) {
      noPR++;
    } else if (isTaskReady(report)) {
      ready++;
    } else {
      issues++;
    }
  }

  return { ready, issues, noPR, missingLinked: missingCount };
}

/** Suggest deploy order based on repo types */
function suggestDeployOrder(
  taskReports: TaskReport[],
  missingReports: TaskReport[],
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
      const label = `${pr.repoShortName} #${pr.number} (${issueLink(report.task.id)})`;
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

export function generateReport(data: ReleaseReport): string {
  const {
    release,
    taskReports,
    missingLinkedTasks,
    missingLinkedTaskReports,
    warnings,
    checkedAt,
  } = data;

  const lines: string[] = [];
  const add = (line: string = '') => lines.push(line);

  // Build linked task lookup for display
  const linkedTaskMap = new Map<string, LinkedTask>();
  for (const lt of missingLinkedTasks) {
    linkedTaskMap.set(lt.linkedTaskId, lt);
  }

  // --- Header ---
  add(`# Release Check Report: ${issueLink(release.id)}`);
  add();
  add(`**Release:** ${release.summary}`);
  add(`**URL:** ${release.url}`);
  add(`**Checked at:** ${checkedAt}`);
  const missingUniqueCount = new Set(missingLinkedTasks.map((t) => t.linkedTaskId)).size;
  add(`**Total tasks:** ${taskReports.length} (+ ${missingUniqueCount} missing linked tasks detected)`);
  add();
  add('---');
  add();

  // --- Summary ---
  const counts = countStatuses(taskReports, missingUniqueCount);
  add('## Summary');
  add();
  add('| Status | Count |');
  add('|--------|-------|');
  add(`| ✅ Ready | ${counts.ready} |`);
  add(`| ⚠️ Issues | ${counts.issues} |`);
  add(`| ❌ PR not found | ${counts.noPR} |`);
  add(`| 🔗 Missing linked tasks | ${counts.missingLinked} |`);
  add();
  add('---');
  add();

  // --- PR Overview Table ---
  add('## PR Overview');
  add();
  add('| Task | Repository | PR | Author | State | Approvals | Commits | Checks | Composer | Params |');
  add('|------|------------|-----|--------|-------|-----------|---------|--------|----------|--------|');

  for (const report of taskReports) {
    for (const pr of report.prs) {
      add(
        `| ${issueLink(report.task.id)} | ${repoDisplay(pr)} | ${prLink(pr)} | ${pr.author} | ${stateIcon(pr.state)} | ${approvalText(pr.approvals)} | ${commitText(pr.commitCount)} | ${checksText(pr.checks)} | ${composerCell(pr)} | ${paramsCell(pr)} |`,
      );
    }
    // Linked PRs from description
    for (const pr of report.linkedPrs) {
      add(
        `| └─ linked | ${repoDisplay(pr)} | ${prLink(pr)} | ${pr.author} | ${stateIcon(pr.state)} | ${approvalText(pr.approvals)} | ${commitText(pr.commitCount)} | ${checksText(pr.checks)} | ${composerCell(pr)} | ${paramsCell(pr)} |`,
      );
    }
    if (report.prs.length === 0) {
      add(`| ${issueLink(report.task.id)} | - | ❌ PR not found | - | - | - | - | - | - | - |`);
    }
  }

  // Missing linked task PRs
  for (const report of missingLinkedTaskReports) {
    const lt = linkedTaskMap.get(report.task.id);
    const prefix = lt ? `${linkPrefix(lt.linkType)}: ${issueLink(report.task.id)}` : `🔗 ${issueLink(report.task.id)}`;
    for (const pr of report.prs) {
      add(
        `| ${prefix} | ${repoDisplay(pr)} | ${prLink(pr)} | ${pr.author} | ${stateIcon(pr.state)} | ${approvalText(pr.approvals)} | ${commitText(pr.commitCount)} | ${checksText(pr.checks)} | ${composerCell(pr)} | ${paramsCell(pr)} |`,
      );
    }
    for (const pr of report.linkedPrs) {
      add(
        `| └─ linked | ${repoDisplay(pr)} | ${prLink(pr)} | ${pr.author} | ${stateIcon(pr.state)} | ${approvalText(pr.approvals)} | ${commitText(pr.commitCount)} | ${checksText(pr.checks)} | ${composerCell(pr)} | ${paramsCell(pr)} |`,
      );
    }
  }

  add();
  add('**Legend:** BB = Bitbucket, GH = GitHub | Checks: ✅ passed, ❌ failed, ⏳ pending, - none | Composer/Params: ⚠️ file changed | 🔗 subtask/dep = missing linked task not in release');
  add();
  add('---');
  add();

  // --- Task Details ---
  add('## Task Details');
  add();

  for (const report of taskReports) {
    add(`### ${issueLink(report.task.id)}: ${report.task.summary}`);
    add();

    if (report.prs.length === 0) {
      add('**PR:** ❌ Not found');
      add();
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
        add(`- **Params:** ⚠️ Changed: \`${pr.specialFiles.paramsFiles.join('`, `')}\``);
      } else {
        add('- **Params:** ✅ No changes');
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

  // --- Missing Linked Tasks Details ---
  if (missingLinkedTaskReports.length > 0) {
    add('## Missing Linked Tasks Details');
    add();

    for (const report of missingLinkedTaskReports) {
      const lt = linkedTaskMap.get(report.task.id);
      const linkInfo = lt ? ` (${lt.linkType} ${issueLink(lt.parentTaskId)})` : '';
      add(`### 🔗 ${issueLink(report.task.id)}: ${report.task.summary}${linkInfo}`);
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
          add(`- **Params:** ⚠️ Changed: \`${pr.specialFiles.paramsFiles.join('`, `')}\``);
        } else {
          add('- **Params:** ✅ No changes');
        }
        add();
      }

      add('---');
      add();
    }
  }

  // --- Warnings ---
  add('## Warnings');
  add();

  // Missing Linked Tasks warnings
  const missingWarnings = warnings.filter((w) => w.type === 'missing_linked');
  if (missingWarnings.length > 0) {
    add('### Missing Linked Tasks');
    for (const w of missingWarnings) {
      add(`- **${issueLink(w.taskId)}:** ${linkifyText(w.message)}`);
    }
    add();
  }

  // PR Issues warnings
  const prWarnings = warnings.filter((w) => w.type === 'pr_issue');
  if (prWarnings.length > 0) {
    add('### PR Issues');
    for (const w of prWarnings) {
      add(`- **${issueLink(w.taskId)}:** ${linkifyText(w.message)}`);
    }
    add();
  }

  // Composer warnings
  const composerWarnings = warnings.filter((w) => w.type === 'composer');
  if (composerWarnings.length > 0) {
    add('### Composer Updates Required');
    add('The following PRs modify `composer.json`/`composer.lock` — **`composer update` will be needed on servers after deploy:**');
    for (const w of composerWarnings) {
      add(`- **${issueLink(w.taskId)}:** ${linkifyText(w.message)}`);
    }
    add();
  }

  // Params warnings
  const paramsWarnings = warnings.filter((w) => w.type === 'params');
  if (paramsWarnings.length > 0) {
    add('### Parameters Changes');
    for (const w of paramsWarnings) {
      add(`- **${issueLink(w.taskId)}:** ${linkifyText(w.message)}`);
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
      add(`${recNum}. **Include ${issueLink(lt.linkedTaskId)} in release** — ${lt.linkType} ${issueLink(lt.parentTaskId)}. ${linkifyText(lt.linkedTaskSummary)}`);
      recNum++;
    }
    add();
  }

  // Deploy order
  const deploySteps = suggestDeployOrder(taskReports, missingLinkedTaskReports);
  if (deploySteps.length > 0) {
    add('### Suggested Deploy Order');
    for (const step of deploySteps) {
      add(step);
    }
    add();
  }

  // PR issue recommendations
  const actionableWarnings = prWarnings.filter(
    (w) =>
      w.message.includes('no approvals') ||
      w.message.includes('OPEN') ||
      w.message.includes('failed CI'),
  );
  if (actionableWarnings.length > 0) {
    add('### For PR Issues');
    let recNum = 1;
    for (const w of actionableWarnings) {
      add(`${recNum}. **${issueLink(w.taskId)}:** ${linkifyText(w.message)}`);
      recNum++;
    }
    add();
  }

  add('---');
  add();
  add(`*Report generated: ${checkedAt}*`);
  add('*Tool: release-helper v1.0.0*');
  add();

  return lines.join('\n');
}
