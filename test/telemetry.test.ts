import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchGet, GitHubClient, normaliseConclusion, toJobSignal } from '../src/telemetry/github.ts';
import type { HttpGet } from '../src/telemetry/github.ts';
import { parseJUnit, parseLcov } from '../src/telemetry/reports.ts';
import { stageOf } from '../src/telemetry/stage.ts';

const run = (id: number) => ({ id, name: 'CI', run_attempt: 1, head_sha: `sha${id}`, status: 'completed' });
const apiJob = (name: string, created: string, started: string | null, completed: string | null, conclusion: string | null = 'success') => ({
  name, created_at: created, started_at: started, completed_at: completed, conclusion,
});

/** Recorded-fixture HTTP: maps URL substrings to responses and logs every call. */
function fixtureHttp(routes: Array<[string, unknown, number?]>): HttpGet & { calls: string[]; headers: Record<string, string>[] } {
  const calls: string[] = [];
  const headers: Record<string, string>[] = [];
  const fn = (async (url: string, h: Record<string, string>) => {
    calls.push(url);
    headers.push(h);
    const route = routes.find(([part]) => url.includes(part));
    if (!route) return { status: 404, json: null };
    return { status: route[2] ?? 200, json: route[1] };
  }) as HttpGet & { calls: string[]; headers: Record<string, string>[] };
  fn.calls = calls;
  fn.headers = headers;
  return fn;
}

test('[R-02.1] finished jobs become signals with stage, timings and runner minutes', async () => {
  const http = fixtureHttp([
    ['/actions/runs?', { workflow_runs: [run(7)] }],
    ['/runs/7/attempts/1/jobs', { jobs: [
      apiJob('install deps', '2026-11-02T10:00:00Z', '2026-11-02T10:00:30Z', '2026-11-02T10:02:31Z'),
      apiJob('unit tests', '2026-11-02T10:00:00Z', '2026-11-02T10:02:40Z', '2026-11-02T10:06:40Z', 'failure'),
    ] }],
  ]);
  const client = new GitHubClient({ token: 't0ken', http });
  const signals = await client.collect('me/app', '2026-11-01');
  assert.equal(signals.length, 2);
  const [install, unit] = signals;
  assert.equal(install?.stage, 'install');
  assert.equal(install?.startedAt - install!.createdAt, 30_000);
  assert.equal(install?.runnerMinutes, 3);
  assert.equal(unit?.stage, 'unit');
  assert.equal(unit?.conclusion, 'failure');
  assert.equal(unit?.headSha, 'sha7');
  assert.match(http.calls[0] as string, /^https:\/\/api\.github\.com\/repos\/me\/app\/actions\/runs\?status=completed/);
  assert.equal(http.headers[0]?.Authorization, 'Bearer t0ken');
});

test('[R-02.1] unknown conclusions are normalised and very short jobs bill one minute', () => {
  assert.equal(normaliseConclusion(null), 'other');
  assert.equal(normaliseConclusion('action_required'), 'other');
  assert.equal(normaliseConclusion('cancelled'), 'cancelled');
  const s = toJobSignal('me/app', run(1), apiJob('lint', '2026-11-02T10:00:00Z', '2026-11-02T10:00:00Z', '2026-11-02T10:00:00Z'));
  assert.equal(s?.runnerMinutes, 1);
});

test('[R-02.2] seen runs are skipped, unfinished jobs ignored, results paged', async () => {
  const page1 = { workflow_runs: Array.from({ length: 100 }, (_, i) => run(i + 1)) };
  const page2 = { workflow_runs: [run(101)] };
  const http = fixtureHttp([
    ['page=1&', page1],
    ['page=2&', page2],
    ['/jobs', { jobs: [apiJob('build', '2026-11-02T10:00:00Z', null, null), apiJob('build', '2026-11-02T10:00:00Z', '2026-11-02T10:00:05Z', null)] }],
  ]);
  const client = new GitHubClient({ token: 't', http, apiBase: 'https://gh.example' });
  const runs = await client.completedRuns('me/app', '2026-11-01');
  assert.equal(runs.length, 101);
  const seen = new Set(runs.slice(0, 100).map((r) => r.id));
  const signals = await client.collect('me/app', '2026-11-01', seen);
  assert.deepEqual(signals, []);
  const jobCalls = http.calls.filter((c) => c.includes('/jobs'));
  assert.deepEqual(jobCalls, ['https://gh.example/repos/me/app/actions/runs/101/attempts/1/jobs?per_page=100']);
});

