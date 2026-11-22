import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkSmallBatch, MAX_CHANGED_LINES, prioritise, RISK, score, techniqueConfidence } from '../src/backlog/score.ts';
import { prng } from '../src/reporting/sample.ts';
import { opportunity } from './helpers.ts';

test('[R-01.1] higher saving x confidence per effort and risk ranks higher', () => {
  assert.equal(score({ expectedMinutesSavedPerWeek: 60, confidence: 0.5, effortHours: 2, risk: RISK.config }), 15);
  assert.equal(score({ expectedMinutesSavedPerWeek: 60, confidence: 0.5, effortHours: 2, risk: RISK.testCode }), 7.5);
  const ranked = prioritise([
    opportunity({ id: 'A', expectedMinutesSavedPerWeek: 30 }),
    opportunity({ id: 'B', expectedMinutesSavedPerWeek: 90 }),
    opportunity({ id: 'C', expectedMinutesSavedPerWeek: 90, risk: RISK.workflow }),
  ]);
  assert.deepEqual(ranked.map((o) => o.id), ['B', 'C', 'A']);
});

test('[R-01.1] property: score never rises when effort or risk rises', () => {
  const rand = prng(42);
  for (let i = 0; i < 500; i++) {
    const base = { expectedMinutesSavedPerWeek: rand() * 500, confidence: rand(), effortHours: 0.1 + rand() * 20, risk: rand() };
    const s = score(base);
    assert.ok(score({ ...base, effortHours: base.effortHours + rand() * 5 }) <= s);
    assert.ok(score({ ...base, risk: base.risk + rand() }) <= s);
    assert.ok(score({ ...base, expectedMinutesSavedPerWeek: base.expectedMinutesSavedPerWeek + 1 }) >= s);
  }
});

test('[R-01.2] oversized or unclear items are left out with reasons', () => {
  const big = opportunity({ id: 'BIG', estimatedChangedLines: MAX_CHANGED_LINES + 1 });
  const vague = opportunity({ id: 'VAGUE', hypothesis: ' ', targetMetric: '' });
  assert.deepEqual(checkSmallBatch(big).problems, ['estimated 201 changed lines exceeds 200; split it']);
  assert.deepEqual(checkSmallBatch(vague).problems, ['missing hypothesis', 'missing target metric']);
  assert.equal(checkSmallBatch(opportunity({ estimatedChangedLines: MAX_CHANGED_LINES })).ok, true);
  assert.deepEqual(prioritise([big, vague, opportunity({ id: 'OK' })]).map((o) => o.id), ['OK']);
});

test('[R-01.3] technique confidence is the Beta(1,1) posterior mean', () => {
  assert.equal(techniqueConfidence(0, 0), 0.5);
  assert.equal(techniqueConfidence(3, 1), 4 / 6);
  assert.equal(techniqueConfidence(0, 8), 0.1);
  assert.throws(() => techniqueConfidence(-1, 0), /negative/);
  assert.throws(() => techniqueConfidence(0, -1), /negative/);
});

test('[R-01.4] only queued items rank and ties break by id', () => {
  const ranked = prioritise([
    opportunity({ id: 'Z' }),
    opportunity({ id: 'A' }),
    opportunity({ id: 'DONE', status: 'adopted', expectedMinutesSavedPerWeek: 999 }),
    opportunity({ id: 'WIP', status: 'in-progress', expectedMinutesSavedPerWeek: 999 }),
  ]);
  assert.deepEqual(ranked.map((o) => o.id), ['A', 'Z']);
  assert.equal(ranked[0]?.score, 15);
});

test('[R-01.5] invalid scoring inputs throw', () => {
  const ok = { expectedMinutesSavedPerWeek: 10, confidence: 0.5, effortHours: 1, risk: 0 };
  assert.throws(() => score({ ...ok, effortHours: 0 }), /effortHours/);
  assert.throws(() => score({ ...ok, confidence: 1.1 }), /confidence/);
  assert.throws(() => score({ ...ok, confidence: -0.1 }), /confidence/);
  assert.throws(() => score({ ...ok, risk: -1 }), /risk/);
  assert.throws(() => score({ ...ok, expectedMinutesSavedPerWeek: -1 }), /saving/);
});
