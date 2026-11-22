// Requirements traceability: every active acceptance criterion must be proven by at least one passing test.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Criterion {
  id: string;
  given: string;
  when: string;
  then: string;
  /** A criterion can be planned while the rest of its requirement is active. */
  status?: 'planned';
}

export interface Requirement {
  id: string;
  title: string;
  statement: string;
  status: 'active' | 'planned';
  context: string;
  criteria: Criterion[];
}

export interface TestResult {
  name: string;
  ok: boolean;
  skipped: boolean;
}

export type CriterionStatus = 'validated' | 'failing' | 'untested' | 'planned';

export interface MatrixRow {
  requirement: string;
  title: string;
  criterion: string;
  then: string;
  status: CriterionStatus;
  tests: string[];
}

export interface TraceReport {
  ok: boolean;
  rows: MatrixRow[];
  problems: string[];
  totals: Record<CriterionStatus, number>;
}

const REQ_ID = /^R-\d{2}$/;
const CRIT_ID = /^R-\d{2}\.\d+$/;
const TAG = /\[(R-\d{2}\.\d+)\]/g;

/** Validates one requirement's shape. Returns a list of problems (empty when valid). */
export function validateRequirement(r: Requirement): string[] {
  const p: string[] = [];
  if (!REQ_ID.test(r.id)) p.push(`${r.id}: id must look like R-01`);
  if (!r.title?.trim()) p.push(`${r.id}: missing title`);
  if (!r.statement?.trim()) p.push(`${r.id}: missing statement`);
  if (r.status !== 'active' && r.status !== 'planned') p.push(`${r.id}: status must be active or planned`);
  if (!Array.isArray(r.criteria) || r.criteria.length === 0) {
    p.push(`${r.id}: needs at least one acceptance criterion`);
    return p;
  }
  for (const c of r.criteria) {
    if (!CRIT_ID.test(c.id) || !c.id.startsWith(`${r.id}.`)) p.push(`${r.id}: criterion id ${c.id} must look like ${r.id}.1`);
    if (!c.given?.trim() || !c.when?.trim() || !c.then?.trim()) p.push(`${c.id}: needs given, when and then`);
  }
  return p;
}

export function loadRequirements(dir: string): Requirement[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Requirement);
}

/** Parses Node's TAP output, including nested subtests. Suites (which only group tests) are skipped. */
export function parseTap(tap: string): TestResult[] {
  const results: TestResult[] = [];
  const lines = tap.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(not ok|ok) \d+ - (.*)$/.exec(lines[i] as string);
    if (!m) continue;
    const rest = m[2] as string;
    const skipped = /#\s*(SKIP|TODO)\b/i.test(rest);
    const name = rest.replace(/\s+#\s*(SKIP|TODO)\b.*$/i, '');
    if (yamlBlockIsSuite(lines, i + 1)) continue;
    results.push({ name, ok: m[1] === 'ok', skipped });
  }
  return results;
}

/** Reads the YAML block that follows a TAP result line and reports whether it describes a suite. */
function yamlBlockIsSuite(lines: readonly string[], from: number): boolean {
  if ((lines[from] ?? '').trim() !== '---') return false;
  for (let j = from + 1; j < lines.length; j++) {
    const line = (lines[j] as string).trim();
    if (line === '...') return false;
    if (line === "type: 'suite'") return true;
  }
  return false;
}

export function trace(requirements: readonly Requirement[], results: readonly TestResult[]): TraceReport {
  const problems: string[] = [];
  const criteria = new Map<string, { req: Requirement; c: Criterion }>();
  const seenReq = new Set<string>();

  for (const r of requirements) {
    problems.push(...validateRequirement(r));
    if (seenReq.has(r.id)) problems.push(`${r.id}: duplicate requirement id`);
    seenReq.add(r.id);
    for (const c of r.criteria ?? []) {
      if (criteria.has(c.id)) problems.push(`${c.id}: duplicate criterion id`);
      criteria.set(c.id, { req: r, c });
    }
  }

  const evidence = new Map<string, { pass: string[]; fail: string[] }>();
  for (const t of results) {
    for (const [, id] of t.name.matchAll(TAG)) {
      const key = id as string;
      if (!criteria.has(key)) {
        problems.push(`test "${t.name}" points at unknown criterion ${key}`);
        continue;
      }
      if (t.skipped) continue;
      const e = evidence.get(key) ?? { pass: [], fail: [] };
      (t.ok ? e.pass : e.fail).push(t.name);
      evidence.set(key, e);
    }
  }

  const rows: MatrixRow[] = [];
  for (const [id, { req, c }] of criteria) {
    const e = evidence.get(id) ?? { pass: [], fail: [] };
    let status: CriterionStatus;
    if (req.status === 'planned' || c.status === 'planned') status = 'planned';
    else if (e.fail.length > 0) status = 'failing';
    else if (e.pass.length > 0) status = 'validated';
    else status = 'untested';
    if (status === 'failing') problems.push(`${id}: ${e.fail.length} failing test(s)`);
    if (status === 'untested') problems.push(`${id}: active criterion has no passing test`);
    rows.push({ requirement: req.id, title: req.title, criterion: id, then: c.then, status, tests: [...e.pass, ...e.fail] });
  }

  const totals: Record<CriterionStatus, number> = { validated: 0, failing: 0, untested: 0, planned: 0 };
  for (const r of rows) totals[r.status]++;
  return { ok: problems.length === 0, rows, problems, totals };
}

export function toMarkdown(report: TraceReport): string {
  const head = `# Requirements traceability\n\n${report.ok ? 'All active criteria are validated.' : `${report.problems.length} problem(s) found.`}\n\n`;
  const counts = `Validated ${report.totals.validated} · Failing ${report.totals.failing} · Untested ${report.totals.untested} · Planned ${report.totals.planned}\n\n`;
  const table = ['| Criterion | Then | Status | Tests |', '| --- | --- | --- | --- |',
    ...report.rows.map((r) => `| ${r.criterion} | ${r.then} | ${r.status} | ${r.tests.length} |`)].join('\n');
  const problems = report.problems.length ? `\n\n## Problems\n\n${report.problems.map((p) => `- ${p}`).join('\n')}` : '';
  return `${head}${counts}${table}${problems}\n`;
}
