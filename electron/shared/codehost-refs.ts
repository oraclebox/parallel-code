/** Pure issue-reference parsing shared by main and renderer. */
import type { CodeHostIssueRef, CodeHostKind, CodeHostProject } from './codehost-types.js';

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);

export function isGitHubHost(hostname: string): boolean {
  return GITHUB_HOSTS.has(hostname.toLowerCase());
}

function iid(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function canonicalHost(host: string): string {
  return host.toLowerCase() === 'www.github.com' ? 'github.com' : host.toLowerCase();
}

/** Canonical browse URL for an issue ref; used for display and canonicalization. */
export function buildIssueUrl(
  project: Pick<CodeHostProject, 'hostKind' | 'host' | 'projectPath'>,
  iidValue: number,
): string {
  const host = canonicalHost(project.host);
  return project.hostKind === 'gitlab'
    ? `https://${host}/${project.projectPath}/-/issues/${iidValue}`
    : `https://${host}/${project.projectPath}/issues/${iidValue}`;
}

function makeRef(
  hostKind: CodeHostKind,
  host: string,
  projectPath: string,
  number: number,
  kind: CodeHostIssueRef['kind'],
): CodeHostIssueRef {
  return {
    hostKind,
    host: canonicalHost(host),
    projectPath,
    iid: number,
    kind,
    url: buildIssueUrl({ hostKind, host: canonicalHost(host), projectPath }, number),
  };
}

function parseUrl(url: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.username || parsed.password) return null;
  return parsed;
}

/** `https://github.com/owner/repo/issues/123` or `/pull/123`. */
export function parseGitHubIssueUrl(url: string): CodeHostIssueRef | null {
  const parsed = parseUrl(url);
  if (!parsed || !isGitHubHost(parsed.hostname)) return null;
  const match = /^\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/([1-9]\d*)\/?$/.exec(parsed.pathname);
  if (!match) return null;
  const number = iid(match[4]);
  if (number === null) return null;
  const projectPath = `${match[1]}/${match[2]}`;
  return makeRef('github', 'github.com', projectPath, number, match[3] === 'pull' ? 'pr' : 'issue');
}

/**
 * GitLab issue URLs: canonical `/-/issues/1` and legacy `/issues/1`, with
 * sub-groups. Any host is accepted; callers match it against configured instances.
 */
export function parseGitLabIssueUrl(url: string): CodeHostIssueRef | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const segments = parsed.pathname.split('/').filter(Boolean);
  const marker = segments.lastIndexOf('-');
  let projectSegments: string[];
  let iidSegment: string | undefined;
  if (marker >= 2 && segments[marker + 1] === 'issues' && segments.length === marker + 3) {
    projectSegments = segments.slice(0, marker);
    iidSegment = segments[marker + 2];
  } else if (segments.length >= 4 && segments[segments.length - 2] === 'issues') {
    projectSegments = segments.slice(0, -2);
    iidSegment = segments[segments.length - 1];
  } else {
    return null;
  }
  if (projectSegments.length < 2) return null;
  if (!projectSegments.every((s) => /^[\w.-]+$/.test(s) && s !== '.' && s !== '..')) return null;
  const number = iidSegment === undefined ? null : iid(iidSegment);
  if (number === null) return null;
  return makeRef('gitlab', parsed.host, projectSegments.join('/'), number, 'issue');
}

/** Recognizes a GitHub or GitLab issue/PR URL, GitHub first. */
export function parseIssueUrl(url: string): CodeHostIssueRef | null {
  return parseGitHubIssueUrl(url) ?? parseGitLabIssueUrl(url);
}

const URL_RE = /https?:\/\/[^\s)>\]"']+/gi;

/** The first issue URL embedded in a prompt, canonicalized. */
export function extractIssueUrl(text: string): CodeHostIssueRef | null {
  for (const match of text.matchAll(URL_RE)) {
    // Trailing sentence punctuation is not part of the URL.
    const parsed = parseIssueUrl(match[0].replace(/[.,;:!?]+$/, ''));
    if (parsed) return parsed;
  }
  return null;
}

// `#123` not glued to a word, `&` (HTML entity) or `/` (URL fragment), nor after
// a colon (CSS `color: #333`) or before "priority" (an ordinal); or "issue 123".
const ISSUE_REFERENCE_RE = /(?<!:\s*)(?:^|[^\w&/:])#(\d+)\b(?!\s+priority\b)|\bissue\s+#?(\d+)\b/gi;

/** The one issue number a prompt names in shorthand (`#123`, "issue 123"). */
export function extractBareIssueNumber(text: string): number | null {
  const numbers = new Set(
    [...text.matchAll(ISSUE_REFERENCE_RE)].map((m) => Number(m[1] ?? m[2])).filter((n) => n > 0),
  );
  return numbers.size === 1 ? [...numbers][0] : null;
}

// `group[/subgroup]/project#123`, not glued to a URL or another word.
const CROSS_PROJECT_RE = /(?<![\w/&:.])([\w.-]+(?:\/[\w.-]+)+)#([1-9]\d*)\b/g;

/** A cross-project shorthand such as `group/project#123`; only one per prompt. */
export function parseCrossProjectRef(text: string): { projectPath: string; iid: number } | null {
  const matches = new Map<string, { projectPath: string; iid: number }>();
  for (const match of text.matchAll(CROSS_PROJECT_RE)) {
    const number = iid(match[2]);
    if (number === null) continue;
    matches.set(match[1], { projectPath: match[1], iid: number });
  }
  return matches.size === 1 ? [...matches.values()][0] : null;
}
