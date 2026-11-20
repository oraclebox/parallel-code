/** GitLab issue and note reads mapped onto the shared code-host types. */
import type {
  CodeHostActivityPage,
  CodeHostIssuePage,
  CodeHostIssueQuery,
  CodeHostIssueSummary,
  CodeHostProject,
  CodeHostTestResult,
  CodeHostWorkItem,
} from '../../shared/codehost-types.js';
import { CodeHostError } from '../errors.js';
import { gitlabRequest, type GitLabTarget } from './client.js';

const ISSUE_PAGE_SIZE = 30;
const NOTE_PAGE_SIZE = 25;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** GitLab addresses a project by its URL-encoded full path, sub-groups included. */
export function encodeProjectId(projectPath: string): string {
  return encodeURIComponent(projectPath);
}

export function mapGitLabIssue(raw: unknown, project: CodeHostProject): CodeHostIssueSummary {
  const record = asRecord(raw);
  const iid = record?.iid;
  const title = asString(record?.title);
  const url = asString(record?.web_url);
  if (typeof iid !== 'number' || !Number.isSafeInteger(iid) || !title || !url) {
    throw new CodeHostError('network', 'GitLab returned an issue without an IID, title or URL');
  }
  return {
    kind: 'issue',
    hostKind: 'gitlab',
    host: project.host,
    projectPath: project.projectPath,
    iid,
    title,
    description: asString(record?.description) ?? '',
    url: url.replace(/[?#].*$/, ''),
    state: record?.state === 'closed' ? 'closed' : 'open',
    author: asString(asRecord(record?.author)?.username) ?? 'unknown',
    updatedAt: asString(record?.updated_at) ?? '',
    labels: asArray(record?.labels).flatMap((label) => (typeof label === 'string' ? [label] : [])),
  };
}

export function mapGitLabWorkItem(raw: unknown, project: CodeHostProject): CodeHostWorkItem {
  const issue = mapGitLabIssue(raw, project);
  return {
    kind: 'issue',
    hostKind: 'gitlab',
    number: issue.iid,
    title: issue.title,
    url: issue.url,
    author: issue.author,
    updatedAt: issue.updatedAt,
    labels: issue.labels,
  };
}

/** `GET /user` proves the token works and names the account behind it. */
export async function testConnection(target: GitLabTarget): Promise<CodeHostTestResult> {
  const { data } = await gitlabRequest<unknown>(target, '/user');
  const record = asRecord(data);
  const login = asString(record?.username);
  if (!login) throw new CodeHostError('auth', 'GitLab did not return a user for this token');
  return { login, name: asString(record?.name) };
}

export async function listIssues(
  target: GitLabTarget,
  project: CodeHostProject,
  query: CodeHostIssueQuery,
): Promise<CodeHostIssuePage> {
  const { data, nextPage } = await gitlabRequest<unknown>(
    target,
    `/projects/${encodeProjectId(project.projectPath)}/issues`,
    {
      state: query.state === 'all' ? undefined : query.state,
      search: query.search || undefined,
      order_by: 'updated_at',
      sort: 'desc',
      per_page: ISSUE_PAGE_SIZE,
      page: query.page,
    },
  );
  return {
    project,
    items: asArray(data).map((item) => mapGitLabIssue(item, project)),
    hasMore: nextPage !== null,
  };
}

export async function getIssue(
  target: GitLabTarget,
  project: CodeHostProject,
  iid: number,
): Promise<CodeHostIssueSummary> {
  const { data } = await gitlabRequest<unknown>(
    target,
    `/projects/${encodeProjectId(project.projectPath)}/issues/${iid}`,
  );
  return mapGitLabIssue(data, project);
}

export async function getActivity(
  target: GitLabTarget,
  project: CodeHostProject,
  iid: number,
  page: number,
): Promise<CodeHostActivityPage> {
  const { data, nextPage } = await gitlabRequest<unknown>(
    target,
    `/projects/${encodeProjectId(project.projectPath)}/issues/${iid}/notes`,
    { sort: 'asc', per_page: NOTE_PAGE_SIZE, page },
  );
  return {
    items: asArray(data).map((value, index) => {
      const note = asRecord(value);
      return {
        id: typeof note?.id === 'number' ? String(note.id) : `${page}-${index}`,
        author: asString(asRecord(note?.author)?.username) ?? 'unknown',
        createdAt: asString(note?.created_at) ?? '',
        event: note?.system === true ? 'activity' : 'commented',
        body: asString(note?.body) ?? '',
      };
    }),
    hasMore: nextPage !== null,
  };
}
