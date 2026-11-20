/** GitHub behind the generic code-host surface; all calls still go through `gh`. */
import type {
  CodeHostActivityPage,
  CodeHostIssuePage,
  CodeHostIssueQuery,
  CodeHostIssueSummary,
  CodeHostWorkItem,
} from '../shared/codehost-types.js';
import { parseGitHubIssueUrl } from '../shared/codehost-refs.js';
import type { GitHubIssueQuery, GitHubIssueSummary, GitHubWorkItem } from '../ipc/shared-types.js';
import {
  browseGitHubIssues,
  readGitHubIssue,
  readGitHubIssueActivity,
  resolveGitHubRepository,
} from '../github/issues.js';
import { listGitHubWorkItems } from '../github/work-items.js';

export function mapGitHubWorkItem(item: GitHubWorkItem): CodeHostWorkItem {
  return {
    kind: item.kind,
    hostKind: 'github',
    number: item.number,
    title: item.title,
    url: item.url,
    author: item.author,
    updatedAt: item.updatedAt,
    labels: item.labels,
    isDraft: item.isDraft,
  };
}

export function mapGitHubIssue(
  issue: GitHubIssueSummary,
  projectPath: string,
): CodeHostIssueSummary {
  return {
    kind: issue.kind,
    hostKind: 'github',
    host: 'github.com',
    projectPath,
    iid: issue.number,
    title: issue.title,
    description: issue.body,
    url: issue.url,
    state: issue.state,
    author: issue.author,
    updatedAt: issue.updatedAt,
    labels: issue.labels,
  };
}

export function mapGitHubIssueQuery(query: CodeHostIssueQuery): GitHubIssueQuery {
  return {
    kind: 'all',
    sort: 'updated-desc',
    author: '',
    search: query.search,
    state: query.state,
    label: '',
    assignee: '',
    page: query.page,
  };
}

export async function listGitHubWorkItemsForCodeHost(
  projectRoot: string,
  search?: string,
): Promise<CodeHostWorkItem[]> {
  return (await listGitHubWorkItems(projectRoot, search)).map(mapGitHubWorkItem);
}

export async function browseGitHubIssuesForCodeHost(
  projectRoot: string,
  query: CodeHostIssueQuery,
): Promise<CodeHostIssuePage> {
  const page = await browseGitHubIssues(projectRoot, mapGitHubIssueQuery(query));
  return {
    project: { hostKind: 'github', host: 'github.com', projectPath: page.repository },
    items: page.items.map((issue) => mapGitHubIssue(issue, page.repository)),
    hasMore: page.hasMore,
  };
}

/** Reads by canonical issue URL; pull request URLs resolve through gh as well. */
export async function readGitHubIssueForCodeHost(url: string): Promise<CodeHostIssueSummary> {
  const ref = parseGitHubIssueUrl(url);
  if (!ref) throw new Error('Expected a github.com issue URL');
  const issue = await readGitHubIssue(ref.url);
  return mapGitHubIssue(issue, ref.projectPath);
}

export async function readGitHubActivityForCodeHost(
  url: string,
  page: number,
): Promise<CodeHostActivityPage> {
  const ref = parseGitHubIssueUrl(url);
  if (!ref) throw new Error('Expected a github.com issue URL');
  return readGitHubIssueActivity(ref.url, page);
}

/** The repository the project's gh resolves, so callers can name the project. */
export async function githubRepository(projectRoot: string): Promise<string> {
  return resolveGitHubRepository(projectRoot);
}
