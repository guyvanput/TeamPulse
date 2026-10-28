# Session administration: implementation and evidence

Status: locally implemented and verified; unpublished and unaccepted.
Date: 2026-10-28.
Requirements/design: `spec/session-participant-and-role-management.md`,
`design/session-participant-and-role-management.md`.

The owner explicitly approved Gates A/B, including immediate single-facilitator
handover, retained contribution-only removal/readmission and complete existing
guard/capability changes. No commit/push or production operation is authorized.

## Execution order

1. Red/green strict input, active/removed capability and typed history rules.
2. Preserving migration and atomic session/member-locked administration;
   complete old-command authorization, real races and rollback.
3. Required private snapshot, stable draft/focus-preserving administration and
   affected old controls, confirmations and measured multi-identity browser proof.
4. Existing regressions, unchanged full aggregate and exact 19-table archive/
   actual recovered-app restart with continued permissions and unchanged reports.
5. Record actual results, stop owned helpers and identify the next required gate.

## Evidence

Baseline: 368 passing tests and exact 18-table archive/restarted-app proof in
`tasks/meeting-summary.md`. This is not administration evidence.
Four pure/input/capability/history tests first failed for the missing module,
then passed. Nine service tests first failed for missing persistence/service
semantics; after the additive migration and shared active-participant guard,
all nine passed against isolated loopback PostgreSQL. Prisma formatting/client
generation, the eighth migration on `teampulse_test` and initial static checks
passed. Both application and unpooled URLs were explicitly overridden; no
production migration was run.

Four administration component cases first failed for the missing component,
then passed. Focus-preserving guarded controls retain captured target/revision/
reason and never latch role permission. An initial focused regression command
passed 29 tests across seven files, including every-original-column migration
preservation, valid stored report, transactional DDL failure rollback and new
scoped/check/unique constraints.

Additional cases cover reason boundaries/exhaustion, actual queued actor
revocation, competing handovers/close/timer and contradictory permission DTOs.
The shared session barrier now waits for each real lock waiter before starting
the next, rather than relying on JavaScript launch order to prove FIFO outcomes.
At that point, new browser journeys and the 19-table recovered-app extension were
implemented but their aggregate execution and final evidence were still pending.

## Failures investigated before the final aggregate

The first three browser journeys timed out on exact short names: the shared
fixture gives Alice/Bob UUID-suffixed names. The administration test now explicitly
sets its own synthetic display names; no production selector or behavior was
changed to accommodate this. A newly added DTO case was initially placed inside
another test callback; the runner rejected nesting, and it was moved to a
top-level case. No failing assertion was waived.

The subsequent focused command passed all 12 administration service cases,
compiled the production build and passed all three browser journeys. Transfer/
remove/readmit visibility was 1,890/2,461/1,376 ms between two visible identities,
each below the unchanged 5,000 ms threshold. Retained focus/drafts, original ballot,
running-clock equality, stale confirmations, one-POST lost responses, hidden/
offline/malformed reads and access clearing passed.

An independent 19-table recovery then passed, including original joins/ballots,
repeated removal/readmission and transfer attribution, new-facilitator readmission,
old/removed permission boundaries and an actual recovered-app restart. It also
retained every previous report/clock/order/parking/action proof. That preliminary
drill is `.local/recovery/3aea2653086e443199209bd763ab0c68/evidence.json`;
the final aggregate/drill below supersedes its generated browser evidence.

## Final unchanged aggregate

On 2026-10-28, the unchanged command chain
`npm run db:generate -> npm run gate:merge -> npm run verify:recovery` exited zero.
Type checks, warning-free lint and the production build passed.
**394 tests passed: 193 unit/component, 157 integration and 44 browser.**
`test-results/browser.xml` independently reports 44 tests and zero failures,
errors or skips. Existing pg overlapping-query deprecation warnings remain;
no dependency change or warning suppression was introduced.

