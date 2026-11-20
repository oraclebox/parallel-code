/** Pure parsing of git remote URLs into host and repository path. */

export interface ParsedGitRemote {
  /** Lowercase hostname, with the port when the remote names one. */
  host: string;
  /** Lowercase hostname without any port. */
  hostname: string;
  /** `owner/repo` or `group[/subgroup]/project`, without a `.git` suffix. */
  path: string;
}

const HOST_RE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/i;
const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

function cleanPath(raw: string): string | null {
  const path = raw
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  const segments = path.split('/');
  if (segments.length < 2) return null;
  if (!segments.every((s) => SEGMENT_RE.test(s) && s !== '.' && s !== '..')) return null;
  return segments.join('/');
}

/** Splits `host:port` into its lowercase hostname and port. */
function splitHost(host: string): { host: string; hostname: string } | null {
  const lower = host.toLowerCase();
  if (!HOST_RE.test(lower)) return null;
  const colon = lower.lastIndexOf(':');
  const hostname = colon === -1 ? lower : lower.slice(0, colon);
  return { host: lower, hostname };
}

/**
 * Parses `https://`, `ssh://` and scp-style (`git@host:group/proj.git`)
 * remote URLs. Returns null for anything that does not name a host and at
 * least two path segments, so a remote never resolves to a bogus project.
 */
export function parseGitRemoteUrl(remote: string): ParsedGitRemote | null {
  const raw = remote.trim();
  if (!raw) return null;
  if (!raw.includes('://')) {
    // scp-style: [user@]host:path — reject Windows drive paths such as C:\repo.
    const match = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/.exec(raw);
    if (!match || /^[a-z]$/i.test(match[1])) return null;
    const host = splitHost(match[1]);
    const path = cleanPath(match[2]);
    return host && path ? { ...host, path } : null;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:' && url.protocol !== 'ssh:') return null;
  // Embedded credentials would leak into logs and URLs we build; ssh may carry a user.
  if (url.password) return null;
  if ((url.protocol === 'https:' || url.protocol === 'http:') && url.username) return null;
  if (url.search || url.hash) return null;
  const host = splitHost(url.host);
  const path = cleanPath(url.pathname);
  return host && path ? { ...host, path } : null;
}
