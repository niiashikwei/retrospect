import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildDashboard, SCHEMA_VERSION, validateDashboard } from '../src/reporting/dashboard.ts';
import type { BuildInput } from '../src/reporting/dashboard.ts';
import { cumulativeSeries, hoursPerWeek, hoursSince, summarise } from '../src/reporting/savings.ts';
import { prng, sampleData } from '../src/reporting/sample.ts';
import { appendJsonl, readJson, readJsonl, writeJson } from '../src/reporting/store.ts';
import type { Decision } from '../src/shared/types.ts';
import { T0 } from './helpers.ts';

const NOW = Date.parse('2026-11-22T12:00:00Z');
const WEEK = 7 * 86_400_000;
const health: BuildInput['agentHealth'] = { autonomyLevel: 'L0', predictionErrorPct: null, prAcceptanceRate: null, costPerAdoptedChangeUsd: null, lastReflection: null };

const decision = (over: Partial<Decision>): Decision => ({
  at: new Date(NOW - 2 * WEEK).toISOString(), opportunityId: 'OPP-1', finding: 'f', decision: 'd', reason: 'r',
  beforeSec: 400, afterSec: 220, runsPerWeek: 40, verdict: 'adopt', ...over,
});

test('[R-06.1] dashboard.json built from signals passes the data contract', () => {
  const data = sampleData(NOW);
  const d = buildDashboard({ ...data, trace: null, agentHealth: health, now: NOW, source: 'live', overheadHoursPerWeek: 0 });
  assert.deepEqual(validateDashboard(d), []);
  assert.equal(d.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(d.repos, ['sample/web-app']);
  assert.equal(d.timeseries.length, 9);
  assert.ok(d.summary.criticalPathP50Sec.now! < d.summary.criticalPathP50Sec.baseline!);
  assert.ok(d.summary.coverage.now! > d.summary.coverage.baseline!);
  assert.ok(d.summary.computeMinutesPerWeek > 0);
  assert.equal(d.flakyTests[0]?.name, 'applies discount once');
  assert.equal(d.backlog[0]?.id, 'OPP-006');
  assert.equal(d.requirements, null);
});

test('[R-06.1] an empty dataset still produces a valid dashboard', () => {
  const d = buildDashboard({ signals: [], decisions: [], opportunities: [], trace: null, agentHealth: health, now: NOW, source: 'live', overheadHoursPerWeek: 0 });
  assert.deepEqual(validateDashboard(d), []);
  assert.deepEqual(d.summary.criticalPathP50Sec, { baseline: null, now: null });
  assert.deepEqual(d.summary.coverage, { baseline: null, now: null });
  assert.deepEqual(d.whereTimeGoes, []);
});

test('[R-06.1] contract violations are reported', () => {
  assert.deepEqual(validateDashboard(null), ['dashboard must be an object']);
  const problems = validateDashboard({ schemaVersion: 0, generatedAt: 'nope', source: 'x', heatmap: { stages: ['a'], periods: [], minutes: [] } });
  assert.ok(problems.includes('schemaVersion must be 1'));
  assert.ok(problems.includes('generatedAt must be an ISO date'));
  assert.ok(problems.includes('source must be live or sample'));
  assert.ok(problems.includes('repos must be an array'));
  assert.ok(problems.includes('summary must be an object'));
  assert.ok(problems.includes('heatmap.minutes needs one row per stage'));
  const ragged = validateDashboard({ heatmap: { stages: ['a'], periods: ['p1', 'p2'], minutes: [[1]] } });
  assert.ok(ragged.includes('heatmap rows need one cell per period'));
  assert.ok(validateDashboard({ heatmap: null }).includes('heatmap must be an object'));
});

test('[R-06.2] the dashboard heat map shows past and current weeks for every stage', () => {
  const d = buildDashboard({ ...sampleData(NOW), trace: null, agentHealth: health, now: NOW, source: 'live', overheadHoursPerWeek: 0 });
  assert.equal(d.heatmap.periods.length, 9);
  assert.equal(d.heatmap.stages.length, d.heatmap.minutes.length);
  const unit = d.heatmap.minutes[d.heatmap.stages.indexOf('unit')] as number[];
  assert.ok((unit.at(1) as number) > (unit.at(-1) as number) * 2, 'sharding should show as a cooler unit row in recent weeks');
});

test('[R-06.3] decisions carry finding, decision, reason and before/after, newest first', () => {
  const older = decision({ at: '2026-11-01T00:00:00Z', opportunityId: 'OLD' });
  const newer = decision({ at: '2026-11-10T00:00:00Z', opportunityId: 'NEW', prUrl: 'https://github.com/me/app/pull/1' });
  const d = buildDashboard({ signals: [], decisions: [older, newer], opportunities: [], trace: null, agentHealth: health, now: NOW, source: 'live', overheadHoursPerWeek: 0 });
  assert.deepEqual(d.decisions.map((x) => x.opportunityId), ['NEW', 'OLD']);
  for (const key of ['finding', 'decision', 'reason', 'beforeSec', 'afterSec'] as const) assert.ok(key in (d.decisions[0] as Decision));
});

test('[R-06.4] only adopted decisions count, net of overhead', () => {
  assert.equal(hoursPerWeek(decision({})), 2); // 180s x 40 runs / 3600
  assert.equal(hoursPerWeek(decision({ verdict: 'reject' })), 0);
  assert.equal(hoursPerWeek(decision({ verdict: 'inconclusive' })), 0);
  assert.equal(hoursPerWeek(decision({ afterSec: 500 })), 0);
  assert.equal(hoursSince(decision({}), NOW), 4);
  assert.equal(hoursSince(decision({ at: new Date(NOW + WEEK).toISOString() }), NOW), 0);
  const s = summarise([decision({}), decision({ verdict: 'reject' })], NOW, 0.5, NOW - 4 * WEEK);
  assert.deepEqual(s, { grossHoursPerWeek: 2, netHoursPerWeek: 1.5, netHoursAllTime: 2 });
  assert.equal(summarise([], NOW, 1, NOW + WEEK).netHoursAllTime, 0);
  const series = cumulativeSeries([decision({})], ['2026-11-02', '2026-11-09'], 0, NOW - 4 * WEEK);
  assert.deepEqual(series, [{ period: '2026-11-02', netHours: 0.1 }, { period: '2026-11-09', netHours: 2.1 }]);
});

test('[R-06.6] sample data runs through the real pipeline and is labelled sample', () => {
  const a = sampleData(NOW);
  const b = sampleData(NOW);
  assert.deepEqual(a, b, 'sample data must be deterministic');
  const d = buildDashboard({ ...a, trace: null, agentHealth: health, now: NOW, source: 'sample', overheadHoursPerWeek: 0.5 });
  assert.equal(d.source, 'sample');
  assert.ok(d.summary.netHoursSavedAllTime > 0);
  assert.notEqual(prng(1)(), prng(2)());
});

test('[R-06.1] JSONL store appends and reads back, tolerating missing files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'retro-'));
  const file = join(dir, 'nested', 'x.jsonl');
  assert.deepEqual(readJsonl(file), []);
  appendJsonl(file, []);
  appendJsonl(file, [{ a: 1 }]);
  appendJsonl(file, [{ a: 2 }, { a: 3 }]);
  assert.deepEqual(readJsonl(file), [{ a: 1 }, { a: 2 }, { a: 3 }]);
  assert.equal(readJson(join(dir, 'missing.json'), 'fallback'), 'fallback');
  writeJson(join(dir, 'deep', 'y.json'), { b: T0 });
  assert.deepEqual(readJson(join(dir, 'deep', 'y.json'), null), { b: T0 });
  assert.ok(readFileSync(join(dir, 'deep', 'y.json'), 'utf8').endsWith('\n'));
});
