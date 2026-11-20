/** Pure code-host types shared by the main process and the renderer. */

export type CodeHostKind = 'github' | 'gitlab';

/** A configured host instance as the renderer sees it; tokens never cross IPC. */
export interface CodeHostInstance {
  id: string;
  kind: CodeHostKind;
  label: string;
  baseUrl: string;
  username?: string;
  caPath?: string;
  hasToken: boolean;
}

/** Editable fields of a host instance; `token` is omitted to keep the stored one. */
export interface CodeHostHostInput {
  id?: string;
  kind: CodeHostKind;
  label: string;
  baseUrl: string;
  username?: string;
  token?: string;
  caPath?: string;
}

export interface CodeHostHostsSnapshot {
  instances: CodeHostInstance[];
  /** False when the OS keyring is unavailable and tokens are stored in plaintext. */
  encryptionAvailable: boolean;
}

export interface CodeHostTestResult {
  login: string;
  name?: string;
}

/** A repository as resolved from the project's git remotes. */
export interface CodeHostProject {
  hostKind: CodeHostKind;
  /** Remote host, hostname with an explicit port when the remote names one. */
  host: string;
  /** `owner/repo` for GitHub, `group[/subgroup]/project` for GitLab. */
  projectPath: string;
}

export interface CodeHostIssueRef extends CodeHostProject {
  iid: number;
  url: string;
  kind: 'issue' | 'pr';
}

/** An open issue (or pull request) offered as a starting point for a task. */
export interface CodeHostWorkItem {
  kind: 'issue' | 'pr';
  hostKind: CodeHostKind;
  /** Issue IID on GitLab, issue/PR number on GitHub. */
  number: number;
  title: string;
  url: string;
  author: string;
  updatedAt: string;
  labels: string[];
  /** GitHub-only fields; kept so the picker can show draft state. */
  isDraft?: boolean;
}

export type CodeHostIssueState = 'open' | 'closed' | 'merged';

export interface CodeHostIssueSummary {
  kind: 'issue' | 'pr';
  hostKind: CodeHostKind;
  host: string;
  projectPath: string;
  iid: number;
  title: string;
  description: string;
  url: string;
  state: CodeHostIssueState;
  author: string;
  updatedAt: string;
  labels: string[];
}

export interface CodeHostIssueQuery {
  search: string;
  state: 'open' | 'closed' | 'all';
  page: number;
}

export interface CodeHostIssuePage {
  project: CodeHostProject;
  items: CodeHostIssueSummary[];
  hasMore: boolean;
}

export interface CodeHostActivityEntry {
  id: string;
  author: string;
  createdAt: string;
  event: string;
  body: string;
}

export interface CodeHostActivityPage {
  items: CodeHostActivityEntry[];
  hasMore: boolean;
}
