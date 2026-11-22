# Retrospect

Retrospect is an agent that keeps looking for ways to speed up software delivery **without lowering quality or test coverage**. It watches CI, finds where developers wait, keeps a ranked backlog of small fixes, proves each one with an A/B test, and shows everything on a live dashboard. It also watches itself.

**Live dashboard:** published to GitHub Pages from this repo (Settings → Pages), refreshed hourly and after every CI run. It shows sample data, clearly labelled, until the first collection.

## How it works

| Loop | When | What it does | Status |
| --- | --- | --- | --- |
| Collect | Hourly and after each CI run | Pulls GitHub Actions runs and jobs into append-only signals on the `data` branch | Shipped |
| Diagnose | Each collection | Rebuilds each run's critical path, ranks bottlenecks, finds flaky tests, builds the heat map | Shipped |
| Plan | Daily | Turns bottlenecks into scored, single-PR opportunities | Scoring shipped; proposals next |
| Experiment | Daily | Opens a PR, runs 10+ runs per arm, checks guardrails, gives a verdict | Guardrails and verdict shipped; PR runner next |
| Reflect | Daily | Grades its own predictions, acceptance and cost; proposes one self-improvement | Planned (R-07.2) |

See `GUARDRAILS.md` for the rules it can never loosen on its own.

## Requirements and tests

Every behaviour is a requirement in `requirements/` with Given/When/Then acceptance criteria. Every test is tagged with the criteria it proves, for example `test('[R-03.1] coverage drops beyond 0.1 points fail', ...)`.

```sh
npm run verify   # typecheck + tests with a 100% line/branch/function coverage gate + traceability check
```

CI fails if coverage drops below 100%, if any active criterion has no passing test, or if a test points at a criterion that doesn't exist. The matrix is written to `reports/trace.md`, posted to each CI run's summary, and shown on the dashboard.

There are **no runtime dependencies**: TypeScript runs directly on Node 22.18+ (type stripping), and tests use Node's built-in runner and coverage. The only dev tools are `typescript` and `@types/node` for type-checking.

## Layout

```
src/
  telemetry/        GitHub Actions client, JUnit and lcov parsers, stage mapping
  diagnosis/        critical path, bottleneck ranking, heat map, flaky tests
  backlog/          scoring and small-batch rules
  experimentation/  guardrails, statistics, verdicts
  reporting/        dashboard.json builder and contract, savings, sample data, JSONL store
  trace/            requirements traceability
requirements/       one JSON file per requirement
dashboard/          the static live dashboard
bin/                thin entry points for the workflows
```

## Commands

```sh
npm run collect -- data   # needs GITHUB_TOKEN and GITHUB_REPOSITORY
npm run report  -- data   # builds data/dashboard.json from collected signals
npm run sample  -- data   # builds a sample-labelled dashboard.json
```

To preview the dashboard locally: `npm run sample -- data && cp data/dashboard.json dashboard/ && npx serve dashboard`.

## Watching other repos

Add them to `repos` in `retrospect.config.json` (keep `"self"` so it keeps watching itself). The token needs `actions: read` on each repo.

MIT licensed.
