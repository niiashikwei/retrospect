// Ranks bottlenecks and builds the stage-by-period heat map.

import type { Bottleneck, TestSignal } from '../shared/types.ts';
import type { RunPath } from './criticalPath.ts';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export type Granularity = 'day' | 'week';

/** UTC period key: YYYY-MM-DD for the day, or for the Monday that starts the week. */
export function periodKey(epochMs: number, granularity: Granularity): string {
  const d = new Date(epochMs);
  if (granularity === 'week') {
    const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
    d.setUTCDate(d.getUTCDate() - dow);
  }
  return d.toISOString().slice(0, 10);
}

function minutesByStage(paths: readonly RunPath[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const p of paths) {
    for (const s of p.segments) totals.set(s.stage, (totals.get(s.stage) ?? 0) + s.ms / 60_000);
  }
  return totals;
}

/**
 * Bottlenecks ranked by critical-path minutes per week. Trend compares the second half
 * of the window with the first; a change over 10% counts as rising or falling.
 */
export function rankBottlenecks(paths: readonly RunPath[], from: number, to: number): Bottleneck[] {
  const inWindow = paths.filter((p) => p.startedAt >= from && p.startedAt < to);
  const weeks = Math.max(1, (to - from) / WEEK_MS);
  const mid = from + (to - from) / 2;
  const totals = minutesByStage(inWindow);
  const early = minutesByStage(inWindow.filter((p) => p.startedAt < mid));
  const late = minutesByStage(inWindow.filter((p) => p.startedAt >= mid));
  const grand = [...totals.values()].reduce((a, b) => a + b, 0);

  return [...totals.entries()]
    .map(([stage, minutes]): Bottleneck => {
      const a = early.get(stage) ?? 0;
      const b = late.get(stage) ?? 0;
      const trend = b > a * 1.1 ? 'rising' : b < a * 0.9 ? 'falling' : 'steady';
      return {
        stage,
        minutesPerWeek: Math.round((minutes / weeks) * 10) / 10,
        shareOfCriticalPath: grand === 0 ? 0 : Math.round((minutes / grand) * 1000) / 1000,
        trend,
      };
    })
    .sort((x, y) => y.minutesPerWeek - x.minutesPerWeek);
}

export interface HeatMap {
  granularity: Granularity;
  periods: string[];
  stages: string[];
  /** minutes[stageIndex][periodIndex] = critical-path minutes for that stage in that period. */
  minutes: number[][];
}

/** Stage-by-period matrix of critical-path minutes. Stages are ordered hottest first. */
export function heatMap(paths: readonly RunPath[], granularity: Granularity): HeatMap {
  const cells = new Map<string, number>();
  const periodSet = new Set<string>();
  const stageTotals = new Map<string, number>();
  for (const p of paths) {
    const period = periodKey(p.startedAt, granularity);
    periodSet.add(period);
    for (const s of p.segments) {
      const min = s.ms / 60_000;
      const key = `${s.stage}|${period}`;
      cells.set(key, (cells.get(key) ?? 0) + min);
      stageTotals.set(s.stage, (stageTotals.get(s.stage) ?? 0) + min);
    }
  }
  const periods = [...periodSet].sort();
  const stages = [...stageTotals.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  const minutes = stages.map((stage) =>
    periods.map((period) => Math.round((cells.get(`${stage}|${period}`) ?? 0) * 10) / 10),
  );
  return { granularity, periods, stages, minutes };
}

export interface FlakyTest {
  suite: string;
  name: string;
  failures: number;
  passes: number;
}

/** A test is flaky when it both passed and failed on the same commit. */
export function flakyTests(tests: readonly TestSignal[]): FlakyTest[] {
  const byCommit = new Map<string, { pass: number; fail: number; suite: string; name: string }>();
  for (const t of tests) {
    if (t.outcome === 'skipped') continue;
    const key = `${t.headSha}|${t.suite}|${t.name}`;
    const entry = byCommit.get(key) ?? { pass: 0, fail: 0, suite: t.suite, name: t.name };
    if (t.outcome === 'passed') entry.pass++;
    else entry.fail++;
    byCommit.set(key, entry);
  }
  const flaky = new Map<string, FlakyTest>();
  for (const e of byCommit.values()) {
    if (e.pass === 0 || e.fail === 0) continue;
    const key = `${e.suite}|${e.name}`;
    const f = flaky.get(key) ?? { suite: e.suite, name: e.name, failures: 0, passes: 0 };
    f.failures += e.fail;
    f.passes += e.pass;
    flaky.set(key, f);
  }
  return [...flaky.values()].sort((a, b) => b.failures - a.failures);
}
