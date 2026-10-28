# Topic voting and prioritization: execution

Gate A and Gate B approved by the owner on 2026-10-28.
Specification: `spec/topic-voting-and-prioritization.md`.
Design: `design/topic-voting-and-prioritization.md`.
Baseline: accepted source `d22256b`. Work stays in the user-owned checkout;
no commit, push or production migration is implied by implementation approval.

## Planned execution order

1. Red tests for strict commands, ranking and budget/lifecycle service behavior.
2. Additive Prisma schema/migration; vote transactions and lifecycle guards.
3. Private coherent snapshot and stable accessible client controls.
4. PostgreSQL concurrency, migration comparison, multi-user browser failures
   and recovered-app continuation.
5. Focused checks, full local merge gate and independent archive recovery.
6. Candidate evidence, required CI/scans and hosted release checks before
   explicit human pilot acceptance. Unexecuted steps remain pending.

## Implemented surfaces

- `prisma/schema.prisma` and additive `20261028090000_topic_voting`: explicit
  states/timestamps, ballot revisions, scoped distinct selections and stored
  final ranks/counts, with restrictive historical references and row constraints.
- `src/lib/rules.ts`, `voting.ts`, `service.ts`: strict absolute-selection
  commands, deterministic ranking, serialized budget/lifecycle/finalization,
  explicit stale conflicts and integer-exhaustion guards.
- `src/lib/session-snapshot.ts`, `snapshot-service.ts`, `src/app/actions.ts`:
  coherent private DTO, own-ballot projection, aggregate totals and authorized
  commands. No new public mutation route or dependency.
- `src/components/session-workspace.tsx`: confirmation panels, keyboard
  selections/budget/refund, separate ordered agenda, stable topic cards/drafts,
  explicit pending status and post-command snapshot reconciliation.
- New unit, integration, migration and browser voting suites; fixture cleanup
  in FK order. Extend `scripts/verify-recovery.ts` for Open/Finalized sessions,
  distinct-user ballots and an actual recovered-app process restart.
- Updated setup, architecture, quality/release guidance and README to distinguish
  accepted topic collection from the uncommitted voting slice.

## TDD and failure resolution

1. The first voting unit run failed because `src/lib/voting.ts` did not exist.
   The command/ordering implementation then passed all 24 focused cases.
2. With the new schema applied only to the local `_test` database, all 20 initial
   service cases failed because voting operations did not exist. Implementing
   the serialized service/snapshot made all 44 combined focused tests pass.
3. Added explicit foreign-team/anonymous denial, post-finalization joining and
   queued membership-revocation cases. The voting service suite passed 23 cases;
   the full database suite passed 78, including every-original-column migration
   comparison and existing BugMagnet regressions.
4. Strict TypeScript caught an evolving untyped topic array inside the recovery
   fixture's nested function. Gave it the required `{ id: string }[]` type;
   no `any` cast or compiler suppression.
5. Two initial new browser cases used exact label-text locators on filled
   textarea/select wrappers. The trace showed retained values, not lost drafts;
   changed those lookups to accessible textbox/combobox roles. Both cases passed.
6. The first full browser run exposed a real keyboard-retry regression: rejected
   form errors appeared while the new awaited snapshot still disabled Submit.
   A fast Tab/Enter retry skipped that disabled control. Preserve the existing
   test unchanged; present pending status until reconciliation finishes, then
   reveal the error/success with the correct enabled/stale controls. Add a held
   post-write snapshot case to verify a second ballot cannot use the old revision.

## Verification state

The final unchanged `npm run gate:merge` passed on 2026-10-28: strict TypeScript
and warning-free lint, 110 unit/component tests, 79 PostgreSQL integration tests,
the production build and all 24 browser tests. That is 213 passing tests, with
no skipped tests. The new voting coverage includes 24 service integration cases
and eight browser cases.

Earlier failed attempts remain recorded below; component passes were not
substituted for the successful aggregate command. The first aggregate attempt
failed on the keyboard regression above and did not run its chained recovery.

The corrected keyboard case, held post-write snapshot, and measured two-identity
journey passed a focused three-case browser rerun without weakening an accepted
test. The pending status now lasts until snapshot reconciliation; errors/success
appear with the corresponding current-state controls.

A subsequent aggregate attempt stopped at a Vitest worker-start timeout for the
existing forms component file: 109 tests passed, but one worker never started.
Read-only inspection showed less than 1 GiB of free physical memory on this shared
machine. The isolated unchanged forms case then passed. No test timeout, isolation,
CI threshold or assertion was relaxed. A later aggregate attempt repeated this
worker-start failure. Running the isolated forms case immediately before the final
aggregate succeeded, then the entire aggregate succeeded without configuration,
dependency, timeout, isolation or assertion changes. This does not establish that
the shared machine's intermittent resource pressure has been permanently resolved.

Another aggregate attempt passed static checks, all 110 unit tests, all 79 database
tests and the build, but missed the existing TC9/10 five-second closure visibility
assertion. Its trace showed a snapshot aborted at the existing two-second deadline;
the next response arrived after the assertion failed and fixture cleanup began.
No new production-code change was justified by that trace alone. The unchanged
case passed three consecutive isolated repetitions and passed in the final full
aggregate. Its five-second requirement remains enforced.

Added a database-trigger failure after all four ranks are inserted but before the
session's Finalized update. The focused case passed: rollback left zero ranks,
OPEN state/version and the existing vote intact; removing the failure allowed
finalization. This supplements the earlier duplicate-rank insertion failure and
verifies transaction atomicity, not only single-statement INSERT atomicity.

### Local acceptance evidence

