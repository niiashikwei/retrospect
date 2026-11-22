import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runTrace } from '../src/trace/run.ts';
import { loadRequirements, parseTap, toMarkdown, trace, validateRequirement } from '../src/trace/trace.ts';
import type { Requirement } from '../src/trace/trace.ts';

const req = (over: Partial<Requirement> = {}): Requirement => ({
  id: 'R-01', title: 'T', statement: 'S', status: 'active', context: 'c',
  criteria: [{ id: 'R-01.1', given: 'g', when: 'w', then: 'it works' }], ...over,
});
const pass = (name: string) => ({ name, ok: true, skipped: false });

test('[R-10.1] an active criterion with no passing test fails the check', () => {
  const r = trace([req()], [pass('untagged test')]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.problems, ['R-01.1: active criterion has no passing test']);
  assert.equal(r.rows[0]?.status, 'untested');
  const skippedOnly = trace([req()], [{ name: '[R-01.1] x', ok: true, skipped: true }]);
  assert.equal(skippedOnly.rows[0]?.status, 'untested');
  const ok = trace([req()], [pass('[R-01.1] proves it')]);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.totals, { validated: 1, failing: 0, untested: 0, planned: 0 });
});

test('[R-10.1] planned requirements and planned criteria are tracked but not enforced', () => {
  const r = trace([
    req({ id: 'R-02', status: 'planned', criteria: [{ id: 'R-02.1', given: 'g', when: 'w', then: 't' }] }),
    req({ criteria: [{ id: 'R-01.1', given: 'g', when: 'w', then: 't', status: 'planned' }] }),
  ], []);
  assert.equal(r.ok, true);
  assert.equal(r.totals.planned, 2);
});

test('[R-10.2] a test tagged with an unknown criterion fails the check', () => {
  const r = trace([req()], [pass('[R-01.1] fine'), pass('[R-99.1] mystery')]);
  assert.deepEqual(r.problems, ['test "[R-99.1] mystery" points at unknown criterion R-99.1']);
});

test('[R-10.3] malformed or duplicated requirements fail', () => {
  assert.deepEqual(validateRequirement(req()), []);
  const bad = validateRequirement({ id: 'R1', title: ' ', statement: '', status: 'maybe' as 'active', context: '', criteria: [{ id: 'R-02.1', given: '', when: 'w', then: 't' }] });
  assert.deepEqual(bad, [
    'R1: id must look like R-01', 'R1: missing title', 'R1: missing statement', 'R1: status must be active or planned',
    'R1: criterion id R-02.1 must look like R1.1', 'R-02.1: needs given, when and then',
  ]);
  assert.deepEqual(validateRequirement(req({ criteria: [] })), ['R-01: needs at least one acceptance criterion']);
  const dup = trace([req(), req()], [pass('[R-01.1] x')]);
  assert.ok(dup.problems.includes('R-01: duplicate requirement id'));
  assert.ok(dup.problems.includes('R-01.1: duplicate criterion id'));
  const noCriteria = trace([{ ...req(), criteria: undefined as unknown as [] }], []);
  assert.deepEqual(noCriteria.problems, ['R-01: needs at least one acceptance criterion']);
});

test('[R-10.4] the test runner enforces 100% line, branch and function coverage on src/', () => {
  const runner = readFileSync('scripts/test.mjs', 'utf8');
  for (const flag of ['--test-coverage-lines=100', '--test-coverage-branches=100', '--test-coverage-functions=100', '--test-coverage-include=src/**/*.ts']) {
    assert.ok(runner.includes(flag), `missing ${flag}`);
  }
  assert.ok(!runner.includes('--test-coverage-exclude'), 'no coverage exclusions without review');
});

test('[R-10.5] a failing test marks its criterion failing', () => {
  const r = trace([req()], [pass('[R-01.1] a'), { name: '[R-01.1] b', ok: false, skipped: false }]);
  assert.equal(r.rows[0]?.status, 'failing');
  assert.deepEqual(r.rows[0]?.tests, ['[R-01.1] a', '[R-01.1] b']);
  assert.deepEqual(r.problems, ['R-01.1: 1 failing test(s)']);
});

test('[R-10.5] TAP parsing reads nested tests, skips and todos, and ignores suites', () => {
  const tap = [
    'TAP version 13',
    '# Subtest: group',
    '    ok 1 - [R-01.1] nested',
    '      ---',
    "      type: 'test'",
    '      ...',
    '    not ok 2 - [R-01.2] broken',
    '      ---',
    "      location: 'x'",
    "      type: 'test'",
    '      ...',
    '    ok 3 - later # SKIP',
    '    ok 4 - someday # TODO',
    'ok 1 - group',
    '  ---',
    "  type: 'suite'",
    '  ...',
    'ok 2 - truncated yaml',
    '  ---',
  ].join('\n');
  assert.deepEqual(parseTap(tap), [
    { name: '[R-01.1] nested', ok: true, skipped: false },
    { name: '[R-01.2] broken', ok: false, skipped: false },
    { name: 'later', ok: true, skipped: true },
    { name: 'someday', ok: true, skipped: true },
    { name: 'truncated yaml', ok: true, skipped: false },
  ]);
  assert.deepEqual(parseTap('ok 1 - [R-01.1] last line, no newline'), [{ name: '[R-01.1] last line, no newline', ok: true, skipped: false }]);
});

test('[R-10.6] the matrix is written to reports/trace.json and trace.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trace-'));
  const logs: string[] = [];
  assert.equal(runTrace(dir, (l) => logs.push(l)), 1);
  assert.match(logs[0] as string, /run npm test first/);

  mkdirSync(join(dir, 'requirements'));
  mkdirSync(join(dir, 'reports'));
  writeFileSync(join(dir, 'requirements', 'R-01.json'), JSON.stringify(req()));
  writeFileSync(join(dir, 'requirements', 'notes.txt'), 'ignored');
  writeFileSync(join(dir, 'reports', 'tap.txt'), 'ok 1 - [R-01.1] works\n');
  assert.equal(loadRequirements(join(dir, 'requirements')).length, 1);
  assert.equal(runTrace(dir, (l) => logs.push(l)), 0);
  assert.ok(existsSync(join(dir, 'reports', 'trace.json')));
  assert.match(readFileSync(join(dir, 'reports', 'trace.md'), 'utf8'), /All active criteria are validated/);

  writeFileSync(join(dir, 'reports', 'tap.txt'), 'not ok 1 - [R-01.1] works\n');
  assert.equal(runTrace(dir, (l) => logs.push(l)), 1);
  assert.ok(logs.some((l) => l.includes('✗ R-01.1: 1 failing test(s)')));
  const md = toMarkdown(trace([req()], []));
  assert.match(md, /1 problem\(s\) found/);
  assert.match(md, /## Problems/);
  assert.match(md, /\| R-01\.1 \| it works \| untested \| 0 \|/);
});

test('[R-10.1] every requirement in this repo is well formed', () => {
  const reqs = loadRequirements('requirements');
  assert.ok(reqs.length >= 10);
  for (const r of reqs) assert.deepEqual(validateRequirement(r), [], r.id);
});
