# Session participant and role management: technical design

Status: Gate B approved by the owner on 2026-10-28.
Date: 2026-10-28.
Prerequisite: owner-approved Gate A in
`spec/session-participant-and-role-management.md`.
Baseline: accepted production `d22256b` plus unpublished voting, discussion,
parking, manual order and meeting summary. The latest local aggregate passed
368 tests and exact 18-table archive/restarted-app verification, recorded in
`tasks/meeting-summary.md`. That is not administration evidence.

## Architecture and alternatives

Keep the existing single application, Auth.js, Prisma/PostgreSQL and validated
private snapshot. No new dependency, service, public route or permission system.
`TeamSession.facilitatorId` remains the single current facilitator.

Add a reversible removal marker to the existing participant record, not a delete.
`TopicVote` already has a restrictive compound FK to that record, which also
holds `joinedAt` and `ballotVersion`. Deletion/recreation would either fail or
erase budget/history. Never infer active permission from historical presence.

Retain an ordered event for each explicit administration operation. A current
marker alone cannot explain removal/readmission cycles or handover history;
event-sourcing every old session field would be unnecessary scope. Current rows
authorize operations; events provide immutable application history.

## Persistence and preserving migration

Add nullable `SessionParticipant.removedAt DateTime?`. Null means not removed.
Existing rows receive null; old IDs, join timestamps, ballot versions and votes
are unchanged. Removal sets the marker; readmission clears only that marker.
Do not delete/recreate participants or reset their ballot.

Add `SessionAdministrationKind` with TRANSFER, REMOVE and READMIT, and
`SessionAdministrationEvent`:

| Field | Meaning |
|---|---|
| teamId, sessionId | Authorized source scope, restrictive compound parent FK. |
| version | Primary key with sessionId; exact new lifecycle revision, positive. |
| kind | Explicit operation, not inferred from present roles. |
| actorId | Restrictive User FK, independent of current Membership. For TRANSFER this is the previous facilitator. |
| targetId | Restrictive compound FK to SessionParticipant(teamId, sessionId, userId). For TRANSFER this is the next facilitator. |
| createdAt | Post-lock absolute database time using existing numeric epoch helper. |
| reason | Trimmed plain text at most 4,000 characters, default empty; nonempty only for REMOVE. |

Add required Prisma inverse relations. Check positive version, distinct actor/
target and reason shape. Keep user attribution independent of Membership.
Safe names are projected from retained users, like existing parking/order history;
saved summary names/content remain captured and immutable.

Create a new explicitly transactional migration after meeting summary. Add the
marker and empty event table; do not fabricate historical transfers/removals.
Keep existing participant/vote keys and the named DEFERRABLE INITIALLY IMMEDIATE
planning-position constraint. Compare every original column/row, and inject
failure after new DDL to prove rollback of both marker and event creation.
Add no cross-table CHECK or trigger purporting to prove facilitator activity:
the application transaction enforces that invariant.

Fixture cleanup deletes administration events before participants/users/sessions.
Archive verification will compare 19 public tables including migration metadata.

## Strict commands and transaction

Add authenticated sessionCommand operations:
`transfer-facilitator`, `remove-participant`, `readmit-participant`.
Input is strict `{sessionId, targetId, version}`; only REMOVE additionally accepts
optional `reason`, trimmed/default empty/max 4,000. Reuse existing ID/version
validation and reject submitted actor, role, team, timestamp, status or history.

Use one small administration service with a runtime-validated operation enum.
Follow the existing ReadCommitted write transaction; no source-snapshot capture
is needed here. All affected session writes already serialize on its row:

1. Reuse `writableSession`: resolve authorized scope, lock TeamSession FOR UPDATE,
   recheck Membership FOR SHARE and require the actor's active joined record.
2. Require FACILITATED, nonclosed, current facilitator, exact lifecycleVersion
   and an incrementable revision. Reject self-targets.
3. Lock/recheck the target's same-team Membership FOR SHARE. Load the scoped
   target participant. TRANSFER/REMOVE require active; READMIT requires removed.
   Never create a target's first participant record or admit a foreign/former member.
4. Sample numeric `databaseNow` after locks. TRANSFER changes facilitatorId only;
   REMOVE sets target.removedAt; READMIT clears it. Preserve all original
   join/ballot values, topics, votes, agenda, clocks, actions and reviews.
5. Insert the attributed event at lifecycleVersion + 1 and increment that
   session revision once, atomically with the state change.
6. Commit or roll back everything. No request/transaction replay.

Target membership shares are compatible with other session writes; target
participation is protected by this session's existing row lock. Do not introduce
action locks or lock unrelated sessions. Membership revocation queued before
the target/actor recheck denies the operation; after a held share it waits until
this operation completes. Real concurrency tests establish the boundary.

