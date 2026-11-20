/** Links a new task to the issue its prompt names, on GitHub or a configured GitLab. */
import {
  buildIssueUrl,
  extractBareIssueNumber,
  extractIssueUrl,
  parseCrossProjectRef,
  parseIssueUrl,
} from '../../electron/shared/codehost-refs';
import type { CodeHostIssueRef, CodeHostKind } from '../../electron/shared/codehost-types';
import { IPC } from '../../electron/ipc/channels';
import { invoke } from '../lib/ipc';
import { readCodeHostIssue, resolveCodeHostProject } from './codehost';
import { setStore, store } from './core';
import { saveState } from './persistence';

// Called from tasks.ts, so it invokes IPC itself: importing ./github's wrappers
// would close an import cycle (github → navigation → tasks).
const resolveGitHubRepository = (projectRoot: string) =>
  invoke<string>(IPC.ResolveGitHubRepository, { projectRoot });

/** The issue a known issue URL names, for tasks that start from one; PRs stay unlinked. */
export function issueLinkFromUrl(url: string | undefined): CodeHostIssueRef | undefined {
  if (!url) return undefined;
  const ref = parseIssueUrl(url);
  return ref?.kind === 'issue' ? ref : undefined;
}

/**
 * Sets the task's issue link from the issue its prompt names: an issue URL, a
 * `group/project#123` reference, or a `#123` / "issue 123" reference resolved
 * against the project's repository; only issues link, not PRs. Runs after
 * creation so lookups never delay task creation; a link the task already has
 * wins. GitHub links keep writing `githubUrl` for the GitHub-only views.
 */
export async function linkTaskToIssueReference(
  taskId: string,
  projectRoot: string,
  prompt: string,
): Promise<void> {
  const task = store.tasks[taskId];
  if (!task || task.githubUrl || task.issue) return;
  const ref = await issueRefInPrompt(projectRoot, prompt);
  // A rejection means the host is unavailable, unconfigured, or has no such
  // issue; an unconfirmed reference stays unlinked rather than dead.
  const issue = ref ? await readCodeHostIssue(ref.url).catch(() => null) : null;
  // A pull request is not linked: the task works on a fresh branch, and a
  // linked PR would read as the task's own (checks, merge), as in kanban.ts.
  const current = store.tasks[taskId];
  if (!ref || issue?.kind !== 'issue' || !current || current.githubUrl || current.issue) return;
  if (ref.hostKind === 'github') setStore('tasks', taskId, 'githubUrl', ref.url);
  setStore('tasks', taskId, 'issue', ref);
  void saveState();
}

/** The issue a prompt names, written out or as shorthand in the project's repository. */
async function issueRefInPrompt(
  projectRoot: string,
  prompt: string,
): Promise<CodeHostIssueRef | null> {
  const written = extractIssueUrl(prompt);
  // Rebuilt bare: the issue API rejects comment anchors, queries and subpaths.
  if (written) return written.kind === 'issue' ? written : null;
  const project = await resolveCodeHostProject(projectRoot).catch(() => null);
  const cross = parseCrossProjectRef(prompt);
  if (cross) {
    return project ? refFor(project.hostKind, project.host, cross.projectPath, cross.iid) : null;
  }
  const number = extractBareIssueNumber(prompt);
  if (number === null) return null;
  if (project) return refFor(project.hostKind, project.host, project.projectPath, number);
  // gh may still know the repository when the remotes are ambiguous or absent.
  const repository = await resolveGitHubRepository(projectRoot).catch(() => null);
  return repository ? refFor('github', 'github.com', repository, number) : null;
}

function refFor(
  hostKind: CodeHostKind,
  host: string,
  projectPath: string,
  iid: number,
): CodeHostIssueRef {
  return {
    hostKind,
    host,
    projectPath,
    iid,
    kind: 'issue',
    url: buildIssueUrl({ hostKind, host, projectPath }, iid),
  };
}
