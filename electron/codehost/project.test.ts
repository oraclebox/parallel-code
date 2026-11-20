import { describe, expect, it } from 'vitest';
import { matchCodeHostProject, type RemoteEntry } from './project.js';

const remote = (name: string, url: string): RemoteEntry => ({ name, url });
const GITLAB = ['gitlab.hk.oocl.com', 'gitlab.sg.oocl.com'];

describe('matchCodeHostProject', () => {
  it('prefers origin over other matching remotes', () => {
    expect(
      matchCodeHostProject(
        [
          remote('upstream', 'git@gitlab.sg.oocl.com:team/app.git'),
          remote('origin', 'git@gitlab.hk.oocl.com:team/app.git'),
        ],
        GITLAB,
      ),
    ).toEqual({ hostKind: 'gitlab', host: 'gitlab.hk.oocl.com', projectPath: 'team/app' });
  });

  it('accepts a single non-origin match', () => {
    expect(
      matchCodeHostProject(
        [
          remote('upstream', 'https://github.com/acme/app.git'),
          remote('origin', 'https://bitbucket.example.com/team/app.git'),
        ],
        GITLAB,
      ),
    ).toEqual({ hostKind: 'github', host: 'github.com', projectPath: 'acme/app' });
  });

  it('does not guess between several matching hosts', () => {
    expect(
      matchCodeHostProject(
        [
          remote('a', 'git@gitlab.hk.oocl.com:team/app.git'),
          remote('b', 'git@gitlab.sg.oocl.com:team/app.git'),
        ],
        GITLAB,
      ),
    ).toBeNull();
  });

  it('ignores hosts without a configured instance', () => {
    expect(
      matchCodeHostProject([remote('origin', 'git@gitlab.other.com:team/app.git')], GITLAB),
    ).toBeNull();
  });

  it('keeps sub-group paths for GitLab and rejects them for GitHub', () => {
    expect(
      matchCodeHostProject([remote('origin', 'git@gitlab.hk.oocl.com:group/sub/app.git')], GITLAB),
    ).toEqual({
      hostKind: 'gitlab',
      host: 'gitlab.hk.oocl.com',
      projectPath: 'group/sub/app',
    });
    expect(
      matchCodeHostProject([remote('origin', 'git@github.com:group/sub/app.git')], GITLAB),
    ).toBeNull();
  });

  it('matches non-default ports against the instance hostname', () => {
    expect(
      matchCodeHostProject(
        [remote('origin', 'ssh://git@gitlab.hk.oocl.com:2222/team/app.git')],
        GITLAB,
      ),
    ).toEqual({
      hostKind: 'gitlab',
      host: 'gitlab.hk.oocl.com:2222',
      projectPath: 'team/app',
    });
  });
});
