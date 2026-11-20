/** Resolves a project folder to its code host from the git remotes. */
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { CodeHostProject } from '../shared/codehost-types.js';
import { isGitHubHost } from '../shared/codehost-refs.js';
import { parseGitRemoteUrl } from '../shared/remote-url.js';
import { gitLabHostnames } from './settings.js';

const exec = promisify(execFile);

export interface RemoteEntry {
  name: string;
  url: string;
}

/**
 * Picks the project's code host from its remotes. `origin` wins; otherwise the
 * one unambiguous match. Several different hosts return null rather than
 * guessing, so the UI can ask instead of linking the wrong repository.
 */
export function matchCodeHostProject(
  remotes: readonly RemoteEntry[],
  gitlabHostnames: readonly string[],
): CodeHostProject | null {
  const instances = new Set(gitlabHostnames.map((host) => host.toLowerCase()));
  const matches: CodeHostProject[] = [];
  const seen = new Set<string>();
  let origin: CodeHostProject | null = null;
  for (const remote of remotes) {
    const parsed = parseGitRemoteUrl(remote.url);
    if (!parsed) continue;
    let project: CodeHostProject;
    if (isGitHubHost(parsed.hostname)) {
      // GitHub repositories have exactly owner/repo; deeper paths are not repos.
      if (parsed.path.split('/').length !== 2) continue;
      project = { hostKind: 'github', host: 'github.com', projectPath: parsed.path };
    } else if (instances.has(parsed.hostname)) {
      project = { hostKind: 'gitlab', host: parsed.host, projectPath: parsed.path };
    } else {
      continue;
    }
    const key = `${project.hostKind}:${project.host}:${project.projectPath.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (remote.name === 'origin' && !origin) origin = project;
    matches.push(project);
  }
  if (origin) return origin;
  return matches.length === 1 ? matches[0] : null;
}

/** `git remote -v` as name/URL pairs, origin first, fetch URLs preferred. */
export async function readRemotes(projectRoot: string): Promise<RemoteEntry[]> {
  const { stdout } = await exec('git', ['remote', '-v'], {
    cwd: projectRoot,
    timeout: 5_000,
    maxBuffer: 256 * 1024,
  });
  const byName = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim());
    if (!match) continue;
    const [, name, url, kind] = match;
    if (kind === 'push' && byName.has(name)) continue;
    if (!byName.has(name)) byName.set(name, url);
  }
  return [...byName]
    .map(([name, url]) => ({ name, url }))
    .sort((a, b) =>
      a.name === 'origin' ? -1 : b.name === 'origin' ? 1 : a.name.localeCompare(b.name),
    );
}

export async function resolveCodeHostProject(projectRoot: string): Promise<CodeHostProject | null> {
  const remotes = await readRemotes(projectRoot).catch(() => []);
  if (remotes.length === 0) return null;
  return matchCodeHostProject(remotes, gitLabHostnames());
}
