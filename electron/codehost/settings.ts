/**
 * Configured code-host instances. Tokens are encrypted with Electron's
 * safeStorage when the OS keyring is available; the file itself never leaves
 * the per-instance userData directory and is written 0600.
 */
import { safeStorage } from 'electron';
import { existsSync, readFileSync, statSync } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { getUserDataDir } from '../user-data-dir.js';
import { atomicWriteFileSync } from '../mcp/atomic.js';
import { warn as logWarn } from '../log.js';
import type {
  CodeHostHostInput,
  CodeHostHostsSnapshot,
  CodeHostInstance,
  CodeHostKind,
} from '../shared/codehost-types.js';
import { CodeHostError } from './errors.js';

interface StoredToken {
  mode: 'safe' | 'plain';
  value: string;
}

interface StoredHost {
  id: string;
  kind: CodeHostKind;
  label: string;
  baseUrl: string;
  username?: string;
  caPath?: string;
  token?: StoredToken;
}

interface StoredFile {
  version: 1;
  hosts: StoredHost[];
}

const CONFIG_FILE = 'codehost-hosts.json';

function configPath(): string {
  return join(getUserDataDir(), CONFIG_FILE);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function parseStoredHost(value: unknown): StoredHost | null {
  const r = asRecord(value);
  const id = asString(r?.id);
  const kind = r?.kind === 'github' || r?.kind === 'gitlab' ? r.kind : null;
  const label = asString(r?.label);
  const baseUrl = asString(r?.baseUrl);
  if (!id || !kind || !label || !baseUrl) return null;
  const token = asRecord(r?.token);
  const mode = token?.mode === 'safe' || token?.mode === 'plain' ? token.mode : null;
  const tokenValue = asString(token?.value);
  return {
    id,
    kind,
    label,
    baseUrl,
    username: asString(r?.username),
    caPath: asString(r?.caPath),
    ...(mode && tokenValue ? { token: { mode, value: tokenValue } } : {}),
  };
}

function readConfig(): StoredFile {
  const file = configPath();
  if (!existsSync(file)) return { version: 1, hosts: [] };
  try {
    const parsed = asRecord(JSON.parse(readFileSync(file, 'utf8')));
    return {
      version: 1,
      hosts: Array.isArray(parsed?.hosts)
        ? parsed.hosts.flatMap((entry) => parseStoredHost(entry) ?? [])
        : [],
    };
  } catch (err) {
    logWarn('codehost', 'Could not read code host settings', { err: String(err) });
    return { version: 1, hosts: [] };
  }
}

function writeConfig(file: StoredFile): void {
  atomicWriteFileSync(configPath(), JSON.stringify(file, null, 2), { mode: 0o600 });
}

function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function encryptToken(token: string): StoredToken {
  if (encryptionAvailable()) {
    return { mode: 'safe', value: safeStorage.encryptString(token).toString('base64') };
  }
  return { mode: 'plain', value: token };
}

function decryptToken(token: StoredToken): string | null {
  if (token.mode === 'plain') return token.value;
  try {
    return safeStorage.decryptString(Buffer.from(token.value, 'base64'));
  } catch (err) {
    logWarn('codehost', 'Could not decrypt a stored host token', { err: String(err) });
    return null;
  }
}

function toInstance(host: StoredHost): CodeHostInstance {
  return {
    id: host.id,
    kind: host.kind,
    label: host.label,
    baseUrl: host.baseUrl,
    username: host.username,
    caPath: host.caPath,
    hasToken: !!host.token,
  };
}

/** Strips a trailing `/api/v4` and slashes so the base URL is the server root. */
export function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new CodeHostError(
      'config',
      'Enter the GitLab base URL, such as https://gitlab.example.com',
    );
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new CodeHostError('config', 'The GitLab base URL must start with https:// or http://');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new CodeHostError(
      'config',
      'The GitLab base URL must not contain credentials or a query',
    );
  }
  const path = url.pathname.replace(/\/+$/, '').replace(/\/api\/v4$/, '');
  if (path.includes('..')) throw new CodeHostError('config', 'The GitLab base URL path is invalid');
  return `${url.protocol}//${url.host}${path}`;
}

