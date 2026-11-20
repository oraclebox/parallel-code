import { beforeEach, expect, it, vi } from 'vitest';
import { issueLinkFromUrl, linkTaskToIssueReference } from './issue-link';
import { readCodeHostIssue, resolveCodeHostProject } from './codehost';
import { invoke } from '../lib/ipc';
import { saveState } from './persistence';
import { IPC } from '../../electron/ipc/channels';
import type { CodeHostIssueRef, CodeHostIssueSummary } from '../ipc/types';

type MockTask = { githubUrl?: string; issue?: CodeHostIssueRef };

const mockStore = vi.hoisted(() => ({
  tasks: {} as Record<string, MockTask>,
}));
vi.mock('./core', () => ({
  store: mockStore,
  setStore: (
    _tasks: string,
    id: string,
    key: 'githubUrl' | 'issue',
    value: string | CodeHostIssueRef,
  ) => {
    Object.assign(mockStore.tasks[id], { [key]: value });
  },
}));
vi.mock('../lib/ipc', () => ({ invoke: vi.fn() }));
vi.mock('./codehost', () => ({
  readCodeHostIssue: vi.fn(),
  resolveCodeHostProject: vi.fn(),
}));
vi.mock('./persistence', () => ({ saveState: vi.fn() }));

const resolveGitHubRepository = vi.fn<(projectRoot: string) => Promise<string>>();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockImplementation((channel, args) =>
    channel === IPC.ResolveGitHubRepository
      ? resolveGitHubRepository((args as { projectRoot: string }).projectRoot)
      : Promise.reject(new Error(`unexpected channel ${channel}`)),
  );
  mockStore.tasks = { t: {} };
  resolveGitHubRepository.mockResolvedValue('acme/app');
  vi.mocked(resolveCodeHostProject).mockResolvedValue({
    hostKind: 'github',
    host: 'github.com',
    projectPath: 'acme/app',
  });
  vi.mocked(readCodeHostIssue).mockImplementation(
    async (url) =>
      ({
        kind: 'issue',
        url,
      }) as CodeHostIssueSummary,
  );
});

it('links a task whose prompt says #123 to that issue in the project repo', async () => {
  await linkTaskToIssueReference('t', '/p', 'fix #123 please');
  expect(resolveCodeHostProject).toHaveBeenCalledWith('/p');
  expect(readCodeHostIssue).toHaveBeenCalledWith('https://github.com/acme/app/issues/123');
  expect(mockStore.tasks.t.githubUrl).toBe('https://github.com/acme/app/issues/123');
  expect(mockStore.tasks.t.issue).toMatchObject({
    hostKind: 'github',
    host: 'github.com',
    projectPath: 'acme/app',
    iid: 123,
    kind: 'issue',
  });
  expect(saveState).toHaveBeenCalled();
});

it('keeps a link the task already has', async () => {
  mockStore.tasks.t.githubUrl = 'https://github.com/acme/app/issues/9';
  await linkTaskToIssueReference('t', '/p', 'fix #123');
  expect(resolveCodeHostProject).not.toHaveBeenCalled();
  expect(mockStore.tasks.t.githubUrl).toBe('https://github.com/acme/app/issues/9');
});

it('keeps a GitLab link the task already has', async () => {
  mockStore.tasks.t.issue = {
    hostKind: 'gitlab',
    host: 'gitlab.example.com',
    projectPath: 'group/app',
    iid: 9,
    kind: 'issue',
    url: 'https://gitlab.example.com/group/app/-/issues/9',
  };
  await linkTaskToIssueReference('t', '/p', 'fix #123');
  expect(readCodeHostIssue).not.toHaveBeenCalled();
});

it('leaves the task unlinked when the project is not on a code host', async () => {
  vi.mocked(resolveCodeHostProject).mockResolvedValue(null);
  resolveGitHubRepository.mockRejectedValue(new Error('no remote'));
  await linkTaskToIssueReference('t', '/p', 'fix #123');
  expect(mockStore.tasks.t.githubUrl).toBeUndefined();
  expect(mockStore.tasks.t.issue).toBeUndefined();
  expect(saveState).not.toHaveBeenCalled();
});

