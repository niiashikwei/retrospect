// Quality guardrails. A change merges only if every guardrail holds. These rules are human-owned (see GUARDRAILS.md).

export interface QualitySnapshot {
  lines: number;
  branches: number;
  testCount: number;
  mutationScore?: number;
}

export interface GuardrailResult {
  rule: string;
  ok: boolean;
  detail: string;
}

/** Coverage may wobble by this many points from rounding without counting as a drop. */
export const COVERAGE_TOLERANCE = 0.1;

export function coverageHolds(before: QualitySnapshot, after: QualitySnapshot): GuardrailResult[] {
  return (['lines', 'branches'] as const).map((k) => {
    const ok = after[k] >= before[k] - COVERAGE_TOLERANCE;
    return { rule: `coverage.${k}`, ok, detail: `${before[k]}% -> ${after[k]}%` };
  });
}

export function testCountHolds(before: QualitySnapshot, after: QualitySnapshot, declaredDuplicates = 0): GuardrailResult {
  const ok = after.testCount >= before.testCount - declaredDuplicates;
  return { rule: 'tests.count', ok, detail: `${before.testCount} -> ${after.testCount} (declared duplicates: ${declaredDuplicates})` };
}

export function mutationHolds(before: QualitySnapshot, after: QualitySnapshot): GuardrailResult {
  if (before.mutationScore === undefined || after.mutationScore === undefined) {
    return { rule: 'mutation.score', ok: true, detail: 'not measured for this change' };
  }
  const ok = after.mutationScore >= before.mutationScore;
  return { rule: 'mutation.score', ok, detail: `${before.mutationScore}% -> ${after.mutationScore}%` };
}

/** Patterns that skip or disable a test when they appear on an added line. */
const SKIP_PATTERNS: readonly RegExp[] = [
  /\b(it|test|describe)\.skip\s*\(/,
  /\bx(it|test|describe)\s*\(/,
  /@(Ignore|Disabled)\b/,
  /@pytest\.mark\.skip/,
  /\{\s*skip\s*:\s*true/,
];

/** Patterns that assert something; removing one on a test file weakens the suite. */
const ASSERT_PATTERN = /\b(assert|expect|should|verify|XCTAssert)\w*\s*[.(]|^-\s*assert\s+\S/;

const TEST_FILE = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$|_test\.(py|go)$|Test\.(java|kt|swift)$/;

/**
 * Scans a unified diff for disabled tests or removed assertions in test files.
 * Returns one failing result per offending line, or a single passing result.
 */
export function testsNotWeakened(unifiedDiff: string): GuardrailResult[] {
  const problems: GuardrailResult[] = [];
  let file = '';
  for (const line of unifiedDiff.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line.slice(4).replace(/^b\//, '');
      continue;
    }
    if (line.startsWith('--- ') || !TEST_FILE.test(file)) continue;
    if (line.startsWith('+') && SKIP_PATTERNS.some((p) => p.test(line))) {
      problems.push({ rule: 'tests.not-skipped', ok: false, detail: `${file}: ${line.slice(1).trim()}` });
    }
    if (line.startsWith('-') && ASSERT_PATTERN.test(line)) {
      problems.push({ rule: 'tests.assertions-kept', ok: false, detail: `${file}: removed ${line.slice(1).trim()}` });
    }
  }
  return problems.length > 0 ? problems : [{ rule: 'tests.not-weakened', ok: true, detail: 'no skipped tests or removed assertions' }];
}

export interface GuardrailInput {
  before: QualitySnapshot;
  after: QualitySnapshot;
  diff: string;
  declaredDuplicates?: number;
}

export function checkAll(input: GuardrailInput): { ok: boolean; results: GuardrailResult[] } {
  const results = [
    ...coverageHolds(input.before, input.after),
    testCountHolds(input.before, input.after, input.declaredDuplicates),
    mutationHolds(input.before, input.after),
    ...testsNotWeakened(input.diff),
  ];
  return { ok: results.every((r) => r.ok), results };
}
