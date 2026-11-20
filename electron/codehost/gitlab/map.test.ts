import { describe, expect, it } from 'vitest';
import type { CodeHostProject } from '../../shared/codehost-types.js';
import { mapGitLabResponseError } from './client.js';
import { mapGitLabIssue, mapGitLabWorkItem } from './issues.js';

const project: CodeHostProject = {
  hostKind: 'gitlab',
  host: 'gitlab.hk.oocl.com',
  projectPath: 'group/sub/app',
};

const rawIssue = {
  iid: 12,
  title: 'Crash on export',
  description: 'Steps to reproduce…',
  web_url: 'https://gitlab.hk.oocl.com/group/sub/app/-/issues/12#note_1',
  state: 'opened',
  author: { username: 'roger' },
  updated_at: '2026-11-19T10:00:00Z',
  labels: ['bug', 'priority::high'],
};

describe('mapGitLabIssue', () => {
  it('maps IIDs, state, labels and canonicalizes the URL', () => {
    expect(mapGitLabIssue(rawIssue, project)).toEqual({
      kind: 'issue',
      hostKind: 'gitlab',
      host: 'gitlab.hk.oocl.com',
      projectPath: 'group/sub/app',
      iid: 12,
      title: 'Crash on export',
      description: 'Steps to reproduce…',
      url: 'https://gitlab.hk.oocl.com/group/sub/app/-/issues/12',
      state: 'open',
      author: 'roger',
      updatedAt: '2026-11-19T10:00:00Z',
      labels: ['bug', 'priority::high'],
    });
  });

  it('maps closed issues and tolerates missing optional fields', () => {
    expect(
      mapGitLabIssue(
        { iid: 3, title: 'x', web_url: 'https://h/g/p/-/issues/3', state: 'closed' },
        project,
      ),
    ).toMatchObject({
      state: 'closed',
      author: 'unknown',
      labels: [],
    });
  });

  it('rejects payloads without an IID, title or URL', () => {
    expect(() => mapGitLabIssue({ iid: 1, title: 'x' }, project)).toThrow(/IID/);
    expect(() => mapGitLabIssue({ iid: 1, web_url: 'https://h/g/p/-/issues/1' }, project)).toThrow(
      /IID/,
    );
  });

  it('derives picker work items', () => {
    expect(mapGitLabWorkItem(rawIssue, project)).toMatchObject({
      kind: 'issue',
      hostKind: 'gitlab',
      number: 12,
      title: 'Crash on export',
      url: 'https://gitlab.hk.oocl.com/group/sub/app/-/issues/12',
    });
  });
});

describe('mapGitLabResponseError', () => {
  it.each([
    [401, 'auth'],
    [403, 'forbidden'],
    [404, 'notfound'],
    [429, 'ratelimit'],
    [502, 'network'],
  ] as const)('maps %i to %s', (status, kind) => {
    expect(mapGitLabResponseError(status, { message: 'nope' }).kind).toBe(kind);
  });

  it('keeps the server detail in the message', () => {
    expect(mapGitLabResponseError(400, { message: 'bad state' }).message).toContain('bad state');
  });
});
