# Manual agenda order: implementation and evidence

Status: implemented and verified locally; unpublished and unaccepted.
Date: 2026-10-28.
Requirements/design: `spec/manual-agenda-order.md`, `design/manual-agenda-order.md`.

The owner explicitly approved Gate A and Gate B on 2026-10-28, including saved
manual-position restoration and the complete planning permutation/atomic swap.
This does not authorize commit/push, production migration, downtime or deployment.

## Execution order

1. Red/green pure permutation, exact adjacency/history and strict input tests.
2. Preserving migration/constraints, scoped locked service and race/rollback proof.
3. Private snapshot and stable accessible queue controls/history with browser proof.
4. Existing regressions, full aggregate and exact archive/restarted-app recovery.
5. Record actual results, clean up owned helpers and prepare next requirements.

## Evidence

Baseline parking proof: 312 passing tests and exact 16-table archive/restarted-app
verification in `tasks/parking-lot.md`. This is not manual-order evidence.
Pure/input TDD: 11 tests first failed at the missing planner, then passed with
21 existing parking pure/input cases. Initial 13 integration cases failed at
the missing command/model/planning positions. Local PostgreSQL startup required
a bounded real readiness check before testing. The first implementation run
exposed PostgreSQL CASE parameter type inference (integer destination, text
expression); explicit SQL integer parameter casts fixed it without weakening
types, checks or assertions. All 24 focused pure/integration cases then passed.

The new migration was applied only to the loopback isolated `_test` database,
with both application/direct URLs explicitly overridden. No production operation.
At this point migration, component, browser, full aggregate and recovery results
were still pending; subsequent execution and final results follow.

The expanded 29 focused pure/component/service/migration tests passed, including
frozen-slot separation and current-parking reinsertion. Initial production build
caught a nullable synthetic actor-name expectation; the fixture assertion now
uses the known displayed name prefix. The first four browser journeys found a
real focus loss when native-disabled move buttons became unavailable during
reconciliation/at a boundary. Stable controls now use guarded `aria-disabled`
semantics, preserving focus while preventing mouse/keyboard commands, with
matching visual styling. Assertions were strengthened, not removed.

The next aggregate retained all prior regressions but found an incorrect new
browser precondition: it expected a successfully submitted parking reason to
remain an unsaved draft, although successful parking intentionally clears that
submitted draft. The journey now enters a new unsaved reason after parking and
verifies that exact draft across move/restore/start. Existing production behavior
was preserved. The expanded role/phase matrix also checks real foreign/other-
session/removed topics, nonjoined facilitation and lifecycle exhaustion.

The expanded test fixtures initially omitted required topic descriptions; the
existing strict input guard correctly rejected them. Supplying explicit empty
descriptions fixed the fixtures, not the validation. All 15 focused service
cases, four corrected browser journeys and the 17-table archive/restarted-app
drill then passed before the final aggregate.

## Final local aggregate and recovery

The final unchanged command chain completed successfully:
`db:generate -> gate:merge -> verify:recovery`.

