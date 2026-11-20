/** Renderer side of the code-host surface: GitLab REST and the GitHub adapter. */
import { createSignal } from 'solid-js';
import { IPC } from '../../electron/ipc/channels';
import { invoke } from '../lib/ipc';
import type {
  CodeHostActivityPage,
  CodeHostHostInput,
  CodeHostHostsSnapshot,
  CodeHostInstance,
  CodeHostIssuePage,
  CodeHostIssueQuery,
  CodeHostIssueSummary,
  CodeHostProject,
  CodeHostTestResult,
  CodeHostWorkItem,
} from '../ipc/types';

/** The project's code host as its git remotes name it; null when none matches. */
export function resolveCodeHostProject(projectRoot: string): Promise<CodeHostProject | null> {
  return invoke(IPC.ResolveCodehostProject, { projectRoot });
}

export function listCodeHostWorkItems(
  projectRoot: string,
  search?: string,
): Promise<CodeHostWorkItem[]> {
  return invoke(IPC.ListCodehostWorkItems, { projectRoot, search });
}

export function browseCodeHostIssues(
  projectRoot: string,
  query: CodeHostIssueQuery,
): Promise<CodeHostIssuePage> {
  return invoke(IPC.BrowseCodehostIssues, { projectRoot, ...query });
}

export function readCodeHostIssue(url: string): Promise<CodeHostIssueSummary> {
  return invoke(IPC.ReadCodehostIssue, { url });
}

export function readCodeHostIssueActivity(
  url: string,
  page: number,
): Promise<CodeHostActivityPage> {
  return invoke(IPC.ReadCodehostIssueActivity, { url, page });
}

export function listCodeHostHosts(): Promise<CodeHostHostsSnapshot> {
  return invoke(IPC.CodehostListHosts);
}

export function saveCodeHostHost(input: CodeHostHostInput): Promise<CodeHostInstance> {
  return invoke(IPC.CodehostSaveHost, { ...input });
}

export function deleteCodeHostHost(id: string): Promise<boolean> {
  return invoke(IPC.CodehostDeleteHost, { id });
}

export function testCodeHostHost(
  input: Pick<CodeHostHostInput, 'id' | 'baseUrl' | 'token' | 'caPath'>,
): Promise<CodeHostTestResult> {
  return invoke(IPC.CodehostTestHost, { ...input });
}

// A failed check may be passing trouble (git missing, offline, a host added in
// Settings since), so it is asked again once this old, on the next read.
const RECHECK_FAILED_MS = 60_000;
// A success is kept until restart; remotes seldom change and each check runs git.
// Per folder: true, or when its check last failed.
const [projectChecks, setProjectChecks] = createSignal<Record<string, true | number>>({});
const pendingProjectChecks = new Set<string>();

function recordProjectCheck(projectRoot: string, result: true | number): void {
  pendingProjectChecks.delete(projectRoot);
  setProjectChecks((checks) => ({ ...checks, [projectRoot]: result }));
}

/** Forgets every answer after hosts are added or removed in Settings. */
export function clearCodeHostProjectChecks(): void {
  pendingProjectChecks.clear();
  setProjectChecks({});
}

/** Whether the folder belongs to a GitHub or configured GitLab repo; undefined while asked. */
export function isCodeHostProject(projectRoot: string): boolean | undefined {
  const known = projectChecks()[projectRoot];
  if (known === true) return true;
  if (pendingProjectChecks.has(projectRoot)) return known === undefined ? undefined : false;
  if (known !== undefined && Date.now() - known < RECHECK_FAILED_MS) return false;
  pendingProjectChecks.add(projectRoot);
  // A failure is an answer too: no git, no matching remote, or offline.
  void resolveCodeHostProject(projectRoot).then(
    (project) => recordProjectCheck(projectRoot, project ? true : Date.now()),
    () => recordProjectCheck(projectRoot, Date.now()),
  );
  return known === undefined ? undefined : false;
}