it('falls back to the GitHub CLI when the remotes do not resolve', async () => {
  vi.mocked(resolveCodeHostProject).mockRejectedValue(new Error('no git'));
  await linkTaskToIssueReference('t', '/p', 'fix #123');
  expect(resolveGitHubRepository).toHaveBeenCalledWith('/p');
  expect(mockStore.tasks.t.githubUrl).toBe('https://github.com/acme/app/issues/123');
});

it('skips a task closed while the project was resolved', async () => {
  vi.mocked(resolveCodeHostProject).mockImplementation(async () => {
    delete mockStore.tasks.t;
    return { hostKind: 'github', host: 'github.com', projectPath: 'acme/app' };
  });
  await linkTaskToIssueReference('t', '/p', 'fix #123');
  expect(saveState).not.toHaveBeenCalled();
});

it('does not link a pull request: the task works on its own branch, not that PR', async () => {
  await linkTaskToIssueReference('t', '/p', 'review https://github.com/acme/app/pull/123');
  expect(readCodeHostIssue).not.toHaveBeenCalled();
  expect(mockStore.tasks.t.githubUrl).toBeUndefined();
  expect(mockStore.tasks.t.issue).toBeUndefined();
  expect(saveState).not.toHaveBeenCalled();
});

it('does not link a number that is no issue in the repo', async () => {
  vi.mocked(readCodeHostIssue).mockRejectedValue(new Error('Not Found'));
  await linkTaskToIssueReference('t', '/p', 'fix #99999');
  expect(mockStore.tasks.t.githubUrl).toBeUndefined();
  expect(mockStore.tasks.t.issue).toBeUndefined();
});

it('links an issue URL in the prompt, even from another repo', async () => {
  await linkTaskToIssueReference(
    't',
    '/p',
    'Work on https://github.com/other/lib/issues/7#issuecomment-1 now',
  );
  expect(resolveCodeHostProject).not.toHaveBeenCalled();
  expect(readCodeHostIssue).toHaveBeenCalledWith('https://github.com/other/lib/issues/7');
  expect(mockStore.tasks.t.githubUrl).toBe('https://github.com/other/lib/issues/7');
});

it('links a GitLab issue without writing the GitHub-only field', async () => {
  vi.mocked(resolveCodeHostProject).mockResolvedValue({
    hostKind: 'gitlab',
    host: 'gitlab.example.com',
    projectPath: 'group/sub/app',
  });
  await linkTaskToIssueReference('t', '/p', 'fix #7');
  expect(readCodeHostIssue).toHaveBeenCalledWith(
    'https://gitlab.example.com/group/sub/app/-/issues/7',
  );
  expect(mockStore.tasks.t.githubUrl).toBeUndefined();
  expect(mockStore.tasks.t.issue).toMatchObject({
    hostKind: 'gitlab',
    host: 'gitlab.example.com',
    projectPath: 'group/sub/app',
    iid: 7,
  });
});

it('links a cross-project shorthand on the same GitLab instance', async () => {
  vi.mocked(resolveCodeHostProject).mockResolvedValue({
    hostKind: 'gitlab',
    host: 'gitlab.example.com',
    projectPath: 'group/app',
  });
  await linkTaskToIssueReference('t', '/p', 'see group/other#9 for context');
  expect(readCodeHostIssue).toHaveBeenCalledWith(
    'https://gitlab.example.com/group/other/-/issues/9',
  );
  expect(mockStore.tasks.t.issue).toMatchObject({ projectPath: 'group/other', iid: 9 });
});

it('ignores a cross-project shorthand when no code host resolves', async () => {
  vi.mocked(resolveCodeHostProject).mockResolvedValue(null);
  await linkTaskToIssueReference('t', '/p', 'see group/other#9');
  expect(readCodeHostIssue).not.toHaveBeenCalled();
  expect(mockStore.tasks.t.issue).toBeUndefined();
});

it('derives a link from a known issue URL for tasks that start from one', () => {
  expect(issueLinkFromUrl('https://gitlab.example.com/g/p/-/issues/4')).toMatchObject({
    hostKind: 'gitlab',
    projectPath: 'g/p',
    iid: 4,
  });
  expect(issueLinkFromUrl('https://github.com/acme/app/pull/8')).toBeUndefined();
  expect(issueLinkFromUrl(undefined)).toBeUndefined();
});
