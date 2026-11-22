import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const read = (p: string) => readFileSync(p, 'utf8');
const workflows = readdirSync('.github/workflows').filter((f) => f.endsWith('.yml'));

test('[R-05.1] the repo has an MIT licence, a README and CODEOWNERS', () => {
  assert.match(read('LICENSE'), /^MIT License/);
  assert.ok(existsSync('README.md'));
  assert.ok(existsSync('.github/CODEOWNERS'));
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.dependencies, undefined, 'no runtime dependencies');
});

test('[R-05.2] CI typechecks, runs the coverage-gated tests and the trace check on push and PR', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /^\s+push:/m);
  assert.match(ci, /^\s+pull_request:/m);
  for (const step of ['npm run typecheck', 'npm test', 'npm run trace']) assert.ok(ci.includes(`run: ${step}`), step);
});

test('[R-05.3] no workflow runs on pull_request_target', () => {
  assert.ok(workflows.length >= 2);
  for (const f of workflows) {
    const body = read(join('.github/workflows', f)).split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    assert.ok(!body.includes('pull_request_target'), f);
  }
});

test('[R-07.3] guardrails, requirements, scoring and config need the owner\'s review', () => {
  const owners = read('.github/CODEOWNERS');
  for (const path of ['/GUARDRAILS.md', '/requirements/', '/retrospect.config.json', '/scripts/test.mjs', '/src/backlog/score.ts', '/src/experimentation/', '/src/trace/', '/.github/']) {
    assert.match(owners, new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\s+@\\S+`, 'm'), path);
  }
});

test('[R-06.5] the dashboard page has a panel per section and refreshes every 60 seconds', () => {
  const html = read('dashboard/index.html');
  for (const id of ['panel-summary', 'panel-timeseries', 'panel-savings', 'panel-heatmap', 'panel-where', 'panel-bottlenecks', 'panel-decisions', 'panel-backlog', 'panel-agent', 'panel-requirements', 'panel-flaky', 'sample-banner']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.match(html, /const REFRESH_MS = 60000;/);
  assert.match(html, /setInterval\(load, REFRESH_MS\)/);
  assert.match(html, /fetch\(`dashboard\.json\?ts=/);
  assert.ok(read('.github/workflows/collect.yml').includes("cron: '17 * * * *'"), 'collects hourly');
});
