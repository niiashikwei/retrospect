import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG, loadConfig, main, resolveRepos, writeChecked } from '../src/cli.ts';
import type { Deps } from '../src/cli.ts';
import type { HttpGet } from '../src/telemetry/github.ts';

const NOW = Date.parse('2026-11-22T12:00:00Z');

function deps(cwd: string, over: Partial<Deps> = {}): Deps & { logs: string[] } {
  const logs: string[] = [];
  const http: HttpGet = async (url) => {
    if (url.includes('/actions/runs?')) return { status: 200, json: { workflow_runs: [{ id: 5, name: 'CI', run_attempt: 1, head_sha: 's', status: 'completed' }] } };
    return { status: 200, json: { jobs: [{ name: 'build', created_at: '2026-11-21T10:00:00Z', started_at: '2026-11-21T10:00:10Z', completed_at: '2026-11-21T10:02:10Z', conclusion: 'success' }] } };
  };
  return { env: { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'me/retrospect' }, now: () => NOW, http, log: (l) => logs.push(l), cwd, logs, ...over };
}

test('[R-07.1] by default Retrospect watches its own repo', () => {
  assert.deepEqual(DEFAULT_CONFIG.repos, ['self']);
  assert.deepEqual(resolveRepos(DEFAULT_CONFIG, { GITHUB_REPOSITORY: 'me/retrospect' }), ['me/retrospect']);
  assert.deepEqual(resolveRepos({ ...DEFAULT_CONFIG, repos: ['self', 'me/app'] }, {}), ['me/app']);
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  assert.deepEqual(loadConfig(dir), DEFAULT_CONFIG);
  writeFileSync(join(dir, 'retrospect.config.json'), JSON.stringify({ lookbackDays: 7 }));
  assert.equal(loadConfig(dir).lookbackDays, 7);
  assert.deepEqual(loadConfig(dir).repos, ['self']);
});

test('[R-02.2] collect appends only new runs to the data branch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'collect-'));
  const d = deps(dir);
  assert.equal(await main(['collect'], d), 0);
  assert.equal(await main(['collect'], d), 0);
  const lines = readFileSync(join(dir, 'data', 'signals', 'jobs.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.ok(d.logs.includes('me/retrospect: 0 new job signals'));
  const noToken = deps(dir, { env: {} });
  assert.equal(await main(['collect'], noToken), 1);
  assert.deepEqual(noToken.logs, ['GITHUB_TOKEN is not set']);
});

test('[R-06.1] report builds a valid dashboard.json from the data branch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'report-'));
  const d = deps(dir);
  await main(['collect', 'store'], d);
  mkdirSync(join(dir, 'reports'));
  writeFileSync(join(dir, 'reports', 'trace.json'), JSON.stringify({ ok: true, rows: [], totals: { validated: 1, failing: 0, untested: 0, planned: 0 }, problems: [] }));
  assert.equal(await main(['report', 'store'], d), 0);
  const dash = JSON.parse(readFileSync(join(dir, 'store', 'dashboard.json'), 'utf8'));
  assert.equal(dash.source, 'live');
  assert.equal(dash.summary.runsAnalysed, 1);
  assert.equal(dash.requirements.ok, true);
});

test('[R-06.6] sample writes a sample-labelled dashboard', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sample-'));
  const d = deps(dir);
  assert.equal(await main(['sample'], d), 0);
  const dash = JSON.parse(readFileSync(join(dir, 'data', 'dashboard.json'), 'utf8'));
  assert.equal(dash.source, 'sample');
  assert.equal(dash.agentHealth.autonomyLevel, 'L2');
});

test('[R-06.1] an invalid dashboard is never written', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'invalid-'));
  const d = deps(dir);
  assert.equal(writeChecked(d, join(dir, 'dashboard.json'), { schemaVersion: 0 }), 1);
  assert.match(d.logs[0] as string, /failed validation/);
  assert.equal(existsSync(join(dir, 'dashboard.json')), false);
});

test('[R-10.6] unknown commands print usage', async () => {
  const d = deps(mkdtempSync(join(tmpdir(), 'usage-')));
  assert.equal(await main([], d), 2);
  assert.match(d.logs[0] as string, /usage/);
});
