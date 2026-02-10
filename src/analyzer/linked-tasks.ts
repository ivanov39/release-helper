import { TaskIssue, LinkedTask, LinkType } from '../types.js';
import { YouTrackClient } from '../youtrack/client.js';
import { INCLUDED_TASK_TYPES } from '../config.js';

/**
 * Link types to search and their query format.
 * Key = what we see in linkedIssueCounts, Value = search query prefix to find related issues.
 */
const LINK_SEARCHES: Array<{
  countKey: string;
  searchQuery: string;
  linkType: LinkType;
}> = [
  { countKey: 'parent for', searchQuery: 'subtask of', linkType: 'subtask of' },
  { countKey: 'subtask of', searchQuery: 'parent for', linkType: 'parent for' },
  { countKey: 'depends on', searchQuery: 'is required for', linkType: 'is required for' },
  { countKey: 'is required for', searchQuery: 'depends on', linkType: 'depends on' },
  { countKey: 'relates to', searchQuery: 'relates to', linkType: 'relates to' },
  { countKey: 'duplicates', searchQuery: 'is duplicated by', linkType: 'is duplicated by' },
  { countKey: 'is duplicated by', searchQuery: 'duplicates', linkType: 'duplicates' },
];

/**
 * Analyze linked tasks for all release tasks and find missing ones.
 */
export async function analyzeLinkedTasks(
  youtrack: YouTrackClient,
  releaseTasks: TaskIssue[],
): Promise<LinkedTask[]> {
  const releaseTaskIds = new Set(releaseTasks.map((t) => t.id));
  const missingLinked: LinkedTask[] = [];
  const seen = new Set<string>(); // avoid duplicate warnings

  for (const task of releaseTasks) {
    process.stderr.write(`  Checking links for ${task.id}...\n`);

    // Get full issue details to see linkedIssueCounts
    let fullTask: TaskIssue;
    try {
      fullTask = await youtrack.getIssue(task.id);
    } catch (err) {
      process.stderr.write(`  Warning: Could not fetch ${task.id}: ${err}\n`);
      continue;
    }

    const counts = fullTask.linkedIssueCounts;

    for (const linkDef of LINK_SEARCHES) {
      const count = counts[linkDef.countKey] ?? 0;
      if (count === 0) continue;

      // Search for linked issues
      const query = `${linkDef.searchQuery}: ${task.id}`;
      process.stderr.write(`    Searching: ${query}\n`);

      let linked: TaskIssue[];
      try {
        linked = await youtrack.searchIssues(query);
      } catch (err) {
        process.stderr.write(`    Warning: Search failed for "${query}": ${err}\n`);
        continue;
      }

      for (const linkedIssue of linked) {
        // Filter by type
        if (!INCLUDED_TASK_TYPES.includes(linkedIssue.type)) continue;

        // Check if in release
        if (releaseTaskIds.has(linkedIssue.id)) continue;

        // Avoid duplicates
        const key = `${task.id}:${linkedIssue.id}:${linkDef.linkType}`;
        if (seen.has(key)) continue;
        seen.add(key);

        missingLinked.push({
          parentTaskId: task.id,
          linkedTaskId: linkedIssue.id,
          linkedTaskSummary: linkedIssue.summary,
          linkedTaskState: linkedIssue.state,
          linkType: linkDef.linkType,
        });

        process.stderr.write(
          `    Found missing: ${linkedIssue.id} (${linkDef.linkType}) - ${linkedIssue.summary}\n`,
        );
      }
    }
  }

  return missingLinked;
}
