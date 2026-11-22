import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkAll, coverageHolds, mutationHolds, testCountHolds, testsNotWeakened } from '../src/experimentation/guardrails.ts';
import { decide, MIN_RUNS } from '../src/experimentation/verdict.ts';
import { mannWhitneyU, median, normalCdf, percentile } from '../src/shared/stats.ts';

const snap = (lines: number, branches: number, testCount: number, mutationScore?: number) => ({ lines, branches, testCount, mutationScore });

test('[R-03.1] coverage drops beyond 0.1 points fail', () => {
  assert.deepEqual(coverageHolds(snap(90, 80, 10), snap(89.95, 80.5, 10)).map((r) => r.ok), [true, true]);
  const r = coverageHolds(snap(90, 80, 10), snap(89.8, 79, 10));
  assert.deepEqual(r.map((x) => [x.rule, x.ok]), [['coverage.lines', false], ['coverage.branches', false]]);
  assert.equal(r[0]?.detail, '90% -> 89.8%');
});

test('[R-03.2] fewer tests fail unless declared as duplicates', () => {
  assert.equal(testCountHolds(snap(0, 0, 100), snap(0, 0, 98)).ok, false);
  assert.equal(testCountHolds(snap(0, 0, 100), snap(0, 0, 98), 2).ok, true);
  assert.equal(testCountHolds(snap(0, 0, 100), snap(0, 0, 101)).ok, true);
});

test('[R-03.3] skipped tests and removed assertions in test files fail', () => {
  const diff = [
    'diff --git a/src/cart.test.ts b/src/cart.test.ts',
    '--- a/src/cart.test.ts',
    '+++ b/src/cart.test.ts',
    '+  it.skip("totals", () => {',
    '+  xit("other", () => {});',
    '-    expect(total).toBe(3);',
    '+  // a comment',
    '+++ b/tests/test_api.py',
    '+@pytest.mark.skip(reason="slow")',
    '-    assert resp.status == 200',
    '+++ b/app/src/test/CartTest.java',
    '+  @Ignore',
    '+++ b/src/cart.ts',
    '-  expect(this).isNotATest();',
    '+  test.skip("not a test file, so fine")',
  ].join('\n');
  const results = testsNotWeakened(diff);
  assert.deepEqual(results.map((r) => r.rule), [
    'tests.not-skipped', 'tests.not-skipped', 'tests.assertions-kept', 'tests.not-skipped', 'tests.assertions-kept', 'tests.not-skipped',
  ]);
  assert.equal(results[2]?.detail, 'src/cart.test.ts: removed expect(total).toBe(3);');
  assert.deepEqual(testsNotWeakened('+++ b/src/a.test.ts\n+  it("new", () => expect(1).toBe(1));'), [
    { rule: 'tests.not-weakened', ok: true, detail: 'no skipped tests or removed assertions' },
  ]);
});

test('[R-03.4] a lower mutation score fails; unmeasured is noted', () => {
  assert.equal(mutationHolds(snap(0, 0, 0, 80), snap(0, 0, 0, 79)).ok, false);
  assert.equal(mutationHolds(snap(0, 0, 0, 80), snap(0, 0, 0, 80)).ok, true);
  assert.deepEqual(mutationHolds(snap(0, 0, 0), snap(0, 0, 0, 50)), { rule: 'mutation.score', ok: true, detail: 'not measured for this change' });
  assert.equal(mutationHolds(snap(0, 0, 0, 50), snap(0, 0, 0)).ok, true);
});

const fast = Array.from({ length: 12 }, (_, i) => 100 + i);
const slow = Array.from({ length: 12 }, (_, i) => 300 + i);

test('[R-03.5] a faster change that fails a guardrail is rejected', () => {
  const guard = checkAll({ before: snap(90, 80, 100), after: snap(85, 80, 100), diff: '' });
  assert.equal(guard.ok, false);
  const v = decide(slow, fast, guard.results);
  assert.equal(v.kind, 'reject');
  assert.deepEqual(v.reasons, ['guardrail coverage.lines failed: 90% -> 85%']);
  assert.equal(checkAll({ before: snap(90, 80, 100), after: snap(90, 80, 100), diff: '', declaredDuplicates: 0 }).ok, true);
});

test('[R-09.1] fewer than 10 runs per arm is inconclusive', () => {
  const v = decide(slow.slice(0, MIN_RUNS - 1), fast, []);
  assert.equal(v.kind, 'inconclusive');
  assert.match(v.reasons[0] as string, /at least 10 runs/);
  assert.equal(decide([], [], []).baselineMedianSec, 0);
  assert.equal(decide([], [], []).treatmentMedianSec, 0);
});

test('[R-09.2] adopt needs p < 0.05 and a gain of at least 30s and 5%', () => {
  const adopt = decide(slow, fast, []);
  assert.equal(adopt.kind, 'adopt');
  assert.equal(adopt.baselineMedianSec, 305.5);
  assert.equal(adopt.treatmentMedianSec, 105.5);
  assert.ok(adopt.pValue < 0.001);
  const tinyGain = decide(fast.map((x) => x + 20), fast, []); // significant but only 20s
  assert.equal(tinyGain.kind, 'inconclusive');
  const big = Array.from({ length: 12 }, (_, i) => 5000 + i);
  const smallPct = decide(big, big.map((x) => x - 40), []); // 40s but under 5% of 5005s
  assert.equal(smallPct.kind, 'inconclusive');
  const noise = decide(fast, [...fast].reverse(), []);
  assert.equal(noise.kind, 'inconclusive');
});

test('[R-09.3] a significantly slower treatment is rejected', () => {
  const v = decide(fast, slow, []);
  assert.equal(v.kind, 'reject');
  assert.match(v.reasons[0] as string, /^slower/);
});

test('[R-09.4] Mann-Whitney U and p match known results', () => {
  // Fully separated samples of 5 and 5: U = 0, exact two-sided p = 0.0079; normal approx with continuity ~ 0.0122.
  const r = mannWhitneyU([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]);
  assert.equal(r.u, 0);
  assert.ok(Math.abs(r.p - 0.0122) < 0.001, `p=${r.p}`);
  // Identical values: no evidence of a difference.
  assert.deepEqual(mannWhitneyU([3, 3, 3], [3, 3]), { u: 3, p: 1 });
  // Ties get mid-ranks: each 2-vs-2 tie counts half, so U = 0.5 + 0.5.
  assert.equal(mannWhitneyU([1, 2, 2], [2, 3]).u, 1);
  assert.throws(() => mannWhitneyU([], [1]), /both samples/);
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-4);
  assert.ok(Math.abs(normalCdf(-1.96) - 0.025) < 1e-4);
});

test('[R-09.4] median and percentile are correct at the edges', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.throws(() => median([]), /empty/);
  assert.equal(percentile([1, 2, 3, 4, 5], 90), 4.6);
  assert.equal(percentile([7], 50), 7);
  assert.throws(() => percentile([], 50), /empty/);
  assert.throws(() => percentile([1], 101), /between/);
  assert.throws(() => percentile([1], -1), /between/);
});
