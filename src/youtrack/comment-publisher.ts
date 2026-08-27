import { YouTrackClient } from './client.js';
import { ReleaseReport } from '../types.js';
import { generateReport } from '../report/generator.js';

const COMMENT_TAG = '#release-helper';

interface CommentAuthor {
  id: string;
  login: string;
  name: string;
}

/**
 * YouTrack разрешает редактировать только собственные комментарии — попытка
 * обновить чужой отвечает 403. Поэтому тегированный комментарий считается
 * «нашим» лишь при совпадении автора с владельцем токена.
 */
function isOwnComment(author: CommentAuthor | null | undefined, me: CommentAuthor): boolean {
  if (!author) {
    return false;
  }
  return author.id === me.id || (!!author.login && author.login === me.login);
}

export async function publishReportComment(
  youtrack: YouTrackClient,
  issueId: string,
  reportData: ReleaseReport,
): Promise<void> {
  const reportContent = generateReport(reportData, { short: true });
  const commentText = `${COMMENT_TAG}\n\n${reportContent}`;

  let me: CommentAuthor | null = null;
  try {
    me = await youtrack.getCurrentUser();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Warning: cannot resolve current YouTrack user (${message}) — a new comment will be created\n`);
  }

  const comments = await youtrack.getIssueComments(issueId);
  const existing = me
    ? comments.find((c) => c.text?.includes(COMMENT_TAG) && isOwnComment(c.author, me!))
    : undefined;

  if (existing) {
    await youtrack.updateIssueComment(issueId, existing.id, commentText);
    console.log(`✏️  Updated existing YouTrack comment (id: ${existing.id})`);
  } else {
    const created = await youtrack.addIssueComment(issueId, commentText);
    console.log(`💬 Created YouTrack comment (id: ${created.id})`);
  }
}
