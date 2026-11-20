/** Minimal GitLab REST v4 client with custom CA and env-proxy support. */
import { readFileSync } from 'fs';
import { Agent, EnvHttpProxyAgent, fetch, type Dispatcher } from 'undici';
import { CodeHostError } from '../errors.js';

export interface GitLabTarget {
  baseUrl: string;
  token: string;
  caPath?: string;
}

const REQUEST_TIMEOUT_MS = 30_000;
const dispatchers = new Map<string, Dispatcher>();

function proxyConfigured(): boolean {
  return ['https_proxy', 'HTTPS_PROXY', 'http_proxy', 'HTTP_PROXY'].some(
    (name) => !!process.env[name],
  );
}

function dispatcherFor(caPath: string | undefined): Dispatcher {
  const key = `${caPath ?? ''}|${proxyConfigured() ? 'proxy' : 'direct'}`;
  const cached = dispatchers.get(key);
  if (cached) return cached;
  let ca: Buffer | undefined;
  if (caPath) {
    try {
      ca = readFileSync(caPath);
    } catch {
      throw new CodeHostError('config', `Could not read the CA bundle at ${caPath}`);
    }
  }
  const options = ca ? { connect: { ca } } : {};
  const dispatcher = proxyConfigured() ? new EnvHttpProxyAgent(options) : new Agent(options);
  dispatchers.set(key, dispatcher);
  return dispatcher;
}

/** `GET /api/v4/...` URL with defined query parameters only. */
export function apiUrl(
  target: Pick<GitLabTarget, 'baseUrl'>,
  path: string,
  params?: Record<string, string | number | undefined>,
): string {
  const url = new URL(`${target.baseUrl.replace(/\/+$/, '')}/api/v4${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function errorDetail(body: unknown): string {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  const message = record?.message ?? record?.error;
  if (typeof message === 'string') return message;
  return message ? JSON.stringify(message) : '';
}

export function mapGitLabResponseError(status: number, body: unknown): CodeHostError {
  const detail = errorDetail(body);
  switch (status) {
    case 401:
      return new CodeHostError(
        'auth',
        'GitLab rejected the token. Check the personal access token and whether it expired.',
      );
    case 403:
      return new CodeHostError(
        'forbidden',
        'GitLab denied access. The token needs the read_api scope and access to the project.',
      );
    case 404:
      return new CodeHostError(
        'notfound',
        'Not found on GitLab. Check the project path and that the token can see the project.',
      );
    case 429:
      return new CodeHostError(
        'ratelimit',
        'GitLab rate limit reached. Try again in a few minutes.',
      );
    default:
      return new CodeHostError(
        status >= 500 ? 'network' : 'forbidden',
        `GitLab request failed (${status})${detail ? `: ${detail}` : ''}`,
      );
  }
}

export interface GitLabResponse<T> {
  data: T;
  /** `X-Next-Page` when GitLab has another page; null on the last page. */
  nextPage: number | null;
}

export async function gitlabRequest<T>(
  target: GitLabTarget,
  path: string,
  params?: Record<string, string | number | undefined>,
  method: 'GET' | 'POST' = 'GET',
): Promise<GitLabResponse<T>> {
  const url = apiUrl(target, path, params);
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(url, {
      method,
      headers: {
        'PRIVATE-TOKEN': target.token,
        Accept: 'application/json',
      },
      dispatcher: dispatcherFor(target.caPath),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof CodeHostError) throw err;
    const host = new URL(target.baseUrl).host;
    const message = err instanceof Error ? err.message : String(err);
    throw new CodeHostError('network', `Could not reach ${host}: ${message}`);
  }
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) throw mapGitLabResponseError(response.status, body);
  const nextHeader = response.headers.get('x-next-page');
  const nextPage = nextHeader && /^\d+$/.test(nextHeader) ? Number(nextHeader) : null;
  return { data: body as T, nextPage: nextPage && nextPage > 0 ? nextPage : null };
}
