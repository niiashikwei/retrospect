// Time-saved accounting. Only adopted experiments count, measured on the critical path, net of the agent's own cost.

import type { Decision } from '../shared/types.ts';

const WEEK_MS = 7 * 86_400_000;

/** Developer hours saved per week by one adopted decision. */
export function hoursPerWeek(d: Decision): number {
  if (d.verdict !== 'adopt') return 0;
  return Math.max(0, d.beforeSec - d.afterSec) * d.runsPerWeek / 3600;
}

/** Hours saved since a decision was adopted, up to `now`. */
export function hoursSince(d: Decision, now: number): number {
  const weeks = Math.max(0, (now - Date.parse(d.at)) / WEEK_MS);
  return hoursPerWeek(d) * weeks;
}

export interface SavingsSummary {
  grossHoursPerWeek: number;
  netHoursPerWeek: number;
  netHoursAllTime: number;
}

export function summarise(decisions: readonly Decision[], now: number, overheadHoursPerWeek: number, installedAt: number): SavingsSummary {
  const gross = decisions.reduce((sum, d) => sum + hoursPerWeek(d), 0);
  const allTime = decisions.reduce((sum, d) => sum + hoursSince(d, now), 0);
  const weeksInstalled = Math.max(0, (now - installedAt) / WEEK_MS);
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    grossHoursPerWeek: round(gross),
    netHoursPerWeek: round(gross - overheadHoursPerWeek),
    netHoursAllTime: round(allTime - overheadHoursPerWeek * weeksInstalled),
  };
}

/** Cumulative net hours at the end of each period (period keys are ISO dates, ascending). */
export function cumulativeSeries(
  decisions: readonly Decision[],
  periods: readonly string[],
  overheadHoursPerWeek: number,
  installedAt: number,
): Array<{ period: string; netHours: number }> {
  return periods.map((period) => {
    const end = Date.parse(period) + WEEK_MS;
    const s = summarise(decisions, end, overheadHoursPerWeek, installedAt);
    return { period, netHours: s.netHoursAllTime };
  });
}
