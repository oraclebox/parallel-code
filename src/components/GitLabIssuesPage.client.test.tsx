import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { GitLabIssuesPage } from './GitLabIssuesPage';
import {
  browseCodeHostIssues,
  readCodeHostIssue,
  readCodeHostIssueActivity,
} from '../store/codehost';
import { openGitHubIssues } from '../store/github';
import type { CodeHostIssuePage, CodeHostIssueSummary } from '../ipc/types';

vi.mock('../store/codehost', () => ({
  browseCodeHostIssues: vi.fn(),
  readCodeHostIssue: vi.fn(),
  readCodeHostIssueActivity: vi.fn(),
}));
vi.mock('../store/github', () => ({ openGitHubIssues: vi.fn() }));

const summary: CodeHostIssueSummary = {
  kind: 'issue',
  hostKind: 'gitlab',
  host: 'gitlab.example.com',
  projectPath: 'group/app',
  iid: 7,
  title: 'Fix broken save',
  description: 'Repro **steps**',
  url: 'https://gitlab.example.com/group/app/-/issues/7',
  state: 'open',
  author: 'alice',
  updatedAt: '2026-11-01T10:00:00Z',
  labels: ['bug'],
};

const page: CodeHostIssuePage = {
  project: { hostKind: 'gitlab', host: 'gitlab.example.com', projectPath: 'group/app' },
  items: [summary],
  hasMore: false,
};

let dispose: (() => void) | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(browseCodeHostIssues).mockResolvedValue(page);
  vi.mocked(readCodeHostIssue).mockResolvedValue(summary);
  vi.mocked(readCodeHostIssueActivity).mockResolvedValue({
    items: [
      {
        id: 'n1',
        author: 'bob',
        createdAt: '2026-11-02T10:00:00Z',
        event: 'commented',
        body: 'Looks good',
      },
    ],
    hasMore: false,
  });
  host = document.createElement('div');
  document.body.append(host);
  dispose = render(
    () => (
      <GitLabIssuesPage project={{ id: 'p1', name: 'Repo', path: '/repo', color: '#ffffff' }} />
    ),
    host,
  );
});

afterEach(() => {
  dispose?.();
  host.remove();
});

describe('GitLabIssuesPage', () => {
  it('lists issues with their state, iid and author', async () => {
    await vi.waitFor(() => expect(host.textContent).toContain('Fix broken save'));
    expect(browseCodeHostIssues).toHaveBeenCalledWith('/repo', {
      search: '',
      state: 'open',
      page: 1,
    });
    const meta = host.querySelector('.github-issue-row-meta');
    expect(meta?.textContent).toContain('#7');
    expect(meta?.textContent).toContain('@alice');
    expect(host.textContent).toContain('gitlab.example.com/group/app');
  });

  it('opens the first issue and its notes', async () => {
    await vi.waitFor(() => expect(host.textContent).toContain('Repro'));
    expect(readCodeHostIssue).toHaveBeenCalledWith(summary.url);
    await vi.waitFor(() => expect(host.textContent).toContain('Looks good'));
    expect(readCodeHostIssueActivity).toHaveBeenCalledWith(summary.url, 1);
  });

  it('asks the other state when the filter changes', async () => {
    await vi.waitFor(() => expect(browseCodeHostIssues).toHaveBeenCalled());
    const select = host.querySelector<HTMLSelectElement>('select');
    if (!select) throw new Error('Missing state filter');
    select.value = 'closed';
    select.dispatchEvent(new Event('change'));
    await vi.waitFor(() =>
      expect(browseCodeHostIssues).toHaveBeenLastCalledWith('/repo', {
        search: '',
        state: 'closed',
        page: 1,
      }),
    );
  });

  it('closes back to the tasks', async () => {
    await vi.waitFor(() => expect(browseCodeHostIssues).toHaveBeenCalled());
    [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Tasks'))?.click();
    expect(openGitHubIssues).toHaveBeenCalledWith(null);
  });

  it('shows a load failure inline', async () => {
    dispose?.();
    host.replaceChildren();
    vi.mocked(browseCodeHostIssues).mockRejectedValue(new Error('Token expired'));
    dispose = render(
      () => (
        <GitLabIssuesPage project={{ id: 'p1', name: 'Repo', path: '/repo', color: '#ffffff' }} />
      ),
      host,
    );
    await vi.waitFor(() => expect(host.textContent).toContain('Token expired'));
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });
});
