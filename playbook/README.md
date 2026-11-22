# Playbook

Techniques Retrospect knows how to try, with what it has learned about each. Confidence is the Beta(1,1) posterior mean of its track record (`techniqueConfidence` in `src/backlog/score.ts`), so an untried technique starts at 0.5.

| Technique | Typical win | Quality note |
| --- | --- | --- |
| Dependency and build caching | Large on cold jobs | None |
| Cancel superseded runs | Frees runners, cuts queue time | None |
| Path filters for docs-only changes | Large on mixed repos | Full suite still runs on main |
| Fail fast: lint and typecheck first | Faster red builds | None |
| Test sharding balanced by measured duration | Large on long suites | Same tests, split |
| Test impact analysis on PRs | Large | Full suite in merge queue and on main |
| Flaky-test quarantine | Fewer reruns | Still runs, non-blocking, with an owner |
| Build once, reuse the artifact | Medium | None |
| Right-size runners | Medium | Cost tracked |
| Speed up the slowest tests | Medium | Assertions and coverage kept |

Lessons are added here (and mirrored to Notion once R-04 ships) after every experiment, adopted or not.
