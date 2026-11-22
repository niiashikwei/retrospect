// Backlog scoring. A fixed formula ranks work so the model can propose items but not game their priority.

import type { Opportunity } from '../shared/types.ts';

export const MAX_CHANGED_LINES = 200;

/** Risk by change type: config-only 0, workflow restructuring 0.5, test code 1. */
export const RISK = { config: 0, workflow: 0.5, testCode: 1 } as const;

/**
 * Score = (expected minutes saved per week x confidence) / (effort hours x (1 + risk)).
 * Higher is better.
 */
export function score(o: Pick<Opportunity, 'expectedMinutesSavedPerWeek' | 'confidence' | 'effortHours' | 'risk'>): number {
  if (o.effortHours <= 0) throw new Error('effortHours must be positive');
  if (o.confidence < 0 || o.confidence > 1) throw new Error('confidence must be between 0 and 1');
  if (o.risk < 0) throw new Error('risk must not be negative');
  if (o.expectedMinutesSavedPerWeek < 0) throw new Error('expected saving must not be negative');
  return (o.expectedMinutesSavedPerWeek * o.confidence) / (o.effortHours * (1 + o.risk));
}

export interface BatchCheck {
  ok: boolean;
  problems: string[];
}

/** Small-batch rule: one hypothesis, one target metric, about 200 changed lines or fewer. */
export function checkSmallBatch(o: Opportunity): BatchCheck {
  const problems: string[] = [];
  if (o.estimatedChangedLines > MAX_CHANGED_LINES) {
    problems.push(`estimated ${o.estimatedChangedLines} changed lines exceeds ${MAX_CHANGED_LINES}; split it`);
  }
  if (o.hypothesis.trim() === '') problems.push('missing hypothesis');
  if (o.targetMetric.trim() === '') problems.push('missing target metric');
  return { ok: problems.length === 0, problems };
}

/** Confidence for a technique from its track record: Beta(1,1) prior, so 0.5 with no history. */
export function techniqueConfidence(successes: number, failures: number): number {
  if (successes < 0 || failures < 0) throw new Error('counts must not be negative');
  return (successes + 1) / (successes + failures + 2);
}

/** Ranks open opportunities by score, best first. Only queued items that pass the batch check are ranked. */
export function prioritise(items: readonly Opportunity[]): Array<Opportunity & { score: number }> {
  return items
    .filter((o) => o.status === 'queued' && checkSmallBatch(o).ok)
    .map((o) => ({ ...o, score: Math.round(score(o) * 100) / 100 }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
