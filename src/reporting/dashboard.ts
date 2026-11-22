// Builds dashboard.json, the versioned data contract between the agent and the live dashboard.

import { flakyTests, heatMap, periodKey, rankBottlenecks } from '../diagnosis/bottlenecks.ts';
import type { FlakyTest, HeatMap } from '../diagnosis/bottlenecks.ts';
import { criticalPaths } from '../diagnosis/criticalPath.ts';
import { prioritise } from '../backlog/score.ts';
import { percentile } from '../shared/stats.ts';
import type { Bottleneck, CoverageSignal, Decision, JobSignal, Opportunity, Signal, TestSignal } from '../shared/types.ts';
import type { TraceReport } from '../trace/trace.ts';
import { cumulativeSeries, summarise } from './savings.ts';

export const SCHEMA_VERSION = 1;
const DAY_MS = 86_400_000;

export interface AgentHealth {
  autonomyLevel: 'L0' | 'L1' | 'L2' | 'L3';
  predictionErrorPct: number | null;
  prAcceptanceRate: number | null;
  costPerAdoptedChangeUsd: number | null;
  lastReflection: string | null;
}

export interface Dashboard {
  schemaVersion: number;
  generatedAt: string;
  source: 'live' | 'sample';
  repos: string[];
  summary: {
    netHoursSavedPerWeek: number;
    netHoursSavedAllTime: number;
    grossHoursSavedPerWeek: number;
    computeMinutesPerWeek: number;
    criticalPathP50Sec: { baseline: number | null; now: number | null };
    criticalPathP90Sec: { baseline: number | null; now: number | null };
    coverage: { baseline: number | null; now: number | null };
    runsAnalysed: number;
  };
  timeseries: Array<{ period: string; runs: number; p50Sec: number; p90Sec: number }>;
  savings: Array<{ period: string; netHours: number }>;
  heatmap: HeatMap;
  bottlenecks: Bottleneck[];
  whereTimeGoes: Array<{ stage: string; sec: number }>;
  decisions: Decision[];
  backlog: Array<Opportunity & { score: number }>;
  flakyTests: FlakyTest[];
  requirements: Pick<TraceReport, 'ok' | 'rows' | 'totals'> | null;
  agentHealth: AgentHealth;
}

export interface BuildInput {
  signals: readonly Signal[];
  decisions: readonly Decision[];
  opportunities: readonly Opportunity[];
  trace: TraceReport | null;
  agentHealth: AgentHealth;
  now: number;
  source: 'live' | 'sample';
  overheadHoursPerWeek: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function buildDashboard(input: BuildInput): Dashboard {
  const jobs = input.signals.filter((s): s is JobSignal => s.kind === 'job');
  const tests = input.signals.filter((s): s is TestSignal => s.kind === 'test');
  const coverage = input.signals.filter((s): s is CoverageSignal => s.kind === 'coverage').sort((a, b) => a.runId - b.runId);
  const paths = criticalPaths(jobs);
  const installedAt = paths[0]?.startedAt ?? input.now;

  const byWeek = new Map<string, number[]>();
  for (const p of paths) {
    const k = periodKey(p.startedAt, 'week');
    byWeek.set(k, [...(byWeek.get(k) ?? []), p.totalMs / 1000]);
  }
  const weeks = [...byWeek.keys()].sort();
  const timeseries = weeks.map((period) => {
    const secs = byWeek.get(period) as number[];
    return { period, runs: secs.length, p50Sec: round1(percentile(secs, 50)), p90Sec: round1(percentile(secs, 90)) };
  });

  const firstWeek = timeseries[0];
  const lastWeek = timeseries.at(-1);
  const recent = paths.filter((p) => p.startedAt >= input.now - 7 * DAY_MS);
  const stageSec = new Map<string, number>();
  for (const p of recent) for (const s of p.segments) stageSec.set(s.stage, (stageSec.get(s.stage) ?? 0) + s.ms / 1000);
  const whereTimeGoes = [...stageSec.entries()]
    .map(([stage, sec]) => ({ stage, sec: round1(sec / recent.length) }))
    .sort((a, b) => b.sec - a.sec);

  const weekJobs = jobs.filter((j) => j.startedAt >= input.now - 7 * DAY_MS);
  const savings = summarise(input.decisions, input.now, input.overheadHoursPerWeek, installedAt);

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date(input.now).toISOString(),
    source: input.source,
    repos: [...new Set(input.signals.map((s) => s.repo))].sort(),
    summary: {
      netHoursSavedPerWeek: savings.netHoursPerWeek,
      netHoursSavedAllTime: savings.netHoursAllTime,
      grossHoursSavedPerWeek: savings.grossHoursPerWeek,
      computeMinutesPerWeek: weekJobs.reduce((sum, j) => sum + j.runnerMinutes, 0),
      criticalPathP50Sec: { baseline: firstWeek?.p50Sec ?? null, now: lastWeek?.p50Sec ?? null },
      criticalPathP90Sec: { baseline: firstWeek?.p90Sec ?? null, now: lastWeek?.p90Sec ?? null },
      coverage: { baseline: coverage[0]?.lines ?? null, now: coverage.at(-1)?.lines ?? null },
      runsAnalysed: paths.length,
    },
    timeseries,
    savings: cumulativeSeries(input.decisions, weeks, input.overheadHoursPerWeek, installedAt),
    heatmap: heatMap(paths, 'week'),
    bottlenecks: rankBottlenecks(paths, input.now - 28 * DAY_MS, input.now),
    whereTimeGoes,
    decisions: [...input.decisions].sort((a, b) => b.at.localeCompare(a.at)),
    backlog: prioritise(input.opportunities).slice(0, 10),
    flakyTests: flakyTests(tests).slice(0, 10),
    requirements: input.trace ? { ok: input.trace.ok, rows: input.trace.rows, totals: input.trace.totals } : null,
    agentHealth: input.agentHealth,
  };
}

/** Checks the parts of the contract the dashboard page relies on. Returns problems (empty when valid). */
export function validateDashboard(value: unknown): string[] {
  const p: string[] = [];
  if (typeof value !== 'object' || value === null) return ['dashboard must be an object'];
  const d = value as Record<string, unknown>;
  if (d.schemaVersion !== SCHEMA_VERSION) p.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (typeof d.generatedAt !== 'string' || Number.isNaN(Date.parse(d.generatedAt))) p.push('generatedAt must be an ISO date');
  if (d.source !== 'live' && d.source !== 'sample') p.push('source must be live or sample');
  for (const key of ['repos', 'timeseries', 'savings', 'bottlenecks', 'whereTimeGoes', 'decisions', 'backlog', 'flakyTests']) {
    if (!Array.isArray(d[key])) p.push(`${key} must be an array`);
  }
  for (const key of ['summary', 'heatmap', 'agentHealth']) {
    if (typeof d[key] !== 'object' || d[key] === null) p.push(`${key} must be an object`);
  }
  const h = d.heatmap as HeatMap | undefined;
  if (h && typeof h === 'object') {
    if (!Array.isArray(h.minutes) || h.minutes.length !== h.stages?.length) p.push('heatmap.minutes needs one row per stage');
    else if (h.minutes.some((row) => row.length !== h.periods?.length)) p.push('heatmap rows need one cell per period');
  }
  return p;
}
