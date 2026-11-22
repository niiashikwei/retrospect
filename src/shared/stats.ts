// Small, dependency-free statistics helpers.

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('median of empty list');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] as number;
  return sorted.length % 2 === 1 ? hi : ((sorted[mid - 1] as number) + hi) / 2;
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new Error('percentile of empty list');
  if (p < 0 || p > 100) throw new Error('p must be between 0 and 100');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const frac = rank - lo;
  const a = sorted[lo] as number;
  const b = sorted[Math.min(lo + 1, sorted.length - 1)] as number;
  return a + (b - a) * frac;
}

/** Standard normal cumulative distribution (Abramowitz-Stegun 7.1.26). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/**
 * Two-sided Mann-Whitney U test with tie-corrected normal approximation.
 * Returns the U statistic for sample a and the p-value.
 */
export function mannWhitneyU(a: readonly number[], b: readonly number[]): { u: number; p: number } {
  if (a.length === 0 || b.length === 0) throw new Error('both samples need values');
  const all = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
  const ranks = new Array<number>(all.length);
  let tieTerm = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j + 1 < all.length && (all[j + 1] as { v: number }).v === (all[i] as { v: number }).v) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = rank;
    const t = j - i + 1;
    tieTerm += t * t * t - t;
    i = j + 1;
  }
  let rankSumA = 0;
  all.forEach((x, i) => {
    if (x.g === 0) rankSumA += ranks[i] as number;
  });
  const n1 = a.length;
  const n2 = b.length;
  const u = rankSumA - (n1 * (n1 + 1)) / 2;
  const mean = (n1 * n2) / 2;
  const n = n1 + n2;
  const variance = ((n1 * n2) / 12) * (n + 1 - tieTerm / (n * (n - 1)));
  if (variance === 0) return { u, p: 1 };
  const z = (Math.abs(u - mean) - 0.5) / Math.sqrt(variance);
  const p = Math.min(1, 2 * (1 - normalCdf(Math.max(z, 0))));
  return { u, p };
}
