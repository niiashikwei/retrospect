// Ubiquitous language for Retrospect. See the design spec, "Domain model".

/** One CI job execution, normalised from the CI provider. Times are epoch ms. */
export interface JobSignal {
  kind: 'job';
  repo: string;
  workflow: string;
  runId: number;
  runAttempt: number;
  headSha: string;
  job: string;
  /** Pipeline stage the job belongs to (install, build, lint, unit, ...). */
  stage: string;
  createdAt: number;
  startedAt: number;
  completedAt: number;
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | 'other';
  /** Runner minutes billed for the job, rounded up as GitHub does. */
  runnerMinutes: number;
}

/** One test case result from a JUnit report. */
export interface TestSignal {
  kind: 'test';
  repo: string;
  runId: number;
  headSha: string;
  suite: string;
  name: string;
  durationMs: number;
  outcome: 'passed' | 'failed' | 'skipped';
}

/** Coverage summary for one run. Percentages are 0-100. */
export interface CoverageSignal {
  kind: 'coverage';
  repo: string;
  runId: number;
  headSha: string;
  lines: number;
  branches: number;
  testCount: number;
}

export type Signal = JobSignal | TestSignal | CoverageSignal;

/** A segment of a run's critical path, attributed to one stage. */
export interface PathSegment {
  stage: string;
  job: string;
  ms: number;
}

/** A stage that adds wait time to the critical path, ranked by minutes lost per week. */
export interface Bottleneck {
  stage: string;
  minutesPerWeek: number;
  shareOfCriticalPath: number;
  trend: 'rising' | 'falling' | 'steady';
}

/** A backlog item: one hypothesis, one target metric, one PR. */
export interface Opportunity {
  id: string;
  title: string;
  technique: string;
  stage: string;
  hypothesis: string;
  targetMetric: string;
  expectedMinutesSavedPerWeek: number;
  confidence: number;
  effortHours: number;
  risk: number;
  estimatedChangedLines: number;
  status: 'queued' | 'in-progress' | 'adopted' | 'rejected' | 'inconclusive' | 'blocked';
}

export type VerdictKind = 'adopt' | 'reject' | 'inconclusive';

/** The outcome of an experiment, with the numbers behind it. */
export interface Verdict {
  kind: VerdictKind;
  reasons: string[];
  baselineMedianSec: number;
  treatmentMedianSec: number;
  pValue: number;
}

/** A recorded decision, shown in the dashboard's decision log. */
export interface Decision {
  at: string;
  opportunityId: string;
  finding: string;
  decision: string;
  reason: string;
  beforeSec: number;
  afterSec: number;
  runsPerWeek: number;
  verdict: VerdictKind;
  prUrl?: string;
}
