#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';

// Load .env file from project root
function loadEnvFile(projectRoot: string): void {
  const envPath = path.join(projectRoot, '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const eqIdx = trimmed.indexOf('=');
    const key = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
loadEnvFile(process.cwd());

import {
  parseIssueId,
  loadBitbucketCredentials,
} from './config.js';
import { YouTrackClient } from './youtrack/client.js';
import { GitHubClient } from './github/client.js';
import { BitbucketClient } from './bitbucket/client.js';
import { analyzeLinkedTasks } from './analyzer/linked-tasks.js';
import { findPRsForTasks } from './analyzer/pr-finder.js';
import { generateReport } from './report/generator.js';
import { publishReportComment } from './youtrack/comment-publisher.js';
import {
  ReleaseIssue,
  TaskIssue,
  TaskReport,
  Warning,
  ReleaseReport,
} from './types.js';

function log(msg: string): void {
  process.stderr.write(msg + '\n');
}

async function main(): Promise<void> {
  // Step 1: Parse input
  const args = process.argv.slice(2);
  const isShort = args.includes('--short');
  const isOverview = args.includes('--overview');
  const input = args.find((a) => !a.startsWith('--'));

  if (!input) {
    console.error('Usage: release-helper <issue-id-or-url> [--short] [--overview]');
    console.error('');
    console.error('Options:');
    console.error('  --short     Hide Task Details section from the report');
    console.error('  --overview  Show only report header and PR Overview table');
    console.error('');
    console.error('Examples:');
    console.error('  release-helper ESN-2274');
    console.error('  release-helper ESN-2274 --short');
    console.error('  release-helper ESN-2274 --overview');
    console.error('  release-helper https://issues.enjoydev.io/issue/ESN-2274 --short');
    process.exit(1);
  }

  const issueId = parseIssueId(input);
  if (!issueId) {
    console.error(`Error: Could not parse issue ID from "${input}"`);
    console.error('Expected format: ESN-1234, ES-3310, or YouTrack URL');
    process.exit(1);
  }

  log(`\n🔍 Release Helper - Checking ${issueId}\n`);

  // Initialize clients
  // Validate YouTrack token exists
  if (!process.env.YOUTRACK_TOKEN) {
    console.error('Error: YOUTRACK_TOKEN environment variable is not set.');
    console.error('Set it with: export YOUTRACK_TOKEN=<your-token>');
    process.exit(1);
  }

  let bbCredentials: { email: string; token: string };
  try {
    bbCredentials = loadBitbucketCredentials();
  } catch (err) {
    console.error(`Error loading Bitbucket credentials: ${err}`);
    process.exit(1);
  }

  const youtrack = new YouTrackClient();
  const github = new GitHubClient();
  const bitbucket = new BitbucketClient(bbCredentials.email, bbCredentials.token);

  // Step 2: Get release issue
  log('📋 Step 1/7: Fetching release issue...');
  let release: ReleaseIssue;
  try {
    release = await youtrack.getReleaseIssue(issueId);
  } catch (err) {
    console.error(`Error: Could not fetch release issue ${issueId}: ${err}`);
    console.error('Check that the issue ID is correct and YOUTRACK_TOKEN is valid.');
    process.exit(1);
  }
  log(`   Release: ${release.summary}`);

  // Step 3: Get linked tasks
  log('🔗 Step 2/7: Searching linked tasks...');
  let linkedIssues: TaskIssue[];
  try {
    linkedIssues = await youtrack.searchIssues(`links: ${issueId}`);
  } catch (err) {
    console.error(`Error searching linked issues: ${err}`);
    process.exit(1);
  }

  // Also parse description for additional task IDs
  const descriptionTaskIds = extractTaskIdsFromText(release.description);
  const allTaskIds = new Set<string>(linkedIssues.map((i) => i.id));
  for (const id of descriptionTaskIds) {
    if (id !== issueId) allTaskIds.add(id);
  }

  // Fetch full details for tasks found only in description
  const releaseTasks: TaskIssue[] = [...linkedIssues];
  for (const id of allTaskIds) {
    if (!linkedIssues.some((i) => i.id === id)) {
      try {
        const task = await youtrack.getIssue(id);
        releaseTasks.push(task);
      } catch {
        log(`   Warning: Could not fetch task ${id} from description`);
      }
    }
  }

  // Filter out Release and Epic types from release tasks
  const filteredTasks = releaseTasks.filter(
    (t) => t.type !== 'Release' && t.type !== 'Epic' && t.id !== issueId,
  );

  log(`   Found ${filteredTasks.length} tasks in release`);

  // Step 3.5: Check task dependencies
  log('🔍 Step 3/7: Analyzing task dependencies...');
  const missingLinkedTasks = await analyzeLinkedTasks(youtrack, filteredTasks);
  log(`   Found ${missingLinkedTasks.length} missing linked tasks`);

  // Step 4-6: Find PRs for all tasks
  log('🔎 Step 4/7: Searching PRs...');
  const missingTaskIds = [...new Set(missingLinkedTasks.map((t) => t.linkedTaskId))];
  const allSearchTaskIds = [
    ...filteredTasks.map((t) => t.id),
    ...missingTaskIds,
  ];
  const prMap = await findPRsForTasks(github, bitbucket, allSearchTaskIds);

  // Build task reports
  log('📊 Step 5/7: Analyzing PRs...');
  const taskReports: TaskReport[] = [];
  const warnings: Warning[] = [];

  for (const task of filteredTasks) {
    const prData = prMap.get(task.id) ?? { primary: [], linked: [] };
    const report: TaskReport = {
      task,
      prs: prData.primary,
      linkedPrs: prData.linked,
    };
    taskReports.push(report);

    // Generate warnings
    if (prData.primary.length === 0) {
      warnings.push({
        type: 'pr_issue',
        taskId: task.id,
        message: 'No PR found for this task',
      });
    }

    for (const pr of [...prData.primary, ...prData.linked]) {
      if (pr.state === 'OPEN') {
        warnings.push({
          type: 'pr_issue',
          taskId: task.id,
          message: `PR #${pr.number} in ${pr.repoShortName} is still OPEN`,
        });
      }
      if (pr.approvals.length === 0) {
        warnings.push({
          type: 'pr_issue',
          taskId: task.id,
          message: `PR #${pr.number} in ${pr.repoShortName} has no approvals`,
        });
      }
      if (pr.commitCount > 1) {
        warnings.push({
          type: 'pr_issue',
          taskId: task.id,
          message: `PR #${pr.number} in ${pr.repoShortName} has ${pr.commitCount} commits (not squashed)`,
        });
      }
      if (pr.checks.some((c) => c.state === 'FAILURE')) {
        warnings.push({
          type: 'pr_issue',
          taskId: task.id,
          message: `PR #${pr.number} in ${pr.repoShortName} has failed CI checks`,
        });
      }
      if (pr.specialFiles.composer) {
        warnings.push({
          type: 'composer',
          taskId: task.id,
          message: `PR #${pr.number} in ${pr.repoShortName} modifies composer files — \`composer update\` required after deploy`,
        });
      }
      if (pr.specialFiles.params) {
        warnings.push({
          type: 'params',
          taskId: task.id,
          message: `PR #${pr.number} in ${pr.repoShortName} modifies parameters files — config update required before deploy`,
        });
      }
    }
  }

  // Build missing linked task reports
  const missingLinkedTaskReports: TaskReport[] = [];
  for (const missing of missingLinkedTasks) {
    // Avoid duplicate reports for same missing task
    if (missingLinkedTaskReports.some((r) => r.task.id === missing.linkedTaskId)) continue;

    let missingTask: TaskIssue;
    try {
      missingTask = await youtrack.getIssue(missing.linkedTaskId);
    } catch {
      missingTask = {
        id: missing.linkedTaskId,
        summary: missing.linkedTaskSummary,
        type: 'Task',
        state: missing.linkedTaskState,
        linkedIssueCounts: {},
      };
    }

    const prData = prMap.get(missing.linkedTaskId) ?? { primary: [], linked: [] };
    missingLinkedTaskReports.push({
      task: missingTask,
      prs: prData.primary,
      linkedPrs: prData.linked,
    });

    // Warnings for missing linked task PRs
    for (const pr of prData.primary) {
      if (pr.approvals.length === 0) {
        warnings.push({
          type: 'pr_issue',
          taskId: missing.linkedTaskId,
          message: `PR #${pr.number} in ${pr.repoShortName} has no human approvals`,
        });
      }
    }
  }

  // Missing linked task warnings
  for (const missing of missingLinkedTasks) {
    warnings.push({
      type: 'missing_linked',
      taskId: missing.parentTaskId,
      message: `Missing linked task — ${missing.linkedTaskId} (${missing.linkType}) is not in release`,
    });
  }

  // Step 8: Generate report
  log('📝 Step 6/7: Generating report...');
  const checkedAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');

  const reportData: ReleaseReport = {
    release,
    taskReports,
    missingLinkedTasks,
    missingLinkedTaskReports,
    warnings,
    checkedAt,
  };

  const reportContent = generateReport(reportData, { short: isShort, overview: isOverview });

  // Save report
  const reportDir = path.join(process.cwd(), '.spec', 'review');
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `release-${issueId}.md`);
  fs.writeFileSync(reportPath, reportContent, 'utf-8');

  log(`\n✅ Report saved to ${reportPath}`);
  log(`   Total tasks: ${filteredTasks.length}`);
  log(`   Missing linked: ${missingLinkedTasks.length}`);
  log(`   Warnings: ${warnings.length}`);

  // Step 7: Publish report to YouTrack
  log('\n💬 Step 7/7: Publishing report to YouTrack...');
  try {
    await publishReportComment(youtrack, issueId, reportData);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`⚠️  Failed to publish comment to YouTrack: ${message}`);
  }
}

/** Extract task IDs (ESN-1234, ES-3310) from text */
function extractTaskIdsFromText(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/ESN?-\d+/g);
  return matches ? [...new Set(matches)] : [];
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
