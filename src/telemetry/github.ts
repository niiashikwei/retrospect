// GitHub Actions telemetry. The HTTP layer is injected so tests use recorded fixtures.

import type { JobSignal } from '../shared/types.ts';
import { stageOf } from './stage.ts';

export type HttpGet = (url: string, headers: Record<string, string>) => Promise<{ status: number; json: unknown }>;

export interface GitHubClientOptions {
  token: string;
  http: HttpGet;
  apiBase?: string;
  stageOverrides?: Readonly<Record<string, string>>;
}

interface ApiRun {
  id: number;
  name: string;
  run_attempt: number;
  head_sha: string;
  status: string;
}

interface ApiJob {
  name: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  conclusion: string | null;
}

const KNOWN_CONCLUSIONS = new Set(['success', 'failure', 'cancelled', 'skipped']);

export function normaliseConclusion(value: string | null): JobSignal['conclusion'] {
  return value !== null && KNOWN_CONCLUSIONS.has(value) ? (value as JobSignal['conclusion']) : 'other';
}

export function toJobSignal(repo: string, run: ApiRun, job: ApiJob, overrides: Readonly<Record<string, string>> = {}): JobSignal | null {
  if (!job.started_at || !job.completed_at) return null;
  const startedAt = Date.parse(job.started_at);
  const completedAt = Date.parse(job.completed_at);
  return {
    kind: 'job',
    repo,
    workflow: run.name,
    runId: run.id,
    runAttempt: run.run_attempt,
    headSha: run.head_sha,
    job: job.name,
    stage: stageOf(job.name, overrides),
    createdAt: Date.parse(job.created_at),
    startedAt,
    completedAt,
    conclusion: normaliseConclusion(job.conclusion),
    runnerMinutes: Math.max(1, Math.ceil((completedAt - startedAt) / 60_000)),
  };
}

export class GitHubClient {
  readonly #opts: Required<GitHubClientOptions>;

  constructor(opts: GitHubClientOptions) {
    this.#opts = { apiBase: 'https://api.github.com', stageOverrides: {}, ...opts };
  }

  async #get(path: string): Promise<unknown> {
    const res = await this.#opts.http(`${this.#opts.apiBase}${path}`, {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.#opts.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    });
    if (res.status !== 200) throw new Error(`GitHub API ${path} returned ${res.status}`);
    return res.json;
  }

  /** Completed workflow runs created at or after `since` (ISO date). */
  async completedRuns(repo: string, since: string, maxPages = 5): Promise<ApiRun[]> {
    const runs: ApiRun[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const body = (await this.#get(
        `/repos/${repo}/actions/runs?status=completed&per_page=100&page=${page}&created=%3E%3D${since}`,
      )) as { workflow_runs: ApiRun[] };
      runs.push(...body.workflow_runs);
      if (body.workflow_runs.length < 100) break;
    }
    return runs;
  }

  async jobsForRun(repo: string, run: ApiRun): Promise<JobSignal[]> {
    const body = (await this.#get(
      `/repos/${repo}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`,
    )) as { jobs: ApiJob[] };
    return body.jobs
      .map((job) => toJobSignal(repo, run, job, this.#opts.stageOverrides))
      .filter((s): s is JobSignal => s !== null);
  }

  /** Collects job signals for all completed runs since `since`, skipping runs already seen. */
  async collect(repo: string, since: string, seenRunIds: ReadonlySet<number> = new Set()): Promise<JobSignal[]> {
    const runs = await this.completedRuns(repo, since);
    const signals: JobSignal[] = [];
    for (const run of runs) {
      if (seenRunIds.has(run.id)) continue;
      signals.push(...(await this.jobsForRun(repo, run)));
    }
    return signals;
  }
}

/** Default HTTP implementation using global fetch. */
export const fetchGet: HttpGet = async (url, headers) => {
  const res = await fetch(url, { headers });
  return { status: res.status, json: res.status === 200 ? await res.json() : null };
};
