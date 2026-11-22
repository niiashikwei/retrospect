// Runs the traceability check over the requirements folder and a TAP report, and writes the matrix.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJson } from '../reporting/store.ts';
import { loadRequirements, parseTap, toMarkdown, trace } from './trace.ts';

export function runTrace(cwd: string, log: (line: string) => void): number {
  const tapPath = join(cwd, 'reports', 'tap.txt');
  if (!existsSync(tapPath)) {
    log('reports/tap.txt not found: run npm test first');
    return 1;
  }
  const report = trace(loadRequirements(join(cwd, 'requirements')), parseTap(readFileSync(tapPath, 'utf8')));
  writeJson(join(cwd, 'reports', 'trace.json'), report);
  writeFileSync(join(cwd, 'reports', 'trace.md'), toMarkdown(report));
  log(`Validated ${report.totals.validated} · Failing ${report.totals.failing} · Untested ${report.totals.untested} · Planned ${report.totals.planned}`);
  for (const p of report.problems) log(`  ✗ ${p}`);
  return report.ok ? 0 : 1;
}