Only the current facilitator can REMOVE, and self-targets are rejected. TRANSFER
requires an active target and leaves the actor's participation unchanged. Thus
no application operation removes the current facilitator or produces two.
If the operator revokes the sole facilitator's team membership, existing access
denial remains; this slice does not add automatic handover or an elevation bypass.

Current-state/revision failures are explicit conflicts; authorization failures
are denied. Duplicate target state is a conflict, not a successful second event.
Unexpected database failures reach the existing logged error boundary. Test
actual race/constraint signatures rather than treating every raw error as conflict.

## Every affected authorization surface

Centralize the existing joined check into a small active-participant guard:
the scoped row must exist and `removedAt` must be null. All session mutations
continue taking the same session lock before permission checks.

| Surface | Required change or preservation |
|---|---|
| createFacilitatedSession | Creator's new participant starts active. |
| joinSession | After current membership/session checks, reject a removed existing row. Existing active joins stay idempotent; genuinely new users self-join normally. Never upsert a removal away. |
| writableSession | For facilitated contribution writes, require active joined status. Keep Closed denial and legacy behavior unchanged. |
| createTopic/changeTopic/remove | Shared active guard plus existing collection/author/current-facilitator/topic-version checks. Former facilitator cannot edit others' topics after transfer. |
| createAction/reviewAction | Shared active guard; keep current team ownership, chronological follow-up, review uniqueness and atomic status/history rules. |
| setTopicVote | Shared active guard before loading the retained ballot/version. Removal blocks select AND refund; all previous selections still count. Readmission does not reset them. |
| votingControl/discussionControl | Shared active guard plus current facilitator and existing phase/version checks; these also protect parking/restoration/manual order. |
| generateMeetingSummary | Its separate Closed guard must also require an active joined facilitator. Do not weaken existing Closed source guards or change its RepeatableRead capture boundary. |
| session/action/history reads | Current team membership, not active session participation. Removed/nonjoined same-team readers remain authorized. |

A contribution that commits before removal is valid; once removal has acquired
the session lock and committed, later queued writes fail the active guard.
Transfer similarly invalidates the old facilitator's subsequent administrative
permission. Preserve separate ballot and topic versions: a role change is not
a new vote budget or an edit to topic content.

## Private snapshot and historical compatibility

Extend required SessionSnapshot with `administration`:

- Viewer participation: NOT_JOINED, ACTIVE or REMOVED; original join identity
  and nullable removal time are not silently defaulted.
- `canJoin`: current nonclosed facilitated view and no historical participant.
  An already removed viewer cannot be presented a working Join button.
- Stable joined-history entries with safe ID/name, original joinedAt, removedAt,
  current `inTeam` and server-computed canTransfer/canRemove/canReadmit.
- Ordered typed events with revision/kind/actor/target/time/reason.

Keep `participants` as the current active same-team roster, while administration
entries retain all historically joined people, including removed/former members.
Derive `joined` from active status, not mere row existence.
`facilitatorView` identifies the current active joined facilitator; every
administrative capability still includes nonclosed/phase constraints.

Retain the removed viewer's own ballot selections, remaining budget and version
for honest read-only display, but set canVote false. Aggregate counts include all
retained selections, even after removal. Keep other named ballots private.
Use current team membership to derive target eligibility; historical users
without membership are visible as history, never eligible transfer/readmit targets.

Validate all required fields and state relationships at the DTO boundary.
Missing/malformed administration data must fail the snapshot and disable writes,
not default to active/not-removed. Keep authorized uncached read-only
RepeatableRead transport and its existing unavailable/access-loss behavior.

Do not change summary format 1. Its source query intentionally includes every
historical participant record, not only active roster entries. Explain that
"Joined participants" records prior joining, not attendance or active permissions
at close. Capture the current facilitator when generating; never resolve old
saved names/roles/content live. Closed administration is denied, and existing
reports remain unchanged regardless of later administration elsewhere.

## Stable UI and confirmation

Add `SessionAdministration` within the protected workspace, showing current role,
active/removed/former-member labels, named target controls and event history.
Use stable original joined order and user-ID keys; role/status changes must not
reorder interactive rows. Do not expose team administration or invitations.

Capture target, operation, reason and lifecycle version when opening a named
confirmation. Transfer warns of immediate loss of facilitator power without a
target-acceptance step. Removal explicitly warns that same-team read access and
past contributions/votes remain. Readmission confirms restoration of prior
participation and budget, not creation of a new identity.

Pending stays through existing post-write snapshot reconciliation. No optimistic
role/removal state; failed/ambiguous commands retain local reason/confirmation.
Stale captured revision or target state disables confirmation until cancelled
and reviewed; never substitute a newer target/revision. Successful explicit
submission may clear only its own unchanged reason draft.

Update the workspace Join control to use `administration.canJoin`, and give
removed viewers a read-only/readmission explanation instead of "join to vote".
All old contribution forms use newly active `joined` semantics; do not globally
enable controls merely because historical participation exists.