test('[R-02.2] paging stops at the page limit', async () => {
  const full = { workflow_runs: Array.from({ length: 100 }, (_, i) => run(i)) };
  const http = fixtureHttp([['/actions/runs?', full]]);
  const runs = await new GitHubClient({ token: 't', http }).completedRuns('me/app', '2026-11-01', 2);
  assert.equal(runs.length, 200);
});

test('[R-02.3] JUnit cases yield suite, name, duration and outcome', () => {
  const xml = `<?xml version="1.0"?><testsuites><testsuite name="s">
    <testcase classname="cart" name="adds &amp; removes" time="0.25"/>
    <testcase classname="cart" name="totals" time="1.5"><failure message="x">boom</failure></testcase>
    <testcase classname="cart" name="crashes" time="0.1"><error/></testcase>
    <testcase classname="cart" name="later" time="0"><skipped/></testcase>
    <testcase name="no class or time"></testcase>
  </testsuite></testsuites>`;
  assert.deepEqual(parseJUnit(xml), [
    { suite: 'cart', name: 'adds & removes', durationMs: 250, outcome: 'passed' },
    { suite: 'cart', name: 'totals', durationMs: 1500, outcome: 'failed' },
    { suite: 'cart', name: 'crashes', durationMs: 100, outcome: 'failed' },
    { suite: 'cart', name: 'later', durationMs: 0, outcome: 'skipped' },
    { suite: '', name: 'no class or time', durationMs: 0, outcome: 'passed' },
  ]);
  assert.equal(parseJUnit('<testcase classname="a&lt;b&gt;&quot;c&apos;" name="n"/>')[0]?.suite, `a<b>"c'`);
  assert.equal(parseJUnit('<testcase classname="nameless"/>')[0]?.name, '');
});

test('[R-02.4] lcov coverage is summed across files', () => {
  const lcov = ['SF:a.ts', 'LF:10', 'LH:9', 'BRF:4', 'BRH:2', 'end_of_record', 'SF:b.ts', 'LF:10', 'LH:10', 'BRF:4', 'BRH:4', 'end_of_record'].join('\n');
  assert.deepEqual(parseLcov(lcov), { lines: 95, branches: 75 });
  assert.deepEqual(parseLcov(''), { lines: 100, branches: 100 });
});

test('[R-02.5] GitHub API errors are raised', async () => {
  const http = fixtureHttp([['/actions/runs?', { message: 'Bad credentials' }, 401]]);
  await assert.rejects(new GitHubClient({ token: 'bad', http }).collect('me/app', '2026-11-01'), /returned 401/);
});

test('[R-02.5] the default fetch client passes headers and status through', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const seen: Array<RequestInit | undefined> = [];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    seen.push(init);
    return seen.length === 1 ? new Response('{"ok":true}', { status: 200 }) : new Response('nope', { status: 500 });
  }) as typeof fetch;
  assert.deepEqual(await fetchGet('https://x.test', { A: 'b' }), { status: 200, json: { ok: true } });
  assert.deepEqual(await fetchGet('https://x.test', {}), { status: 500, json: null });
  assert.deepEqual(seen[0]?.headers, { A: 'b' });
});

test('[R-02.6] job names map to standard stages and overrides win', () => {
  const cases: Array<[string, string]> = [
    ['Run Playwright e2e', 'e2e'], ['integration tests', 'integration'], ['ESLint', 'lint'], ['typecheck', 'typecheck'],
    ['unit tests (shard 1/3)', 'unit'], ['build', 'build'], ['install dependencies', 'install'], ['deploy to prod', 'deploy'],
    ['CodeQL scan', 'security'], ['notify slack', 'other'],
  ];
  for (const [name, stage] of cases) assert.equal(stageOf(name), stage, name);
  assert.equal(stageOf('notify slack', { 'notify slack': 'deploy' }), 'deploy');
});