function validateLabel(raw: string): string {
  const label = raw.trim();
  if (!label || label.length > 64) {
    throw new CodeHostError('config', 'Give the instance a label of 1-64 characters');
  }
  return label;
}

function validateCaPath(raw: string | undefined): string | undefined {
  const caPath = raw?.trim();
  if (!caPath) return undefined;
  if (!caPath.startsWith('/')) {
    throw new CodeHostError('config', 'The CA bundle path must be absolute');
  }
  if (!existsSync(caPath) || !statSync(caPath).isFile()) {
    throw new CodeHostError('config', `No CA bundle file at ${caPath}`);
  }
  return caPath;
}

export function listHosts(): CodeHostHostsSnapshot {
  return {
    instances: readConfig().hosts.map(toInstance),
    encryptionAvailable: encryptionAvailable(),
  };
}

/** Creates or updates a GitLab instance; omitted tokens keep the stored one. */
export function saveHost(input: CodeHostHostInput): CodeHostInstance {
  if (input.kind !== 'gitlab') {
    throw new CodeHostError('config', 'Only GitLab instances are editable');
  }
  const label = validateLabel(input.label);
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const username = input.username?.trim().slice(0, 200) || undefined;
  const caPath = validateCaPath(input.caPath);
  const token = input.token?.trim();
  if (token && token.length > 500) throw new CodeHostError('config', 'The token is too long');
  const file = readConfig();
  const id = input.id ?? randomUUID();
  const existing = file.hosts.find((host) => host.id === id);
  if (file.hosts.some((host) => host.id !== id && host.baseUrl === baseUrl)) {
    throw new CodeHostError('config', `An instance for ${baseUrl} already exists`);
  }
  if (!existing && !token) throw new CodeHostError('config', 'A personal access token is required');
  const host: StoredHost = {
    id,
    kind: 'gitlab',
    label,
    baseUrl,
    username,
    caPath,
    token: token ? encryptToken(token) : existing?.token,
  };
  const hosts = existing
    ? file.hosts.map((entry) => (entry.id === id ? host : entry))
    : [...file.hosts, host];
  writeConfig({ version: 1, hosts });
  return toInstance(host);
}

export function deleteHost(id: string): boolean {
  const file = readConfig();
  const hosts = file.hosts.filter((host) => host.id !== id);
  if (hosts.length === file.hosts.length) return false;
  writeConfig({ version: 1, hosts });
  return true;
}

export function gitLabHostnames(): string[] {
  return readConfig()
    .hosts.filter((host) => host.kind === 'gitlab')
    .flatMap((host) => {
      try {
        return [new URL(host.baseUrl).hostname.toLowerCase()];
      } catch {
        return [];
      }
    });
}

/** The stored GitLab instance serving `hostname`, if any. */
export function gitLabInstanceForHostname(hostname: string): StoredHost | null {
  const target = hostname.toLowerCase();
  return (
    readConfig().hosts.find((host) => {
      if (host.kind !== 'gitlab') return false;
      try {
        return new URL(host.baseUrl).hostname.toLowerCase() === target;
      } catch {
        return false;
      }
    }) ?? null
  );
}

export function gitLabInstanceById(id: string): StoredHost | null {
  return readConfig().hosts.find((host) => host.id === id && host.kind === 'gitlab') ?? null;
}

export function tokenForHost(host: StoredHost): string {
  if (!host.token) {
    throw new CodeHostError('auth', `Add a personal access token for ${host.label}`);
  }
  const token = decryptToken(host.token);
  if (!token) {
    throw new CodeHostError(
      'auth',
      `The stored token for ${host.label} can no longer be decrypted. Save it again.`,
    );
  }
  return token;
}

/** Public instance list helper for tests and the registry. */
export function publicInstance(host: StoredHost): CodeHostInstance {
  return toInstance(host);
}
