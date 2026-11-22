// Reconstructs the critical path of a CI run: the chain of jobs (and waits) a developer actually waited on.

import type { JobSignal, PathSegment } from '../shared/types.ts';

export interface RunPath {
  repo: string;
  workflow: string;
  runId: number;
  runAttempt: number;
  headSha: string;
  startedAt: number;
  totalMs: number;
  segments: PathSegment[];
}

/** Two timestamps closer than this are treated as back to back. */
const TOLERANCE_MS = 1_000;

/**
 * Walks back from the last job to finish. Each step picks the job that finished most recently
 * before the current one started; time between them is attributed to "queue".
 */
export function criticalPath(jobs: readonly JobSignal[]): RunPath {
  const first = jobs[0];
  if (!first) throw new Error('criticalPath needs at least one job');
  const runStart = Math.min(...jobs.map((j) => j.createdAt));
  const byEnd = [...jobs].sort((a, b) => b.completedAt - a.completedAt);
  let current = byEnd[0] as JobSignal;
  const segments: PathSegment[] = [];
  const used = new Set<JobSignal>([current]);

  for (;;) {
    segments.unshift({ stage: current.stage, job: current.job, ms: current.completedAt - current.startedAt });
    const start = current.startedAt;
    const pred = byEnd.find((j) => !used.has(j) && j.completedAt <= start + TOLERANCE_MS);
    if (!pred) {
      const wait = start - runStart;
      if (wait > 0) segments.unshift({ stage: 'queue', job: '(waiting for runner)', ms: wait });
      break;
    }
    const gap = start - pred.completedAt;
    if (gap > TOLERANCE_MS) segments.unshift({ stage: 'queue', job: '(waiting for runner)', ms: gap });
    used.add(pred);
    current = pred;
  }

  const end = (byEnd[0] as JobSignal).completedAt;
  return {
    repo: first.repo,
    workflow: first.workflow,
    runId: first.runId,
    runAttempt: first.runAttempt,
    headSha: first.headSha,
    startedAt: runStart,
    totalMs: end - runStart,
    segments,
  };
}

/** Groups job signals by run attempt and computes each run's critical path. */
export function criticalPaths(jobs: readonly JobSignal[]): RunPath[] {
  const groups = new Map<string, JobSignal[]>();
  for (const job of jobs) {
    if (job.conclusion === 'skipped') continue;
    const key = `${job.repo}#${job.runId}#${job.runAttempt}`;
    const list = groups.get(key) ?? [];
    list.push(job);
    groups.set(key, list);
  }
  return [...groups.values()].map(criticalPath).sort((a, b) => a.startedAt - b.startedAt);
}
