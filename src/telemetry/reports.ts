// Parsers for test and coverage reports produced by the watched repos' CI.

export interface ParsedTestCase {
  suite: string;
  name: string;
  durationMs: number;
  outcome: 'passed' | 'failed' | 'skipped';
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m?.[1];
}

function unescapeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

/** Parses JUnit XML (the common subset emitted by Jest, Vitest, pytest, Gradle, Maven). */
export function parseJUnit(xml: string): ParsedTestCase[] {
  const cases: ParsedTestCase[] = [];
  const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  for (let m = re.exec(xml); m !== null; m = re.exec(xml)) {
    const tag = m[1] as string;
    const body = m[3] ?? '';
    const outcome = /<(failure|error)\b/.test(body) ? 'failed' : /<skipped\b/.test(body) ? 'skipped' : 'passed';
    cases.push({
      suite: unescapeXml(attr(tag, 'classname') ?? ''),
      name: unescapeXml(attr(tag, 'name') ?? ''),
      durationMs: Math.round(Number(attr(tag, 'time') ?? '0') * 1000),
      outcome,
    });
  }
  return cases;
}

export interface CoverageSummary {
  lines: number;
  branches: number;
}

/** Sums an lcov tracefile into line and branch coverage percentages. */
export function parseLcov(lcov: string): CoverageSummary {
  let lf = 0, lh = 0, brf = 0, brh = 0;
  for (const raw of lcov.split('\n')) {
    const [key, value] = raw.trim().split(':');
    const n = Number(value);
    if (key === 'LF') lf += n;
    else if (key === 'LH') lh += n;
    else if (key === 'BRF') brf += n;
    else if (key === 'BRH') brh += n;
  }
  const pct = (hit: number, found: number) => (found === 0 ? 100 : Math.round((hit / found) * 10_000) / 100);
  return { lines: pct(lh, lf), branches: pct(brh, brf) };
}
