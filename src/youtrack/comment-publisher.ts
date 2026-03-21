import { YouTrackClient } from './client.js';
import { ReleaseReport } from '../types.js';
import { generateReport } from '../report/generator.js';

const COMMENT_TAG = '#release-helper';

export async function publishReportComment(
  youtrack: YouTrackClient,
  issueId: string,
  reportData: ReleaseReport,
): Promise<void> {
  const reportContent = generateReport(reportData, { short: true });
  const commentText = `${COMMENT_TAG}\n\n${reportContent}`;

  const comments = await youtrack.getIssueComments(issueId);
  const existing = comments.find((c) => c.text.includes(COMMENT_TAG));

  if (existing) {
    await youtrack.updateIssueComment(issueId, existing.id, commentText);
    console.log(`✏️  Updated existing YouTrack comment (id: ${existing.id})`);
  } else {
    const created = await youtrack.addIssueComment(issueId, commentText);
    console.log(`💬 Created YouTrack comment (id: ${created.id})`);
  }
}
