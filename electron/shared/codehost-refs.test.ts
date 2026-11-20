import { describe, expect, it } from 'vitest';
import {
  buildIssueUrl,
  extractBareIssueNumber,
  extractIssueUrl,
  parseCrossProjectRef,
  parseGitHubIssueUrl,
  parseGitLabIssueUrl,
  parseIssueUrl,
} from './codehost-refs.js';

describe('parseGitHubIssueUrl', () => {
  it('parses issue and pull URLs on github.com', () => {
    expect(parseGitHubIssueUrl('https://github.com/acme/app/issues/12')).toMatchObject({
      hostKind: 'github',
      host: 'github.com',
      projectPath: 'acme/app',
      iid: 12,
      kind: 'issue',
      url: 'https://github.com/acme/app/issues/12',
    });
    expect(parseGitHubIssueUrl('https://www.github.com/acme/app/pull/8/')).toMatchObject({
      iid: 8,
      kind: 'pr',
      url: 'https://github.com/acme/app/issues/8',
    });
  });

  it('rejects other hosts and subpaths', () => {
    expect(parseGitHubIssueUrl('https://gitlab.com/acme/app/issues/1')).toBeNull();
    expect(parseGitHubIssueUrl('https://github.com/acme/app/issues/1/comments')).toBeNull();
    expect(parseGitHubIssueUrl('https://github.com/acme/app/issues/0')).toBeNull();
  });
});

describe('parseGitLabIssueUrl', () => {
  it('parses canonical URLs with sub-groups', () => {
    expect(
      parseGitLabIssueUrl('https://gitlab.hk.oocl.com/group/sub/project/-/issues/42'),
    ).toMatchObject({
      hostKind: 'gitlab',
      host: 'gitlab.hk.oocl.com',
      projectPath: 'group/sub/project',
      iid: 42,
    });
  });

  it('parses the legacy path form', () => {
    expect(parseGitLabIssueUrl('https://gitlab.hk.oocl.com/group/project/issues/7')).toMatchObject({
      projectPath: 'group/project',
      iid: 7,
    });
  });

  it('ignores decorations and rejects merge requests', () => {
    expect(parseGitLabIssueUrl('https://gitlab.hk.oocl.com/g/p/-/issues/3#note_1')?.iid).toBe(3);
    expect(parseGitLabIssueUrl('https://gitlab.hk.oocl.com/g/p/-/merge_requests/3')).toBeNull();
  });

  it('is recognized through the generic parser', () => {
    expect(parseIssueUrl('https://gitlab.hk.oocl.com/g/p/-/issues/9')?.hostKind).toBe('gitlab');
  });
});

describe('buildIssueUrl', () => {
  it('builds host-specific URLs', () => {
    expect(
      buildIssueUrl({ hostKind: 'gitlab', host: 'gitlab.example.com', projectPath: 'a/b/c' }, 5),
    ).toBe('https://gitlab.example.com/a/b/c/-/issues/5');
    expect(
      buildIssueUrl({ hostKind: 'github', host: 'www.github.com', projectPath: 'a/b' }, 5),
    ).toBe('https://github.com/a/b/issues/5');
  });
});

describe('extractIssueUrl', () => {
  it('finds the first issue URL in prose, ignoring decoration', () => {
    expect(
      extractIssueUrl('See https://gitlab.example.com/g/p/-/issues/11, then fix it.'),
    ).toMatchObject({ iid: 11, url: 'https://gitlab.example.com/g/p/-/issues/11' });
    expect(extractIssueUrl('no links here #12')).toBeNull();
  });

  it('does not treat a pull URL as an issue URL', () => {
    expect(extractIssueUrl('https://github.com/a/b/pull/4')).toMatchObject({ kind: 'pr', iid: 4 });
  });
});

describe('extractBareIssueNumber', () => {
  it('finds one shorthand reference', () => {
    expect(extractBareIssueNumber('fix #123 please')).toBe(123);
    expect(extractBareIssueNumber('issue 45 is broken')).toBe(45);
  });

  it('ignores CSS colours, fragments and multiple refs', () => {
    expect(extractBareIssueNumber('color: #333')).toBeNull();
    expect(extractBareIssueNumber('https://x.test/a#7')).toBeNull();
    expect(extractBareIssueNumber('fix #1 and #2')).toBeNull();
    expect(extractBareIssueNumber('#1 priority')).toBeNull();
  });
});

describe('parseCrossProjectRef', () => {
  it('parses group/project#IID and sub-groups', () => {
    expect(parseCrossProjectRef('fix group/project#5')).toEqual({
      projectPath: 'group/project',
      iid: 5,
    });
    expect(parseCrossProjectRef('see group/sub/project#9')).toEqual({
      projectPath: 'group/sub/project',
      iid: 9,
    });
  });

  it('does not match URLs or multiple refs', () => {
    expect(parseCrossProjectRef('https://host.test/group/project#5')).toBeNull();
    expect(parseCrossProjectRef('group/a#1 and group/b#2')).toBeNull();
  });
});