| Criteria | Executed evidence |
|---|---|
| VP1-VP7 | Strict commands/ranking unit tests; authorization, lifecycle, budgets, deterministic complete ranks, privacy, coordinated races/revocation and atomic finalization integration tests; browser controls/confirmation. |
| VP8, VP11 | Final two-identity visible browser journey measured start visibility at 1,914 ms, vote visibility at 1,877 ms and finalization visibility at 1,901 ms, each below 5,000 ms without a manual propagation reload; draft/focus and keyboard checks passed. |
| VP9 | Offline/invalid reads, expired/revoked access, stale same-user tab, lost committed response without replay and held post-write reconciliation browser cases passed. |
| VP10 | Original-column/row migration comparison passed in the aggregate; independent archive restore and actual recovered-app restart passed as recorded below. |
| VP12 | All existing AC/TC and active BugMagnet regressions passed in the final local aggregate. CI/scans and hosted acceptance remain pending, not locally proven. |

Final browser JUnit evidence is `test-results/browser.xml`: 24 tests, zero failures,
errors or skips. Durable VP8 timing evidence is
`test-results/voting-VP1-2-5-8-11-two-id-5b7a5--focus-through-finalization/voting-visibility.json`;
it records two distinct visible identities and `productionAccess: false`.
These ignored local outputs can be replaced by future runs; the measured values
above preserve this run's result without committing generated artifacts.

The independent archive/restarted-app drill passed at
`2026-10-28T08:23:32.390Z`. Every row/column across all 14 public tables, including
migration metadata, matched before application continuation. Archive restore and
comparison took 2 seconds. It continued Open voting with two identities, verified
the persisted Finalized agenda and existing action history, stopped/restarted the
actual app process, then confirmed Open selections/budget and final ranks again.
Both isolated drill databases and the app process were removed. Ignored evidence:
`.local/recovery/7f7ee29e21d34c9c99c187a8027bacac/evidence.json`.
Synthetic archive SHA-256:
`69ff002ac0ea5ae9ab996aa2eb35f28b12d79f6254b2b17dd6329dcde2932f62`.
No production connection or restore was used.

`npm audit --audit-level=high` initially failed because the configured proxy could
not resolve. A process-scoped npm-registry `NO_PROXY` retry completed with
**0 vulnerabilities**; no dependency or persistent proxy configuration changed.
The existing pg concurrent-query deprecation warning remains observable; no
claim of a warning-free runtime.

## Release boundary

No commit, push, production migration, deployment or new hosted OAuth journey has
been performed. The accepted production remains `d22256b`. New CI/secret/container
scans, verified encrypted backup, isolated production-copy migration rehearsal,
production migration, matching deployment/source verification and measured
distinct-user hosted acceptance remain pending. A local archive or fixture is
not evidence that those production steps have happened.

There is no local Docker/Podman or gitleaks executable available; do not report
the required container/secret scans as locally passed. Keep the existing strict
CI scanner jobs unchanged. Human pilot acceptance remains distinct from Gate A/B.

After verification, gracefully stopped the task-owned local PostgreSQL and its
wrapper. No test/recovery app listeners remained on ports 3100, 3101 or 3102.
Local test data and ignored recovery evidence were retained; no private artifacts
were added to the change set.

The next requirements are in `spec/timed-topic-discussion.md`, with Gate A
approved by the owner on 2026-10-28. The proposed design is in
`design/timed-topic-discussion.md`, with Gate B approved on 2026-10-28. Timer
execution is tracked separately in `tasks/timed-topic-discussion.md`; this does
not change voting's unpublished/unaccepted release status.

The subsequent timed-discussion aggregate revalidated all voting regressions
within 266 passing tests. That latest run's voting visibility measurements were
start 1,868 ms, vote 1,886 ms and finalization 1,404 ms; browser JUnit now contains
30 tests. The earlier 213-test/24-browser results above describe the voting-only
run, whose generated output has since been replaced. The extended recovered-app
drill also retained Open ballots and Finalized ranks while comparing all 15 tables;
see the timed-discussion task document for its actual evidence.

The later parking aggregate revalidated all voting regressions within 312 passing
tests. Latest voting visibility was start 1,875 ms, vote 219 ms and finalization
1,363 ms; generated browser JUnit now contains 34 tests. The extended archive/
restarted-app drill matched 16 tables and retained Open ballots/Finalized ranks.
See `tasks/parking-lot.md` for that run's actual results and unpublished boundary.

The subsequent manual-order aggregate retained all voting regressions within
346 passing tests. Final voting visibility was start 1,869 ms, vote 1,393 ms and
finalization 1,910 ms. Browser JUnit now contains 38 passing tests; the 17-table
archive/restarted-app drill retained Open ballots and original Finalized ranks/
counts alongside separate planning positions. Earlier generated artifacts have
been replaced; see `tasks/manual-agenda-order.md` for current evidence. No new
publication or acceptance is implied.

The subsequent meeting-summary aggregate retained voting regressions within
368 passing tests and 41 browser cases. Latest start/vote/finalization visibility
was 1,881/846/854 ms. Generated output was replaced; current exact 18-table
archive/restarted-app proof retained Open ballots and original Finalized results.
See `tasks/meeting-summary.md`; no publication or acceptance is implied.

The subsequent administration aggregate retained voting regressions within 394
passing tests and 44 browser cases. Latest start/vote/finalization visibility was
1,902/1,881/1,937 ms. Generated outputs were replaced; current exact 19-table
archive/restarted-app proof retained Open ballots, Finalized results and
removed/readmitted users' original budgets. See `tasks/session-administration.md`;
no publication or acceptance is implied.