| Criteria | Executed evidence |
|---|---|
| RM1/2 | Strict actor/target/team/role/phase/legacy/self/revision/exhaustion guards; both-direction transfer, exact clock/contribution equality; actual queued actor/target membership revocation, competing handovers/close/timer. |
| RM3/4 | Removed user denied all 19 existing contribution/admin/self-join paths while reading; repeated readmission preserves original join, ballot version, selections and budget. |
| RM5 | 0/4,000/4,001 trim/plain-text boundaries, captured target/revision/reason, explicit conflicts and after-event injected rollback; one-POST lost responses reconcile without replay. |
| RM6 | Required/cross-consistent administration DTO; old/new/removed permissions, stable focused controls/drafts, sub-five-second distinct visible identities, hidden/offline/malformed updates and access clearing. |
| RM7 | Closed administration frozen, active facilitator required for summary, historical roster includes removed people and explains joining rather than attendance/current permission; prior reports unchanged. |
| RM8 | Every original column/row across all 17 prior application tables, including valid report JSON, preserved; empty new event storage/null markers, scoped/check/unique constraints and post-DDL rollback verified. Exact 19-table archive restored and actual application restarted. |
| RM9 | All previous action/topic/voting/timer/parking/order/summary and active BugMagnet regressions passed in the unchanged aggregate. Publication/acceptance boundaries remain separate. |

Final measured transfer/remove/readmit visibility was **1,870/899/1,357 ms**,
each below the unchanged 5,000 ms threshold, with two distinct visible identities
and no propagation reload. Artifact:
`test-results/session-administration-RM2-9022e-nal-ballot-focus-and-drafts/session-administration-visibility.json`.
Prior-slice browser outputs were replaced by this aggregate:

| Surface | Latest measured visibility, ms |
|---|---|
| Voting start / vote / finalization | 1,902 / 1,881 / 1,937 |
| Timer start / pause / extend / resume / finish | 1,879 / 1,886 / 1,902 / 1,954 / 1,339 |
| Parking / restore / fresh restart | 1,426 / 1,385 / 1,905 |
| Manual move / restore / next start | 1,363 / 1,894 / 1,955 |
| Saved summary | 1,874 |

## Final archive and actual recovered-app restart

Evidence: `.local/recovery/b6acd0fee25e4bd7b36a69c45a389ad7/evidence.json`.
Started `2026-10-28T13:48:49.271Z`, finished `2026-10-28T13:49:11.081Z`.
Restore and exact comparison took 1 second. Custom archive SHA-256:
`1af0dec15dd350eedc6facc5dc8cd4e0dde744d8e2dcb6e851386429fc5501ee`.
All 19 public tables, including `_prisma_migrations`, matched exactly on an
independently created empty target. The archive contained only synthetic data,
with no auth sessions/provider tokens; runtime test sessions were created after
restoration. Both drill databases and the recovered app were removed afterward.

The recovered sole facilitator explicitly readmitted a removed participant.
Original join identity, two selected votes, ballot version/remaining budget,
four earlier attributed transfer/removal/readmission events and the fifth new
event remained correct through an actual process restart. The previous
facilitator remained an ordinary participant; removed users could read but not
self-join/administer. All running clocks were identical. Existing paused/
expired/finished attempts, repeated parking, original/manual positions and
reverse order history also remained intact. The linked action progressed to
Done while all captured summary fields stayed identical, before/after restart.

## Cleanup and release boundary

Stopped the owned PostgreSQL gracefully, then stopped its `admin-db` wrapper.
No listeners remained on 3100/3101/3102/55432. Final whitespace and lightweight
source private-key/GitHub-token pattern checks passed; these are not CI secret,
dependency or container scans.

No commit, push, production migration, maintenance or deployment occurred.
Accepted production remains `d22256b`. This completes the approved eighth local
slice, not production acceptance or Release 2 capabilities. The remaining
delivery boundary is fresh CI/scans, separately authorized encrypted production
backup/copy rehearsal of all six unpublished migrations, coordinated matching-
binary cutover, hosted OAuth/multi-identity timing and explicit human acceptance.
Do not run older binaries after removals, invent another product slice or treat
earlier release consent as permission for those operations.
