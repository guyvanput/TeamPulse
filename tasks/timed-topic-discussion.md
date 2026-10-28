# Timed topic discussion: execution

Gate A and Gate B approved by the owner on 2026-10-28.
Specification: `spec/timed-topic-discussion.md`.
Design: `design/timed-topic-discussion.md`.
Baseline: accepted source `d22256b` plus locally verified, uncommitted voting.

## Execution order

1. Red tests for exact timing, strict commands and discussion service boundaries.
2. Additive persistence, serialized transitions and current-discussion close guard.
3. Private snapshot/time synchronization and stable accessible timer controls.
4. Coordinated races, migration preservation, browser and archive/restart evidence.
5. Full local aggregate and durable actual results; retain failed-attempt evidence.

Local implementation and verification are complete. Release checks remain
separate; planned or unexecuted checks are not passing evidence.
No commit, push, production migration/deployment or hosted acceptance is implied.
The accepted production remains `d22256b`; both newer slices are unreleased.

## TDD and failure resolution

- The first unit run failed on the missing timing helper; exact time arithmetic
  and strict-command implementation then passed 23 cases.
- All 13 initial service cases failed on missing discussion operations. Added the
  additive migration, guarded serialized transitions and private snapshot.
- Prisma required an explicit scoped unique key on the defining side of the
  one-to-one agenda relation; added it without changing historical data.
- An initial revocation fixture tried to remove an existing action owner's
  membership, correctly rejected by its retained FK. Use a facilitator without
  owned actions for that case; no production membership constraint was relaxed.
- A post-lock clock assertion caught a real one-hour database time conversion
  error with the local Europe/Paris timezone. Sample numeric epoch milliseconds
  from PostgreSQL clock_timestamp rather than an adapter-decoded timestamptz.
  Added an explicit non-UTC transaction-timezone regression. All 47 focused
  timing/widget/service/migration cases then passed.
- TypeScript rejected Playwright's `exact` option in a Testing Library role
  locator. Removed the unsupported option; the exact accessible name remains.
- First focused browser run: five passed, one failed because its offline setup
  interrupted the post-start snapshot before any current timer was confirmed.
  The trace showed correctly retained pre-start state, not a stale live timer.
  Make the scenario establish a confirmed timer before testing offline timing;
  no production error/state behavior was weakened.

## Implemented surfaces

- Additive `20261028100000_timed_topic_discussion` persistence with scoped agenda/
  actor references, state/duration checks and a partial unique current-topic index.
- Pure timing helper and strict commands; session-serialized authorization,
  post-lock epoch sampling, atomic progress/revision updates and a close guard.
- Required private discussion snapshot, paired monotonic browser anchor, immediate
  initial synchronization, stable accessible countdown and explicit confirmations.
  Close confirmations retain their original revision instead of adopting new work.
- Reused the voting test's PostgreSQL lock-queue barrier through
  `tests/support/queued-session.ts`; the accepted voting races remain passing.
- Added exact timing/widget/service/migration/browser coverage, extended
  independent archive/restarted-app verification, and updated user/architecture/
  release guidance. No dependency or production infrastructure change.

## Final local evidence

On 2026-10-28, the unchanged `npm run gate:merge` passed static checks, all
**136 unit/component**, **100 integration** and **30 browser** tests, plus the
production build: **266 tests, zero skipped**. This includes all existing AC/TC/VP
and active BugMagnet regressions. The final gate followed an isolated four-case
run of both jsdom files; no timeout, test isolation or assertion was relaxed.
The existing pg concurrent-query deprecation warning remains; warning-free lint
is not a claim that the runtime emits no warnings.

| Criteria | Executed evidence |
|---|---|
| TD1-TD3 | 23 pure timing/command cases, three widget cases, service transitions and six browser journeys: exact milliseconds, server epoch, expiry without writes, deliberate completion and next start. |
| TD4, TD7 | 20 discussion service cases cover authorization, scoped IDs, stale/exhausted revisions, coordinated starts/extensions/pause/finish/close/revocation and post-lock time sampling; injected failure after the discussion write proves full rollback. Browser stale-tab, lost-response/no-replay, captured close confirmation, offline/expiry and widget stale-finish checks passed. |
| TD5 | Current discussion blocks closure; finish then close retains unstarted outcomes and actions. All existing vote/rank/history/follow-up regressions passed. |
| TD6 | Two distinct visible browser contexts measured start 1,880 ms, pause 1,917 ms, extension 1,863 ms, resume 1,929 ms and finish 1,361 ms, all below 5,000 ms without propagation reloads. Draft/focus/keyboard checks passed. |
| TD8 | Every-original-column/row migration comparison and independent 15-table archive/restarted-app verification passed, including all auth/migration metadata. |
| TD9 | Full local aggregate passed. CI/scans and actual hosted acceptance remain pending below. |

