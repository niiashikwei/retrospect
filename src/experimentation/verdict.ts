// Turns A/B samples plus guardrail results into a Verdict. Deterministic: the model never decides this.

import { mannWhitneyU, median } from '../shared/stats.ts';
import type { Verdict } from '../shared/types.ts';
import type { GuardrailResult } from './guardrails.ts';

export const MIN_RUNS = 10;
export const ALPHA = 0.05;
/** A win must beat both of these to count: 5% of baseline, or 30 seconds. */
export const MIN_GAIN_FRACTION = 0.05;
export const MIN_GAIN_SEC = 30;

export function decide(baselineSec: readonly number[], treatmentSec: readonly number[], guardrails: readonly GuardrailResult[]): Verdict {
  const failed = guardrails.filter((g) => !g.ok);
  if (baselineSec.length < MIN_RUNS || treatmentSec.length < MIN_RUNS) {
    return {
      kind: 'inconclusive',
      reasons: [`need at least ${MIN_RUNS} runs per arm (have ${baselineSec.length} and ${treatmentSec.length})`],
      baselineMedianSec: baselineSec.length ? median(baselineSec) : 0,
      treatmentMedianSec: treatmentSec.length ? median(treatmentSec) : 0,
      pValue: 1,
    };
  }
  const before = median(baselineSec);
  const after = median(treatmentSec);
  const { p } = mannWhitneyU(baselineSec, treatmentSec);
  const base = { baselineMedianSec: before, treatmentMedianSec: after, pValue: Math.round(p * 10_000) / 10_000 };

  if (failed.length > 0) {
    return { kind: 'reject', reasons: failed.map((g) => `guardrail ${g.rule} failed: ${g.detail}`), ...base };
  }
  const gain = before - after;
  const bigEnough = gain >= MIN_GAIN_SEC && gain >= before * MIN_GAIN_FRACTION;
  if (p < ALPHA && bigEnough) {
    return { kind: 'adopt', reasons: [`median ${before}s -> ${after}s (p=${base.pValue})`], ...base };
  }
  if (p < ALPHA && after > before) {
    return { kind: 'reject', reasons: [`slower: median ${before}s -> ${after}s (p=${base.pValue})`], ...base };
  }
  return { kind: 'inconclusive', reasons: [`no significant gain large enough to keep (p=${base.pValue}, gain ${gain}s)`], ...base };
}
