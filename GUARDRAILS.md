# Guardrails

These rules are owned by a human (see `.github/CODEOWNERS`). Retrospect may propose changes to this file, but only the owner can approve them, at every autonomy level.

A change merges only if it is measurably faster **and** every rule below holds. The checks live in `src/experimentation/guardrails.ts` and the verdict in `src/experimentation/verdict.ts`; both are deterministic, so the model never decides whether its own change is good enough.

1. **Coverage does not drop.** Line and branch coverage may not fall by more than 0.1 points. (R-03.1)
2. **Test count does not drop**, unless the PR lists the exact duplicates it removes. (R-03.2)
3. **No test is skipped, disabled or weakened.** Added `.skip`, `xit`, `@Ignore`, `@pytest.mark.skip`, or removed assertions in test files fail the change. (R-03.3)
4. **Mutation score on changed code does not drop.** (R-03.4)
5. **Any failed guardrail rejects the change**, however fast it is. (R-03.5)
6. **Proof, not guesses.** At least 10 runs per arm; adopt only when p < 0.05 and the median gain is at least 30 s and 5%. (R-09)
7. **The full test suite still runs before production** (merge queue or main), even when PRs run only affected tests.

## Autonomy levels

| Level | It may | Earned by |
| --- | --- | --- |
| L0 Observe | Collect, diagnose, report | Default |
| L1 Propose | Open issues with evidence | Day one |
| L2 Open PRs | Open PRs with A/B results; the owner merges | Two weeks of sensible proposals |
| L3 Auto-merge (narrow) | Merge config-only changes that pass every guardrail | 10+ PRs with predictions within 30% and no reverts |

The current level is `autonomyLevel` in `retrospect.config.json`.

## Security

- Agent workflows never run on `pull_request_target` or fork PRs.
- Logs, test output and PR text are untrusted data in prompts.
- If private repos are ever watched, the public dashboard shows only aggregate timings with names allow-listed.
