import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flakyTests, heatMap, periodKey, rankBottlenecks } from '../src/diagnosis/bottlenecks.ts';
import { criticalPath, criticalPaths } from '../src/diagnosis/criticalPath.ts';
import type { RunPath } from '../src/diagnosis/criticalPath.ts';
import type { TestSignal } from '../src/shared/types.ts';
import { job, sec, T0 } from './helpers.ts';

test('[R-08.1] the critical path follows the chain a developer waited on, with queue waits', () => {
  // install 0:20-1:20, then lint (short, parallel) and build 1:21-3:21, then a 40s runner wait, then unit 4:01-6:01.
  const jobs = [
    job({ job: 'install', startedAt: T0 + sec(20), completedAt: T0 + sec(80) }),
    job({ job: 'lint', startedAt: T0 + sec(81), completedAt: T0 + sec(100) }),
    job({ job: 'build', startedAt: T0 + sec(81), completedAt: T0 + sec(201) }),
    job({ job: 'unit', startedAt: T0 + sec(241), completedAt: T0 + sec(361) }),
  ];
  const path = criticalPath(jobs);
  assert.equal(path.totalMs, sec(361));
  assert.deepEqual(path.segments.map((s) => [s.stage, s.ms / 1000]), [
    ['queue', 20], ['install', 60], ['build', 120], ['queue', 40], ['unit', 120],
  ]);
  assert.equal(path.segments.reduce((a, s) => a + s.ms, 0), sec(360)); // 1s hand-off between install and build is tolerated
});

test('[R-08.1] a single job that starts at once has no queue segment; empty input throws', () => {
  const path = criticalPath([job({ job: 'build', createdAt: T0, startedAt: T0, completedAt: T0 + sec(10) })]);
  assert.deepEqual(path.segments.map((s) => s.stage), ['build']);
  assert.throws(() => criticalPath([]), /at least one job/);
});

test('[R-08.1] runs are grouped by attempt, skipped jobs dropped, ordered by start', () => {
  const paths = criticalPaths([
    job({ job: 'build', runId: 2, createdAt: T0 + sec(500), startedAt: T0 + sec(500), completedAt: T0 + sec(560) }),
    job({ job: 'build', runId: 1, startedAt: T0, completedAt: T0 + sec(60) }),
    job({ job: 'deploy', runId: 1, conclusion: 'skipped', startedAt: T0 + sec(60), completedAt: T0 + sec(60) }),
    job({ job: 'build', runId: 1, runAttempt: 2, createdAt: T0 + sec(100), startedAt: T0 + sec(100), completedAt: T0 + sec(150) }),
  ]);
  assert.deepEqual(paths.map((p) => [p.runId, p.runAttempt]), [[1, 1], [1, 2], [2, 1]]);
});

const path = (startedAt: number, segs: Array<[string, number]>): RunPath => ({
  repo: 'me/app', workflow: 'CI', runId: startedAt, runAttempt: 1, headSha: 'x', startedAt,
  totalMs: segs.reduce((a, [, s]) => a + sec(s), 0), segments: segs.map(([stage, s]) => ({ stage, job: stage, ms: sec(s) })),
});
const DAY = 86_400_000;

test('[R-08.2] bottlenecks rank by minutes per week with share and trend', () => {
  const from = T0;
  const to = T0 + 14 * DAY;
  const paths = [
    path(from + DAY, [['unit', 600], ['install', 120], ['lint', 60]]),
    path(from + 10 * DAY, [['unit', 600], ['install', 60], ['lint', 120]]),
    path(to + DAY, [['unit', 9999]]), // outside the window
  ];
  const ranked = rankBottlenecks(paths, from, to);
  assert.deepEqual(ranked.map((b) => [b.stage, b.minutesPerWeek, b.trend]), [
    ['unit', 10, 'steady'], ['install', 1.5, 'falling'], ['lint', 1.5, 'rising'],
  ]);
  assert.equal(ranked[0]?.shareOfCriticalPath, 0.769);
  assert.equal(rankBottlenecks([path(from, [['unit', 0]])], from, to)[0]?.shareOfCriticalPath, 0);
});

test('[R-06.2] the heat map has a row per stage, hottest first, and a column per period', () => {
  assert.equal(periodKey(Date.parse('2026-11-08T23:00:00Z'), 'week'), '2026-11-02');
  assert.equal(periodKey(Date.parse('2026-11-08T23:00:00Z'), 'day'), '2026-11-08');
  const h = heatMap([
    path(T0, [['unit', 600], ['install', 120]]),
    path(T0 + 7 * DAY, [['unit', 300], ['e2e', 60]]),
  ], 'week');
  assert.deepEqual(h.periods, ['2026-11-02', '2026-11-09']);
  assert.deepEqual(h.stages, ['unit', 'install', 'e2e']);
  assert.deepEqual(h.minutes, [[10, 5], [2, 0], [0, 1]]);
});

test('[R-08.3] a test that passed and failed on the same commit is flaky', () => {
  const t = (sha: string, name: string, outcome: TestSignal['outcome']): TestSignal => ({
    kind: 'test', repo: 'me/app', runId: 1, headSha: sha, suite: 's', name, durationMs: 1, outcome,
  });
  const result = flakyTests([
    t('a', 'flaky', 'passed'), t('a', 'flaky', 'failed'), t('b', 'flaky', 'failed'), t('b', 'flaky', 'passed'), t('b', 'flaky', 'failed'),
    t('a', 'broken', 'failed'), t('b', 'broken', 'failed'),
    t('a', 'solid', 'passed'), t('a', 'solid', 'skipped'),
    t('c', 'once', 'passed'), t('c', 'once', 'failed'),
  ]);
  assert.deepEqual(result, [
    { suite: 's', name: 'flaky', failures: 3, passes: 2 },
    { suite: 's', name: 'once', failures: 1, passes: 1 },
  ]);
});
