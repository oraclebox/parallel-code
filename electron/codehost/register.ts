/**
 * IPC for the generic code-host surface. GitLab talks REST with a stored PAT;
 * GitHub delegates to the existing `gh`-backed functions.
 */
import { existsSync, statSync } from 'fs';
import { ipcMain } from 'electron';
import { IPC } from '../ipc/channels.js';
import { assertInt, assertOptionalString, assertString, validatePath } from '../ipc/validate.js';
import type {
  CodeHostHostInput,
  CodeHostProject,
  CodeHostWorkItem,
} from '../shared/codehost-types.js';
import { parseIssueUrl } from '../shared/codehost-refs.js';
import { CodeHostError } from './errors.js';
import {
  browseGitHubIssuesForCodeHost,
  listGitHubWorkItemsForCodeHost,
  readGitHubActivityForCodeHost,
  readGitHubIssueForCodeHost,
} from './github-adapter.js';
import { getActivity, getIssue, listIssues, testConnection } from './gitlab/issues.js';
import { gitLabTargetForHostname } from './registry.js';
import { resolveCodeHostProject } from './project.js';
import {
  deleteHost,
  gitLabInstanceById,
  listHosts,
  normalizeBaseUrl,
  saveHost,
  tokenForHost,
} from './settings.js';

type IpcArgs = Record<string, unknown>;

const MAX_SEARCH_LENGTH = 200;
const MAX_PAGE = 40;

function searchArg(value: unknown): string {
  assertOptionalString(value, 'search');
  const search = (value ?? '').trim();
  if (search.length > MAX_SEARCH_LENGTH) throw new Error('search is too long');
  return search;
}

function pageArg(value: unknown): number {
  assertInt(value, 'page');
  if (value < 1 || value > MAX_PAGE) throw new Error('page is out of range');
  return value;
}

function stateArg(value: unknown): 'open' | 'closed' | 'all' {
  if (value !== 'open' && value !== 'closed' && value !== 'all') {
    throw new Error('state must be open, closed or all');
  }
  return value;
}

async function projectArg(value: unknown): Promise<CodeHostProject> {
  validatePath(value, 'projectRoot');
  const project = await resolveCodeHostProject(value as string);
  if (!project) {
    throw new CodeHostError(
      'config',
      'No GitHub remote or configured GitLab instance matches this project. Add an instance in Settings → Code Hosts.',
    );
  }
  return project;
}

export function registerCodeHostHandlers(): void {
  ipcMain.handle(IPC.ResolveCodehostProject, (_e, args: IpcArgs) => {
    validatePath(args.projectRoot, 'projectRoot');
    return resolveCodeHostProject(args.projectRoot as string);
  });

  ipcMain.handle(IPC.ListCodehostWorkItems, async (_e, args: IpcArgs) => {
    const root = args.projectRoot;
    validatePath(root, 'projectRoot');
    const search = searchArg(args.search);
    const project = await projectArg(root);
    if (project.hostKind === 'github') {
      return listGitHubWorkItemsForCodeHost(root as string, search || undefined);
    }
    const page = await listIssues(gitLabTargetForHostname(project.host), project, {
      search,
      state: 'open',
      page: 1,
    });
    return page.items.map(
      (issue): CodeHostWorkItem => ({
        kind: 'issue',
        hostKind: 'gitlab',
        number: issue.iid,
        title: issue.title,
        url: issue.url,
        author: issue.author,
        updatedAt: issue.updatedAt,
        labels: issue.labels,
      }),
    );
  });

  ipcMain.handle(IPC.BrowseCodehostIssues, async (_e, args: IpcArgs) => {
    const root = args.projectRoot;
    validatePath(root, 'projectRoot');
    const query = {
      search: searchArg(args.search),
      state: stateArg(args.state),
      page: pageArg(args.page),
    };
    const project = await projectArg(root);
    if (project.hostKind === 'github') {
      return browseGitHubIssuesForCodeHost(root as string, query);
    }
    return listIssues(gitLabTargetForHostname(project.host), project, query);
  });

  ipcMain.handle(IPC.ReadCodehostIssue, async (_e, args: IpcArgs) => {
    assertString(args.url, 'url');
    const ref = parseIssueUrl(args.url);
    if (!ref) throw new Error('Expected a GitHub or GitLab issue URL');
    if (ref.hostKind === 'github') return readGitHubIssueForCodeHost(ref.url);
    const project: CodeHostProject = {
      hostKind: 'gitlab',
      host: ref.host,
      projectPath: ref.projectPath,
    };
    return getIssue(gitLabTargetForHostname(ref.host), project, ref.iid);
  });

  ipcMain.handle(IPC.ReadCodehostIssueActivity, async (_e, args: IpcArgs) => {
    assertString(args.url, 'url');
    const page = pageArg(args.page);
    const ref = parseIssueUrl(args.url);
    if (!ref) throw new Error('Expected a GitHub or GitLab issue URL');
    if (ref.hostKind === 'github') return readGitHubActivityForCodeHost(ref.url, page);
    const project: CodeHostProject = {
      hostKind: 'gitlab',
      host: ref.host,
      projectPath: ref.projectPath,
    };
    return getActivity(gitLabTargetForHostname(ref.host), project, ref.iid, page);
  });

  ipcMain.handle(IPC.CodehostListHosts, () => listHosts());

  ipcMain.handle(IPC.CodehostSaveHost, (_e, args: IpcArgs) => {
    assertString(args.label, 'label');
    assertString(args.baseUrl, 'baseUrl');
    assertOptionalString(args.username, 'username');
    assertOptionalString(args.token, 'token');
    assertOptionalString(args.caPath, 'caPath');
    const input: CodeHostHostInput = {
      id: typeof args.id === 'string' ? args.id : undefined,
      kind: args.kind === 'github' || args.kind === 'gitlab' ? args.kind : 'gitlab',
      label: args.label as string,
      baseUrl: args.baseUrl as string,
      username: args.username as string | undefined,
      token: args.token as string | undefined,
      caPath: args.caPath as string | undefined,
    };
    return saveHost(input);
  });

  ipcMain.handle(IPC.CodehostDeleteHost, (_e, args: IpcArgs) => {
    assertString(args.id, 'id');
    return deleteHost(args.id);
  });

  ipcMain.handle(IPC.CodehostTestHost, async (_e, args: IpcArgs) => {
    const stored = typeof args.id === 'string' ? gitLabInstanceById(args.id) : null;
    const baseUrl = normalizeBaseUrl(
      typeof args.baseUrl === 'string' && args.baseUrl.trim()
        ? args.baseUrl
        : (stored?.baseUrl ?? ''),
    );
    const caPath =
      typeof args.caPath === 'string' && args.caPath.trim() ? args.caPath.trim() : stored?.caPath;
    if (caPath && (!caPath.startsWith('/') || !existsSync(caPath) || !statSync(caPath).isFile())) {
      throw new CodeHostError('config', `No CA bundle file at ${caPath}`);
    }
    const token =
      typeof args.token === 'string' && args.token.trim()
        ? args.token.trim()
        : stored
          ? tokenForHost(stored)
          : '';
    if (!token) throw new CodeHostError('config', 'A personal access token is required');
    return testConnection({ baseUrl, token, caPath });
  });
}