Audit role-sensitive visibility in SessionWorkspace, DiscussionControls,
ParkingControls and AgendaOrderControls. Keep previously mounted facilitator
controls/drafts stable after role loss, explicitly disabled; never latch their
permissions. Initial ordinary readers still have no administrative controls.
Use guarded `aria-disabled` controls where native disabling would drop keyboard
focus, and readOnly rather than removing/disabling a focused retained editor.
Every handler checks CURRENT capability; retained visibility confers no authority.
In particular, retaining the old facilitation section requires a separate
current-facilitator gate, not generic participant `canWrite`.

Offline/hidden/invalid/pending/unsynchronized state disables administration.
Snapshot reconciliation grants/removes current capabilities without stealing focus.
Access loss unmounts all protected state, including retained drafts and reports.

## Migration, recovery and release safety

Preserve all old columns/rows, including required planning positions,
deferrability, old action/auth records and existing report JSON/attribution.
Verify initial active markers and no invented events. Test scoped actor/target/
kind/reason/revision constraints and post-DDL rollback.

Extend exact 19-table archive/recovery with transfer, removed/readmitted cycles,
retained original join/ballot state, active clock and unchanged contributions.
After restoring, continue an allowed operation with the new facilitator and deny
removed/old-facilitator commands. Verify original vote budget, administration
history, exact unrelated clocks and stored reports through actual app restart.

Old binaries would treat retained removed participant rows as active and could
ignore changed permissions. Do not mix pre-administration/current binaries or
use an ordinary rollback after removals. Rehearse all six unpublished migrations
from accepted production on an isolated copy; separately approve encrypted backup
and coordinated write-drain/migrate/matching-binary cutover. Roll forward; never
drop history or restore participation to make an older binary fit.

No commit/push, production migration, downtime, deployment or human acceptance
is authorized. Strict CI/scans, deployed source/region linkage, actual hosted
OAuth/multi-identity timing and explicit acceptance remain separate.

## Planned verification

Nothing below is executed administration evidence.

| Criteria | Planned proof |
|---|---|
| RM1 | Strict input and complete actor/target/team/phase/legacy/self/revision/exhaustion matrix; actual queued actor and target membership revocation. |
| RM2 | Both-direction handover, exactly one facilitator, former facilitator's remaining participant rights, unchanged clocks/content and real competing transfer/close/discussion barriers. |
| RM3 | Removed-user denial for every existing contribution/admin path and self-rejoin, including stale pages, vote refunds, topic ownership and Closed summary eligibility; same-team reads remain. |
| RM4 | Repeated remove/readmit cycles preserve original joinedAt, ballotVersion, selected votes and used budget; no first join or foreign/memberless admission is invented. |
| RM5 | Named revision-bound confirmation, 0/4,000/4,001 trim/plain-text reasons, stale target/revision conflicts, atomic post-state/event injected failure and one-POST lost responses. |
| RM6 | Measured distinct visible identities below 5,000 ms; active/removed/readmitted/new/old facilitator capabilities, stable focused controls and drafts, offline/hidden/malformed reads and access clearing. |
| RM7 | Closed/final-summary guard matrix; complete historical joined roster and immutable preexisting report equality. |
| RM8 | Every-original-column migration comparison, failure rollback, catalog/shape constraints, exact 19-table archive restore, authorized continuation and actual recovered-app restart. |
| RM9 | All AC/TC/VP/TD/PL/MO/MS and active BugMagnet tests, unchanged full aggregate/recovery; separate CI/scans and authorized hosted acceptance. |

Planned new test files: `tests/unit/session-administration.test.ts`,
`tests/unit/session-administration-controls.test.tsx`,
`tests/integration/session-administration.test.ts`,
`tests/integration/session-administration-migration.test.ts`,
`tests/e2e/session-administration.spec.ts`, plus affected regression fixtures and
`scripts/verify-recovery.ts`. Use real barriers, not scheduling sleeps or retries.
Tasks and implementation follow only after explicit Gate B approval.

## Gate B review

1. Retain participant rows with a nullable removal marker, preserving FK-bound
   votes, original join time and ballot version; add attributed administration
   events, without fabricating past changes.
2. One locked current-facilitator transaction rechecks actor/target membership,
   phase/state and exact revision; state, event and revision commit together.
3. Update every existing contribution guard, self-join, summary guard and private
   capability—not just the new buttons. Reads remain membership-based.
4. Keep role/removal confirmations and focused drafts stable while using current
   permissions, never latched facilitator power; no automatic replay.
5. Preserve saved report format/content, prove exact migration/19-table recovery
   and actual restart, and require separately authorized matching-binary cutover.

The owner selected "Approve Gate B" on 2026-10-28. This authorizes local tasks
and implementation, not publication, production migration, deployment or human
acceptance. Actual execution is tracked in `tasks/session-administration.md`.
