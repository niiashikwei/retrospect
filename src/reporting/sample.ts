// Deterministic sample data, so the dashboard has something to show before the first real collection.
// It runs through the same pipeline as live data and is labelled "sample" on the page.

import type { CoverageSignal, Decision, JobSignal, Opportunity, Signal, TestSignal } from '../shared/types.ts';

/** mulberry32: a tiny seeded PRNG so sample output is identical on every run. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY_MS = 86_400_000;
const REPO = 'sample/web-app';

interface StagePlan {
  job: string;
  stage: string;
  baseSec: number;
  needs: string[];
}

const PLAN: StagePlan[] = [
  { job: 'install', stage: 'install', baseSec: 150, needs: [] },
  { job: 'lint', stage: 'lint', baseSec: 45, needs: ['install'] },
  { job: 'typecheck', stage: 'typecheck', baseSec: 60, needs: ['install'] },
  { job: 'build', stage: 'build', baseSec: 120, needs: ['install'] },
  { job: 'unit tests', stage: 'unit', baseSec: 420, needs: ['build'] },
  { job: 'integration tests', stage: 'integration', baseSec: 240, needs: ['build'] },
  { job: 'e2e', stage: 'e2e', baseSec: 300, needs: ['unit tests', 'integration tests'] },
];

export interface SampleData {
  signals: Signal[];
  decisions: Decision[];
  opportunities: Opportunity[];
}

/** Eight weeks of runs. Caching lands in week 3 (install 150s -> 35s); sharding in week 6 (unit 420s -> 160s). */
export function sampleData(now: number, seed = 7): SampleData {
  const rand = prng(seed);
  const start = now - 56 * DAY_MS;
  const cacheAt = start + 21 * DAY_MS;
  const shardAt = start + 42 * DAY_MS;
  const signals: Signal[] = [];
  let runId = 1000;

  for (let t = start; t < now; t += DAY_MS / 6) {
    runId++;
    const sha = `sha${runId}`;
    const queueSec = 10 + rand() * 50 + (rand() < 0.1 ? 180 : 0);
    const ends = new Map<string, number>();
    for (const step of PLAN) {
      let sec = step.baseSec * (0.85 + rand() * 0.3);
      if (step.stage === 'install' && t >= cacheAt) sec *= 35 / 150;
      if (step.stage === 'unit' && t >= shardAt) sec *= 160 / 420;
      const ready = step.needs.length ? Math.max(...step.needs.map((n) => ends.get(n) as number)) : t + queueSec * 1000;
      const startedAt = ready + 2_000 + rand() * 6_000;
      const completedAt = startedAt + sec * 1000;
      ends.set(step.job, completedAt);
      const job: JobSignal = {
        kind: 'job', repo: REPO, workflow: 'CI', runId, runAttempt: 1, headSha: sha, job: step.job, stage: step.stage,
        createdAt: t, startedAt, completedAt, conclusion: 'success', runnerMinutes: Math.ceil(sec / 60),
      };
      signals.push(job);
    }
    const flakyFails = rand() < 0.12;
    const test: TestSignal = {
      kind: 'test', repo: REPO, runId, headSha: sha, suite: 'checkout', name: 'applies discount once', durationMs: 900, outcome: flakyFails ? 'failed' : 'passed',
    };
    signals.push(test);
    if (flakyFails) signals.push({ ...test, outcome: 'passed' });
    const cov: CoverageSignal = { kind: 'coverage', repo: REPO, runId, headSha: sha, lines: 86.4 + (t - start) / (now - start), branches: 79.1, testCount: 1240 + Math.floor((t - start) / DAY_MS) };
    signals.push(cov);
  }

  const decisions: Decision[] = [
    {
      at: new Date(cacheAt).toISOString(), opportunityId: 'OPP-001', finding: 'install is 25% of the critical path; npm cache misses on every run',
      decision: 'Cache ~/.npm keyed on package-lock.json', reason: 'Adopted: median 151s -> 36s over 12 vs 12 runs, p<0.001; coverage and test count unchanged',
      beforeSec: 151, afterSec: 36, runsPerWeek: 42, verdict: 'adopt',
    },
    {
      at: new Date(start + 32 * DAY_MS).toISOString(), opportunityId: 'OPP-002', finding: 'docker layer cache proposed for build',
      decision: 'Rejected Docker layer caching', reason: 'Inconclusive: median 121s -> 117s, p=0.41; gain below 30s threshold',
      beforeSec: 121, afterSec: 117, runsPerWeek: 42, verdict: 'inconclusive',
    },
    {
      at: new Date(shardAt).toISOString(), opportunityId: 'OPP-003', finding: 'unit tests are the largest stage at 420s, single runner',
      decision: 'Shard unit tests across 3 runners, balanced by measured duration', reason: 'Adopted: median 418s -> 161s over 10 vs 10 runs, p<0.001; same tests, coverage held',
      beforeSec: 418, afterSec: 161, runsPerWeek: 42, verdict: 'adopt',
    },
  ];

  const opp = (o: Partial<Opportunity> & Pick<Opportunity, 'id' | 'title' | 'technique' | 'stage'>): Opportunity => ({
    hypothesis: `${o.title} cuts ${o.stage} time`, targetMetric: `${o.stage} p50`, expectedMinutesSavedPerWeek: 60, confidence: 0.5,
    effortHours: 2, risk: 0, estimatedChangedLines: 40, status: 'queued', ...o,
  });
  const opportunities: Opportunity[] = [
    opp({ id: 'OPP-004', title: 'Run e2e only after unit and integration pass in parallel shards', technique: 'test-sharding', stage: 'e2e', expectedMinutesSavedPerWeek: 105, confidence: 0.62, effortHours: 3, risk: 0.5, estimatedChangedLines: 60 }),
    opp({ id: 'OPP-005', title: 'Quarantine flaky "applies discount once" test', technique: 'flake-quarantine', stage: 'unit', expectedMinutesSavedPerWeek: 40, confidence: 0.8, effortHours: 1, risk: 0.5, estimatedChangedLines: 20 }),
    opp({ id: 'OPP-006', title: 'Cancel superseded runs on the same branch', technique: 'concurrency', stage: 'queue', expectedMinutesSavedPerWeek: 30, confidence: 0.9, effortHours: 0.5, risk: 0, estimatedChangedLines: 6 }),
    opp({ id: 'OPP-007', title: 'Reuse build artifact in integration job', technique: 'artifact-reuse', stage: 'build', expectedMinutesSavedPerWeek: 50, confidence: 0.55, effortHours: 2, risk: 0.5, estimatedChangedLines: 45 }),
  ];

  return { signals, decisions, opportunities };
}
