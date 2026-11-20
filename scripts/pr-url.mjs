#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const remote = process.argv[2] ?? 'origin';
const base = process.argv[3] ?? 'main';
const url = execFileSync('git', ['remote', 'get-url', '--push', remote], {
  encoding: 'utf8',
}).trim();
const match = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url);
if (!match) {
  process.stderr.write(`Cannot parse GitHub remote ${remote}: ${url}\n`);
  process.exit(1);
}
const [, owner, repo] = match;
if (owner === 'johannesjo') {
  process.stderr.write(
    `${remote} points at upstream (${owner}/${repo}); push feature branches to origin.\n`,
  );
  process.exit(1);
}
const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
process.stdout.write(`https://github.com/${owner}/${repo}/compare/${base}...${branch}?expand=1\n`);
