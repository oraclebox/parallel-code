import { describe, expect, it } from 'vitest';
import { parseGitRemoteUrl } from './remote-url.js';

describe('parseGitRemoteUrl', () => {
  it.each([
    ['https://github.com/acme/app.git', 'github.com', 'github.com', 'acme/app'],
    ['https://github.com/acme/app', 'github.com', 'github.com', 'acme/app'],
    [
      'http://gitlab.hk.oocl.com:8080/group/sub/project.git',
      'gitlab.hk.oocl.com:8080',
      'gitlab.hk.oocl.com',
      'group/sub/project',
    ],
    [
      'git@gitlab.hk.oocl.com:group/project.git',
      'gitlab.hk.oocl.com',
      'gitlab.hk.oocl.com',
      'group/project',
    ],
    [
      'git@gitlab.hk.oocl.com:group/sub/project',
      'gitlab.hk.oocl.com',
      'gitlab.hk.oocl.com',
      'group/sub/project',
    ],
    [
      'ssh://git@gitlab.hk.oocl.com:2222/group/project.git',
      'gitlab.hk.oocl.com:2222',
      'gitlab.hk.oocl.com',
      'group/project',
    ],
  ])('parses %s', (remote, host, hostname, path) => {
    expect(parseGitRemoteUrl(remote)).toEqual({ host, hostname, path });
  });

  it.each([
    '',
    'not a remote',
    'https://github.com/acme',
    'https://user:token@github.com/acme/app.git',
    'https://github.com/acme/app.git?ref=main',
    'C:\\repo',
    'file:///srv/repo',
    'https://github.com/../app',
  ])('rejects %s', (remote) => {
    expect(parseGitRemoteUrl(remote)).toBeNull();
  });
});
