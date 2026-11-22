import type { JobSignal, Opportunity } from '../src/shared/types.ts';

export const T0 = Date.parse('2026-11-02T10:00:00Z'); // a Monday

export function job(over: Partial<JobSignal> & Pick<JobSignal, 'job' | 'startedAt' | 'completedAt'>): JobSignal {
  return {
    kind: 'job', repo: 'me/app', workflow: 'CI', runId: 1, runAttempt: 1, headSha: 'abc', stage: over.job,
    createdAt: T0, conclusion: 'success', runnerMinutes: 1, ...over,
  };
}

export function opportunity(over: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'OPP-1', title: 'Cache deps', technique: 'caching', stage: 'install', hypothesis: 'caching cuts install',
    targetMetric: 'install p50', expectedMinutesSavedPerWeek: 60, confidence: 0.5, effortHours: 2, risk: 0,
    estimatedChangedLines: 20, status: 'queued', ...over,
  };
}

export const sec = (n: number) => n * 1000;
