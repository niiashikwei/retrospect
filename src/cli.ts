// Command-line entry points used by the scheduled workflows. All side effects come in through `deps`.

import { join } from 'node:path';
import { GitHubClient } from './telemetry/github.ts';
import type { HttpGet } from './telemetry/github.ts';
import type { AgentHealth } from './reporting/dashboard.ts';
import { buildDashboard, validateDashboard } from './reporting/dashboard.ts';
import { sampleData } from './reporting/sample.ts';
import { appendJsonl, readJson, readJsonl, writeJson } from './reporting/store.ts';
import type { Decision, JobSignal, Opportunity, Signal } from './shared/types.ts';
import type { TraceReport } from './trace/trace.ts';

export interface Config {
  repos: string[];
  lookbackDays: number;
  overheadHoursPerWeek: number;
  autonomyLevel: AgentHealth['autonomyLevel'];
  stageOverrides: Record<string, string>;
}

export interface Deps {
  env: Readonly<Record<string, string | undefined>>;
  now: () => number;
  http: HttpGet;
  log: (line: string) => void;
  cwd: string;
}

export const DEFAULT_CONFIG: Config = {
  repos: ['self'],
  lookbackDays: 30,
  overheadHoursPerWeek: 0,
  autonomyLevel: 'L0',
  stageOverrides: {},
};

export function loadConfig(cwd: string): Config {
  return { ...DEFAULT_CONFIG, ...readJson<Partial<Config>>(join(cwd, 'retrospect.config.json'), {}) };
}

/** "self" means the repo the workflow runs in, so Retrospect always watches itself. */
export function resolveRepos(config: Config, env: Deps['env']): string[] {
  return config.repos.flatMap((r) => {
    if (r !== 'self') return [r];
    return env.GITHUB_REPOSITORY ? [env.GITHUB_REPOSITORY] : [];
  });
}

async function collect(deps: Deps, dataDir: string): Promise<number> {
  const token = deps.env.GITHUB_TOKEN;
  if (!token) {
    deps.log('GITHUB_TOKEN is not set');
    return 1;
  }
  const config = loadConfig(deps.cwd);
  const signalsPath = join(dataDir, 'signals', 'jobs.jsonl');
  const existing = readJsonl<JobSignal>(signalsPath);
  const seen = new Set(existing.map((s) => s.runId));
  const since = new Date(deps.now() - config.lookbackDays * 86_400_000).toISOString().slice(0, 10);
  const client = new GitHubClient({ token, http: deps.http, stageOverrides: config.stageOverrides });
  let added = 0;
  for (const repo of resolveRepos(config, deps.env)) {
    const fresh = await client.collect(repo, since, seen);
    appendJsonl(signalsPath, fresh);
    added += fresh.length;
    deps.log(`${repo}: ${fresh.length} new job signals`);
  }
  deps.log(`collected ${added} job signals`);
  return 0;
}

function report(deps: Deps, dataDir: string): number {
  const config = loadConfig(deps.cwd);
  const signals = [
    ...readJsonl<Signal>(join(dataDir, 'signals', 'jobs.jsonl')),
    ...readJsonl<Signal>(join(dataDir, 'signals', 'tests.jsonl')),
    ...readJsonl<Signal>(join(dataDir, 'signals', 'coverage.jsonl')),
  ];
  const dashboard = buildDashboard({
    signals,
    decisions: readJsonl<Decision>(join(dataDir, 'decisions.jsonl')),
    opportunities: readJson<Opportunity[]>(join(dataDir, 'opportunities.json'), []),
    trace: readJson<TraceReport | null>(join(deps.cwd, 'reports', 'trace.json'), null),
    agentHealth: { autonomyLevel: config.autonomyLevel, predictionErrorPct: null, prAcceptanceRate: null, costPerAdoptedChangeUsd: null, lastReflection: null },
    now: deps.now(),
    source: 'live',
    overheadHoursPerWeek: config.overheadHoursPerWeek,
  });
  return writeChecked(deps, join(dataDir, 'dashboard.json'), dashboard);
}

function sample(deps: Deps, dataDir: string): number {
  const now = deps.now();
  const data = sampleData(now);
  const dashboard = buildDashboard({
    ...data,
    trace: readJson<TraceReport | null>(join(deps.cwd, 'reports', 'trace.json'), null),
    agentHealth: { autonomyLevel: 'L2', predictionErrorPct: 18, prAcceptanceRate: 0.67, costPerAdoptedChangeUsd: 1.9, lastReflection: new Date(now).toISOString() },
    now,
    source: 'sample',
    overheadHoursPerWeek: 0.5,
  });
  return writeChecked(deps, join(dataDir, 'dashboard.json'), dashboard);
}

export function writeChecked(deps: Deps, path: string, dashboard: unknown): number {
  const problems = validateDashboard(dashboard);
  if (problems.length > 0) {
    deps.log(`dashboard.json failed validation:\n${problems.join('\n')}`);
    return 1;
  }
  writeJson(path, dashboard);
  deps.log(`wrote ${path}`);
  return 0;
}

export async function main(argv: readonly string[], deps: Deps): Promise<number> {
  const [command, dataDirArg] = argv;
  const dataDir = join(deps.cwd, dataDirArg ?? 'data');
  switch (command) {
    case 'collect':
      return collect(deps, dataDir);
    case 'report':
      return report(deps, dataDir);
    case 'sample':
      return sample(deps, dataDir);
    default:
      deps.log('usage: retrospect <collect|report|sample> [dataDir]');
      return 2;
  }
}
