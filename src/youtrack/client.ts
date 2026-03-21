import { ReleaseIssue, TaskIssue } from '../types.js';
import { YOUTRACK_API_URL, YOUTRACK_BASE_URL, getYouTrackToken } from '../config.js';

interface YTCustomField {
  name: string;
  value: { name: string } | null;
}

interface YTLink {
  direction: string;
  linkType: {
    name: string;
    sourceToTarget: string;
    targetToSource: string;
  };
  issues: Array<{
    idReadable: string;
    summary?: string;
    customFields?: YTCustomField[];
  }>;
}

interface YTIssueResponse {
  idReadable: string;
  summary: string;
  description: string | null;
  resolved: number | null;
  customFields: YTCustomField[];
  links?: YTLink[];
}

interface YTComment {
  id: string;
  text: string;
  author: {
    login: string;
    name: string;
  };
}

export class YouTrackClient {
  private token: string;

  constructor() {
    this.token = getYouTrackToken();
  }

  private async fetchApi<T>(
    endpoint: string,
    options?: { method?: string; body?: unknown },
  ): Promise<T> {
    const url = `${YOUTRACK_API_URL}${endpoint}`;
    const response = await fetch(url, {
      method: options?.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        ...(options?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(options?.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`YouTrack API error ${response.status}: ${response.statusText} - ${body}`);
    }

    return response.json() as Promise<T>;
  }

  private getCustomFieldValue(fields: YTCustomField[], fieldName: string): string {
    const field = fields.find((f) => f.name === fieldName);
    return field?.value?.name ?? '';
  }

  private buildLinkedIssueCounts(links: YTLink[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const link of links) {
      // Determine the link name based on direction
      let linkName: string;
      if (link.direction === 'OUTWARD') {
        linkName = link.linkType.sourceToTarget;
      } else if (link.direction === 'INWARD') {
        linkName = link.linkType.targetToSource;
      } else {
        linkName = link.linkType.sourceToTarget;
      }
      counts[linkName] = (counts[linkName] ?? 0) + link.issues.length;
    }
    return counts;
  }

  async getIssue(issueId: string): Promise<TaskIssue> {
    const fields = [
      'idReadable',
      'summary',
      'description',
      'resolved',
      'customFields(name,value(name))',
      'links(direction,linkType(name,sourceToTarget,targetToSource),issues(idReadable,summary,customFields(name,value(name))))',
    ].join(',');

    const data = await this.fetchApi<YTIssueResponse>(
      `/issues/${encodeURIComponent(issueId)}?fields=${encodeURIComponent(fields)}`,
    );

    return {
      id: data.idReadable,
      summary: data.summary,
      type: this.getCustomFieldValue(data.customFields, 'Type'),
      state: this.getCustomFieldValue(data.customFields, 'State'),
      linkedIssueCounts: this.buildLinkedIssueCounts(data.links ?? []),
    };
  }

  async getReleaseIssue(issueId: string): Promise<ReleaseIssue> {
    const fields = [
      'idReadable',
      'summary',
      'description',
      'customFields(name,value(name))',
      'links(direction,linkType(name,sourceToTarget,targetToSource),issues(idReadable,summary,customFields(name,value(name))))',
    ].join(',');

    const data = await this.fetchApi<YTIssueResponse>(
      `/issues/${encodeURIComponent(issueId)}?fields=${encodeURIComponent(fields)}`,
    );

    return {
      id: data.idReadable,
      summary: data.summary,
      url: `${YOUTRACK_BASE_URL}/issue/${data.idReadable}`,
      description: data.description ?? '',
      linkedIssueCounts: this.buildLinkedIssueCounts(data.links ?? []),
    };
  }

  async getIssueComments(issueId: string): Promise<YTComment[]> {
    const fields = 'id,text,author(login,name)';
    return this.fetchApi<YTComment[]>(
      `/issues/${encodeURIComponent(issueId)}/comments?fields=${encodeURIComponent(fields)}&$top=-1`,
    );
  }

  async addIssueComment(issueId: string, text: string): Promise<YTComment> {
    const fields = 'id,text,author(login,name)';
    return this.fetchApi<YTComment>(
      `/issues/${encodeURIComponent(issueId)}/comments?fields=${encodeURIComponent(fields)}`,
      { method: 'POST', body: { text } },
    );
  }

  async updateIssueComment(issueId: string, commentId: string, text: string): Promise<YTComment> {
    const fields = 'id,text,author(login,name)';
    return this.fetchApi<YTComment>(
      `/issues/${encodeURIComponent(issueId)}/comments/${encodeURIComponent(commentId)}?fields=${encodeURIComponent(fields)}`,
      { method: 'POST', body: { text } },
    );
  }

  async searchIssues(query: string): Promise<TaskIssue[]> {
    const fields = 'idReadable,summary,customFields(name,value(name))';
    const data = await this.fetchApi<YTIssueResponse[]>(
      `/issues?query=${encodeURIComponent(query)}&fields=${encodeURIComponent(fields)}&$top=100`,
    );

    return data.map((item) => ({
      id: item.idReadable,
      summary: item.summary,
      type: this.getCustomFieldValue(item.customFields, 'Type'),
      state: this.getCustomFieldValue(item.customFields, 'State'),
      linkedIssueCounts: {},
    }));
  }
}
