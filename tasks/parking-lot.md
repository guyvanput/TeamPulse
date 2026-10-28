# Parking lot: implementation and evidence

Status: implemented and verified locally; not published or accepted.
Date: 2026-10-28.
Requirements: `spec/parking-lot.md`.
Design: `design/parking-lot.md`.

Subsequent manual-order regression evidence: the final 346-test aggregate
retained all parking tests; latest two-user current parking/restoration/restart
visibility was 1,429/1,862/1,925 ms. Browser JUnit now contains 38 passing tests;
the generated 34-browser artifacts below have been replaced. The new independent
17-table archive/restarted-app drill also retained repeated parking attempts/
events. See `tasks/manual-agenda-order.md` for current evidence and the approved
intentional restoration change to saved planning positions after manual moves.

The owner explicitly selected Approve Gate A and Approve Gate B on 2026-10-28.
No commit/push, production migration, maintenance, deployment or human acceptance
is authorized by those approvals.

## Execution order

1. Red/green pure eligibility/history and strict-input tests (PL1/2/4/5).
2. Data-preserving attempt/event migration and constraints; service transitions,
   authorization, exact clocks, races and rollback (PL1-6/9).
3. Private snapshot and stable accessible controls/history, retaining existing
   drafts, captured confirmations and pending reconciliation (PL7/8).
4. Isolated migration comparison, distinct-user browser journeys/failures,
   existing regressions, aggregate build/checks and archive/restarted-app proof
   (PL1-10). Record actual results, not planned counts.
5. Cleanup owned helpers; prepare the next requirements gate without publishing.

## Evidence

Baseline before parking: 266 passing local tests and exact 15-table recovery/
actual app restart, recorded in `tasks/timed-topic-discussion.md`. That evidence
does not validate parking changes. Parking evidence follows.

- Pure/input TDD initially failed at the missing helper import; after helper/
  strict schema implementation all 21 cases passed.
- All 17 initial integration cases failed on missing controlParking/new attempt
  keys. Implemented the transactionally migrated model and serialized service;
  all 38 pure/input/service cases then passed.
- Component TDD failed at the missing parking control import; all three cases
  passed after implementation. An initial static check caught an `unknown` reason
  produced by a collapsed parse union; normalized the validated restore shape
  without casts or weaker input validation.
- The complete Vitest run passed 278 tests; strict type/lint passed. The focused
  production build and four parking browser cases passed. Initial measured
  current parking/restoration/restarted-attempt visibility: 1897/1842/1360 ms.
  Final unchanged aggregate/recovery results are recorded below.

## Final local aggregate and recovery

The chained `db:generate -> gate:merge -> verify:recovery` command passed against
the isolated local `_test` database with both application and direct migration
URLs overridden. No production database was accessed.

| Evidence | Actual result |
|---|---|
| Static checks | Strict TypeScript and warning-free lint passed. |
| Unit/component | 160 passed, including 21 new pure/input and three parking component cases. |
| Integration | 118 passed, including 17 parking service/race/rollback cases and the parking migration case. |
| Build/browser | Production build and all 34 browser cases passed; zero failures/errors/skips. Four parking journeys added. |
| Total | 312 passing tests; existing AC/TC/VP/TD and active BugMagnet regressions retained. |
| PL1-6 | Scoped role/phase/join denials, waiting/current deferral, repeated restore/start history, exact paused/running/expired remaining, eligibility/closure, real lock barriers and injected rollback passed. |
| PL7-8 | Two distinct visible identities observed current parking in 1,919 ms, restoration in 1,354 ms and the fresh restarted attempt in 1,917 ms, all below 5,000 ms without propagation reloads. Draft/focus/keyboard, stale same-topic confirmation, ambiguous park/restore responses with one POST each, offline and access-loss checks passed. |
| PL9 | Every old column/row preserved across transactional key evolution; injected migration collision rolled back the preceding schema/backfill changes. New scoped/state/index constraints passed. |
| Recovery | All 16 public tables compared exactly after archive restore, including migration/auth metadata. Actual recovered-app restart retained old clocks and repeated parking/restoration/Deferred/Discussed history without read-side writes. |

Final browser timing JSON:
`test-results/parking-lot-PL2-3-4-7-two--ff8aa-rafts-and-focus-stay-stable/parking-visibility.json`.
Browser JUnit: `test-results/browser.xml`, 34 tests, zero failures/errors/skips.
Generated output may be replaced by future runs; the observations above retain
this execution. Existing pg concurrent-query deprecation warnings remain; do not
describe the whole runtime as warning-free.

The independent archive/restarted-app drill ran from
`2026-10-28T10:12:17.550Z` to `2026-10-28T10:12:32.429Z`.
Restore/comparison took one second. Recovered records included waiting parking
without fictional attempts, repeated waiting and actual-timebox cycles, restored
waiting eligibility, final Discussed outcome, original timer states and old
topic/vote/action history. Both drill databases and the app were removed.
Ignored evidence:
`.local/recovery/8758869a4089439494762c4ccb557fe3/evidence.json`.
Synthetic archive SHA-256:
`83ad48b3832ba805cf8af991d6c5850838b37794869a77f3722197ea20b267ea`.

Gracefully stopped task-owned local PostgreSQL, then its wrapper. No listeners
remained on 3100, 3101, 3102 or 55432. Retained local synthetic test data and
ignored archive evidence.

## Release boundary

Strict CI/scans, production-copy migration rehearsal/encrypted backup, coordinated
roll-forward cutover, hosted OAuth/two-identity timing and explicit pilot
acceptance remain pending and require separate authorization/evidence.
No commit, push, production migration, downtime or deployment occurred; accepted
production remains `d22256b`. Local success is not a new accepted release.

The subsequent meeting-summary aggregate retained all parking regressions within
368 passing tests and 41 browser cases. Latest park/restore/restarted visibility
was 1,887/1,854/1,875 ms. Generated output was replaced; current exact 18-table
archive/restarted-app proof retains all earlier parking/attempt histories and
immutable reports. See `tasks/meeting-summary.md`; release status is unchanged.

The subsequent administration aggregate retained parking regressions within 394
passing tests and 44 browser cases. Latest park/restore/restarted visibility was
1,426/1,385/1,905 ms. Generated outputs were replaced; current exact 19-table
archive/restarted-app proof is in `tasks/session-administration.md`, retaining all
earlier parking/attempt histories and unchanged clocks. Release status is unchanged.