| Evidence | Actual result |
|---|---|
| Static checks | Strict TypeScript and warning-free lint passed. |
| Unit/component | 174 passed; 11 manual pure/input and three manual control cases added. |
| Integration | 134 passed; 15 manual service/race/rollback cases and one preserving migration case added. |
| Build/browser | Production build and all 38 browser cases passed; zero failures/errors/skips. Four manual-order journeys added. |
| Total | 346 passing tests; prior AC/TC/VP/TD/PL and active BugMagnet regressions retained. |
| MO1 | Strict input/role/join/phase/team/session/removed-topic checks, exact neighbors, stale versions, lifecycle exhaustion and queued membership revocation passed. |
| MO2-4 | Complete default/manual permutations, both directions, separated frozen slots, current-parking reinsertion, parked restoration, fresh starts, immutable ranks/counts, before/after attribution and closed history passed. |
| MO5 | Real session-lock queue barriers covered move/move/start/finish/park/restore/close and revocation. Scoped post-swap/event injected failure and deferred uniqueness failure rolled back order/history/revision together. |
| MO6 | Distinct visible identities observed the manual move in 1,384 ms, restored eligibility in 1,868 ms and changed next topic in 1,969 ms; each below 5,000 ms without propagation reloads. Keyboard/boundaries, focused move/review controls and exact unsaved reason/action/review drafts were retained. |
| MO7 | Stale same-user intent conflicted; lost committed response reconciled with exactly one POST/history event. Hidden/offline/malformed reads disabled writes; access loss cleared protected content/drafts. |
| MO8 | Every original column/row was preserved across migration, including repeated Deferred attempts and parking events. Collision injection rolled back preceding DDL/backfill. Exact default positions, positive/scoped/shape constraints and catalog deferrability passed. |
| MO8 recovery | All 17 public tables matched exactly after archive restore, including migration/auth metadata. Actual recovered-app restart retained changed full positions, frozen current/Discussed slots, parked/restored eligibility, four attributed/reverse move histories and exact old clocks without read-side writes. |
| MO9 | Local aggregate/recovery passed; strict CI/scans and authorized hosted acceptance remain separate, not locally proven. |

Final timing JSON:
`test-results/agenda-order-MO2-3-6-disti-a3dfc-ocused-controls-stay-stable/agenda-order-visibility.json`.
Final JUnit: `test-results/browser.xml`, 38 tests, zero failures/errors/skips.
Generated browser output replaces earlier runs. Existing pg concurrent-query
deprecation warnings remain visible; no isolation, retries, deadlines, scans or
assertions were relaxed to obtain a pass.

Independent final recovery ran from `2026-10-28T11:03:35.840Z` to
`2026-10-28T11:03:57.563Z`; restore/comparison took one second.
Evidence: `.local/recovery/7fc6c38b1e6c4066beeeaba4e269865e/evidence.json`.
Synthetic archive SHA-256:
`c14ad9bf13790f2e2fce1ed235e24469ffb72129c929d4ce8c1fe0cf78351703`.

The source and recovered databases were independent. Continuation retained
action context/notes, allowed a new topic/review and a distinct user's existing
Open ballot, preserved original Finalized vote ranks, and verified running/
paused/expired/finished and repeated parking histories. The new manually ordered
fixture had a Discussed topic at slot 1, paused current at slot 2 (200,001 ms),
restored waiting topic at slot 4, parked placeholder at slot 5 and next eligible
topic at slot 3. All four move vectors, attribution and saved positions were
identical after actual process restart. Both drill databases/app were removed.

## Cleanup and next gate

The owned local PostgreSQL was stopped gracefully with `pg_ctl`; its
`agenda-order-db` wrapper was stopped afterward. No listeners remained on
3100/3101/3102/55432. Final `git diff --check` passed.
Lightweight source private-key/token-pattern checks passed; these are not the
required CI secret/dependency/container scanners.

No commit, push, production migration, maintenance or deployment occurred.
Accepted production remained `d22256b`. At completion of the manual-order proof,
the next proposal was `spec/meeting-summary.md`, then awaiting Gate A.
The later approvals and evidence are recorded below.

Strict CI/scans, encrypted production backup/copy rehearsal, authorized coordinated
roll-forward cutover, hosted OAuth/two-identity timing and explicit pilot
acceptance remain separate permissions/evidence.

Subsequently the owner approved meeting-summary Gates A/B. The summary aggregate
revalidated all manual-order regressions within 368 passing tests and 41 browser
cases. Latest move/restore/next visibility was 1,866/1,346/1,895 ms. Generated
browser artifacts were replaced; `tasks/meeting-summary.md` records current
18-table archive/restarted-app proof, which also retained the earlier full
positions, frozen slots and attributed/reverse history. Release status is unchanged.

The subsequent administration aggregate retained manual-order regressions within
394 passing tests and 44 browser cases. Latest move/restore/next visibility was
1,363/1,894/1,955 ms. Generated outputs were replaced; current exact 19-table
archive/restarted-app evidence is in `tasks/session-administration.md`.
Publication/acceptance status is unchanged.