Ignored browser JUnit: `test-results/browser.xml`, 30 tests and zero failures,
errors or skips. Durable timing JSON:
`test-results/discussion-TD1-2-3-5-6-two-e76d7-hout-losing-drafts-or-focus/discussion-visibility.json`.
It records two identities, both visible and no production access. Generated files
may be replaced by future runs; the observations above retain this run's result.

The chained independent archive drill passed at `2026-10-28T09:48:36.184Z`.
Restore/comparison took one second, with every row/column in all 15 public tables
equal. The recovered app retained running deadlines, exact paused milliseconds,
derived expired state and finished attribution, then verified them again after
an actual app-process restart. Reads changed none of those stored records.
Existing restored topics/removals, Open voting, final agenda, action completion
and both progress notes also passed. Both generated drill databases and the app
process were removed. Ignored evidence:
`.local/recovery/ea06e3127e3e48808ffb4e119b2b873d/evidence.json`.
Synthetic archive SHA-256:
`f10b45887e6e18475bea4d872ddde0ee608b412ed8e732d17345698835d310c7`.
No production connection or restore was used.

## Release boundary

No commit, push, production migration, deployment or new hosted OAuth journey has
been performed. The accepted production remains `d22256b`. New CI/secret/container
scans, verified encrypted backup, isolated production-copy migration rehearsal,
matching source/deployment verification, actual distinct-user hosted timing and
explicit human acceptance remain pending. Local synthetic timing/recovery does
not prove those release steps. Do not roll back to the older application after
discussion use; retain the approved roll-forward/maintenance boundary.

After verification, gracefully stopped the task-owned local PostgreSQL and its
wrapper. No app/recovery/database listeners remained on 3100, 3101, 3102 or 55432.
Retained local test data and ignored recovery evidence. `git diff --check` passed;
a lightweight changed-file private-key/token-pattern check found no matches,
which is not a replacement for the required CI secret/container scanners.

Subsequently the owner approved parking Gate A/B on 2026-10-28; implementation
and evidence are in `tasks/parking-lot.md`. This does not alter either slice's
release status.

The subsequent parking aggregate revalidated timer regressions within 312 passing
tests. Latest two-user start/pause/extension/resume/finish visibility was
1876/1873/1874/1886/1869 ms; browser JUnit now contains 34 tests. The earlier
266-test/30-browser results above describe the timer-only run, whose generated
output has since been replaced. New 16-table archive/restarted-app evidence also
preserved the original timer states and exact deadlines; see the parking task.

The subsequent manual-order aggregate retained timer regressions within 346
passing tests. Final start/pause/extension/resume/finish visibility was
1,879/1,871/1,867/1,927/1,365 ms. Browser JUnit now contains 38 passing tests, and
the 17-table archive/restarted-app drill preserved exact existing clocks and
history. Earlier generated artifacts have been replaced; current evidence is in
`tasks/manual-agenda-order.md`. Release status is unchanged.

The subsequent meeting-summary aggregate retained timer regressions within 368
passing tests and 41 browser cases. Latest start/pause/extension/resume/finish
visibility was 1,904/1,884/1,856/2,395/1,359 ms. Generated output was replaced;
`tasks/meeting-summary.md` records current exact 18-table archive/restarted-app
proof with unchanged old clocks/history. Release status is unchanged.

The subsequent administration aggregate retained timer regressions within 394
passing tests and 44 browser cases. Latest start/pause/extension/resume/finish
visibility was 1,879/1,886/1,902/1,954/1,339 ms. Generated outputs were replaced;
`tasks/session-administration.md` records current exact 19-table archive/restarted-
app proof, including role/participant changes that leave clocks identical.
Publication/acceptance status is unchanged.
