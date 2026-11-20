/** Picks the provider and credentials for a resolved code-host project. */
import type { CodeHostProject } from '../shared/codehost-types.js';
import { CodeHostError } from './errors.js';
import { gitLabInstanceForHostname, tokenForHost } from './settings.js';
import type { GitLabTarget } from './gitlab/client.js';

export function gitLabTargetForHostname(hostname: string): GitLabTarget {
  const host = hostname.toLowerCase();
  const instance = gitLabInstanceForHostname(host);
  if (!instance) {
    throw new CodeHostError(
      'config',
      `No GitLab instance is configured for ${hostname}. Add it in Settings → Code Hosts.`,
    );
  }
  return { baseUrl: instance.baseUrl, token: tokenForHost(instance), caPath: instance.caPath };
}

export function gitLabTargetForProject(project: CodeHostProject): GitLabTarget {
  if (project.hostKind !== 'gitlab') {
    throw new CodeHostError('config', 'This project is not a GitLab project');
  }
  return gitLabTargetForHostname(project.host);
}
