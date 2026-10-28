# Parking lot: technical design

Status: Gate B approved by the owner on 2026-10-28.
Date: 2026-10-28.
Prerequisite: owner-approved Gate A in `spec/parking-lot.md`.
Baseline: accepted source `d22256b` plus locally verified voting/timed discussion.
Neither approval nor those local results publish a new release.

## Architecture and alternatives

Keep the existing Next.js/React, Auth.js, Prisma/PostgreSQL, server-only service,
typed actions and private RepeatableRead snapshot. Keep the existing session lock,
membership lock, lifecycle revision, two-second polling/read deadline and
five-second confirmed-change visibility target. No dependency or infrastructure
change, worker, scheduler, message broker or new authentication mechanism.

Make each actual timebox a first-class attempt and record parking transitions
separately. Waiting topics need parking history without a fictional discussion;
restored topics need multiple real timeboxes without erasing any previous one.

Resetting the existing singleton discussion would destroy history. Copying it
to an archive before every restart would create two competing representations.
Instead expand its key to include an attempt number. This is a data-preserving
schema/key evolution, **not an empty-table-only additive migration or a promise
of old-binary compatibility**. The rollout restriction below is deliberate.

Derive current parking state from the latest retained event. A separate mutable
parked flag/pointer would duplicate that truth and add another atomicity obligation.
This is a small scoped history table, not a general event-sourcing framework.

## Persistence

| Entity | Proposed change |
|---|---|
| TopicDiscussion | Keep every existing column. Add positive integer `attemptNumber`, default 1, and nullable `outcome`: DISCUSSED / DEFERRED. Primary key becomes `(sessionId, topicId, attemptNumber)`; scoped unique becomes `(teamId, sessionId, topicId, attemptNumber)`. |
| AgendaEntry | Keep original scoped identity, saved position and vote count. Change only the Prisma reverse relation from optional discussion to a collection of attempts. |
| TopicParkingEvent | `teamId`, `sessionId`, `topicId`, positive integer `version`, `kind`: PARK / RESTORE, `reason` default empty text, `createdAt`, `actorId`, nullable `attemptNumber`. Primary key `(sessionId, version)`. |
| Parking scope | Restrictive composite FK to AgendaEntry; optional scoped FK to the exact stopped TopicDiscussion attempt. Restrictive User FK for actor; no FK to current Membership. Index `(teamId, sessionId, topicId, version)` for ordered per-topic history. |
| Revision | Event version is the resulting `TeamSession.lifecycleVersion`, not another counter or client timestamp. Every successful park/restore increments that version once. Timer/close commands keep sharing it. |

Keep the existing partial unique index on TopicDiscussion(sessionId) where state
is RUNNING or PAUSED. It still enforces one current attempt across all topics and
attempt numbers. Expired remains stored RUNNING and occupies the same slot.
Add a partial unique index on `(sessionId, topicId)` where outcome is DISCUSSED:
at most one permanent completion per topic.

Stored FINISHED now means the timebox ended. `outcome` distinguishes Discussed
from Deferred; never infer permanent completion from FINISHED alone. Backfill
outcome DISCUSSED only for existing FINISHED rows. Existing RUNNING/PAUSED rows
retain null outcome; all existing rows become attempt 1. This preserves facts
already stored, without inventing park events or earlier attempts.

Preserve duration and timestamp precision checks. Extend state checks so that:

- RUNNING/PAUSED have null outcome and their existing clock/metadata shape.
- FINISHED has outcome DISCUSSED or DEFERRED, no deadline, exact nonnegative
  remainingMs, end attribution and finishedAt >= startedAt.
- attemptNumber and event version are positive PostgreSQL integers.
- PARK has a trimmed reason of at most 4,000 characters; an empty reason is valid.
  An optional attempt link identifies only the current timebox stopped by this
  park. Parking a waiting/restored-but-not-started topic has no attempt link.
- RESTORE has empty reason and no attempt link. It never rewrites the preceding
  PARK reason. Optional attempt numbers, when present, are positive.
- A scoped unique `(teamId, sessionId, topicId, attemptNumber)` on parking events prevents
  linking the same stopped attempt twice; null links allow repeated waiting cycles.

The ordinary CHECKs/FKs/indexes do not prove alternating PARK/RESTORE events,
parent finalization/nonclosure, current-not-parked, or no restart after Discussed.
The locked service enforces these cross-row/table invariants. Terminal attempts
and event rows are immutable through the application; there is no claim of
database-wide immutability against a privileged operator's ad hoc SQL.
No application delete/update path for historical events or terminal attempts.

## Shared progress and timing rules

Use a small framework/database-independent helper in `src/lib/parking-lot.ts`
for scoped progress/eligibility projection. Both service validation and snapshots
use it, rather than independently implementing subtly different next-topic rules.
Input is saved rank plus attempts and revision-ordered parking events.

For each topic:

1. A DISCUSSED terminal attempt means permanently Discussed.
2. Latest event PARK means Parked, with that event's reason/actor/time.
3. A RUNNING/PAUSED attempt means current; derive RUNNING/PAUSED/EXPIRED with the
   existing exact timing helper.
4. Otherwise it is waiting Not discussed, including restored topics with earlier
   DEFERRED attempts. Having any prior attempt no longer makes a topic ineligible.

Reject contradictory stored projections explicitly; do not silently select one
of two current attempts or hide Parked/Discussed inconsistencies as empty history.
Use original saved position for next eligible topic: exclude Parked and Discussed.
Even when a restored earlier rank is next, a different current attempt continues
and prevents Start until separately finished or parked.

Reuse `databaseNow`'s absolute epoch milliseconds sampled after lock acquisition
and row loading. Reuse exact timing arithmetic in `discussion.ts`:

- Park current: use finish arithmetic, storing FINISHED/DEFERRED with the same
  sampled time/actor as its PARK event. Retain allocatedMs, startedAt/startedBy,
  exact paused remainingMs or max(0, deadline - now). Clear the old deadline.
- Park waiting: append PARK only; create no discussion, duration or start metadata.
- Restore: append RESTORE only. Do not start/resume/change any timebox.
- Explicit next Start: insert `max(attemptNumber) + 1`, or 1 for a never-started
  topic, with a new 300,000 ms allocation/deadline. Never update a prior attempt.
- Finish current: FINISHED/DISCUSSED using the existing exact finish arithmetic.
  Neither current operation starts the next topic.

Do not use timestamps to order repeated cycles; lifecycle versions order events
and attempt numbers order actual starts, even within the same millisecond.
Guard lifecycle/attempt-number exhaustion before any write, plus existing
duration/Date limits. Fail explicitly, not overflow, wraparound or silent capping.
The existing database clock assumptions and non-UTC regression remain in force.

## Commands, authorization and atomicity

Add `park-topic` and `restore-topic` to `sessionCommand`, routed to the existing
server-only service. Strict schemas:

- Park: `{ sessionId, topicId, version, reason? }`; trim reason and apply the
  repository's text-length validation. Omitted/whitespace reason becomes empty.
- Restore: `{ sessionId, topicId, version }`.
- Do not accept actor, role, time, rank, attempt number or desired history from
  clients. Reject unknown keys and malformed/oversized input visibly.

Use `writableSession`: session FOR UPDATE -> current Membership FOR SHARE ->
joined participation -> scoped agenda/attempt/history. Require FACILITATED,
PAUSED collection, FINALIZED voting, current joined facilitator and matching
lifecycleVersion. Reload/check under the same locks, not only before queuing.

Park requires an existing active scoped agenda topic that is neither Parked nor
Discussed. It may be waiting or exactly the current topic. Another topic's current
timer stays untouched. For current parking, terminalize that exact attempt and
insert its linked event; for waiting parking, insert the unlinked event. Restore
requires Parked and not Discussed; insert RESTORE without touching any attempt.
In both cases increment lifecycleVersion in the same transaction.

Use the full scoped attempt key and live-state guard for pause/resume/extend/
finish/park writes. Update all singleton-dependent queries/fixtures, not only
Start. Start reads the shared eligible projection, validates the requested exact
next topic and inserts the next numbered attempt. LifecycleVersion makes an old
topic-ID command conflict even when that topic has since started a newer attempt.

Concurrent starts, park/finish, park/extend, park/start, park/close, restore/start,
restore/close and simultaneous parking controls serialize through the same
session lock. One matching revision wins; stale/replayed commands conflict and
reconcile. No automatic retry, blind toggle or success-shaped duplicate no-op.

An intermediate write failure rolls back clock changes, event insertion and
revision together. Revocation before the shared membership lock denies the write;
authorization already holding that lock completes before deletion. Historical
attribution survives membership changes. Closed sessions reject all writes.

Close still requires no RUNNING/PAUSED attempt, including expired. Parking is an
explicit alternative to Finish before Close, not a hidden side effect of Close.
Update guidance accordingly; preserve captured close revisions. Parked/unstarted
topics do not themselves block close. Topic/ballot/rank freezes, explicit late
joining, actions and reviews keep their existing nonclosed behavior.

## Snapshot, UI and accessibility

Extend the authenticated, private/no-store, runtime-validated SessionSnapshot in
the same read-only RepeatableRead transaction:

- Topic-level discussion progress adds PARKED; retain the existing NOT_STARTED
  token for waiting Not discussed, including restored topics. This token is not
  evidence of zero historical attempts.
- Replace flat per-topic timing-history fields with an ordered `attempts` array:
  attemptNumber, effective state, nullable outcome, deadline, sampled/exact
  remainingMs, allocatedMs, start/end timestamps and person projections. Preserve
  current timing fields and add current attemptNumber for stable attempt identity.
- Add required parking data with per-topic current parked status, ordered events
  (version, kind, reason, actor/time, nullable linked attemptNumber), canPark and
  canRestore. Use safe person projections, never raw auth records or other ballots.
- Compute nextTopicId and capabilities from the shared progress projection. All
  Discussed is true only when every final agenda entry is permanently Discussed.
  No current and no eligible topic with parked entries means No eligible topic
  to start, not All topics discussed.

Update all DTO consumers/tests together. Missing/invalid parking/attempt data
fails the read and disables writes, not an empty parking-lot fallback. Server
capabilities are presentation hints; mutations always authorize again.

Keep interactive topic controls at stable topic-ID locations. Add a parking
controls component and a separate read-only parking-lot/history section; a remote
move must not remount forms or move focused buttons with the agenda. Keep reason
drafts by topic ID in protected component memory through pending, cancel, errors,
remote updates and closure. Access loss unmounts and clears all protected drafts.
No local storage or reason HTML rendering.

Park/restore confirmations capture topicId, lifecycleVersion and current attempt
identity/operation for presentation. Never replace the captured version after a
poll. Parking a current topic explains stop/Deferred/fresh-next-timebox behavior;
restore explains original-rank eligibility and no interruption/start. Cancellation
does not write or clear reason drafts. A stale confirmation disables confirmation
and requests cancellation/review, not an automatic new command.

After save, retain the existing pending-through-reconciliation behavior. Clear a
reason draft only after confirmed successful save; an ambiguous response keeps
it and requires a fresh snapshot. Do not automatically replay a committed move.
Hide/disable writes offline, hidden, stale or awaiting initial synchronization;
reconnect/focus refreshes before re-enabling them.

Show Parked / Not discussed / Discussed distinctly in final-agenda progress,
without changing saved ranks/counts. Display title/description, original rank/
count, current reason/actor/time, all park/restore cycles and all real Deferred/
Discussed timeboxes, including in closed history. Use topic-specific accessible
controls and confirmation/error/state announcements. The lot/history is readable
by current same-team readers who have not joined; no administrative controls.

Keep the monotonic countdown, paired snapshot/time anchor and no tick writes.
Include attemptNumber in current-timer/announcement identity so a restored
timebox is not confused with an earlier attempt. No per-second live-region spam.
Measure actual two-user park/restore/current/next visibility under 5,000 ms
without reload and preserve keyboard focus and action/review/reason drafts.

## Migration, recovery and rollout

Create a new migration after the timed-discussion migration; never rewrite
already-applied migration files. Explicitly transact the data/key/check/FK
evolution so an error cannot leave half-replaced keys or partially backfilled
outcomes. New enum types are created in this migration; no existing enum value
needs alteration. Preserve every original business/auth column and row.

On an isolated pre-parking schema, seed running, paused (fractional-second
remaining), expired and finished discussions. Compare every original column
before/after; verify attempt 1, correct null/DISCUSSED outcomes and zero invented
parking events. Exercise new keys, scoped FKs, state checks, unique current and
unique Discussed indexes, including rejection/rollback of invalid writes.

Extend `verify:recovery` with waiting-parked topics, current-parked Deferred
attempts, repeated restore/start/defer cycles, a restored waiting topic and a
finally Discussed topic, plus the old running/paused/expired/finished cases.
Compare every public table exactly after archive restore, then actually restart
the recovered application and verify history, reasons, eligibility and clocks.
Reads/restarts must not append events or alter rows/deadlines. Keep all existing
action/topic/vote recovery flows. Test fixture cleanup respects new restrictive
FKs: events before attempts before agenda/people.

Production needs separately authorized backup, direct-connection rehearsal on an
isolated production copy, migration and coordinated deployment. Private pilot
environment files, pooled runtime driver and Frankfurt placement stay unchanged.
Do not provision replacement infrastructure or test against production.

Treat key/DTO evolution as requiring a coordinated cutover; do not serve
pre-parking and parking binaries concurrently against the migrated database.
Rehearse/plan a brief write-maintenance/drain boundary before migration, then
activate the matching new binary. Old tabs talk only to the new authoritative
server and must reconcile/reload on action/DTO mismatch. These are rollout
requirements, **not authorization to interrupt or migrate the pilot now**.

After migration, roll forward by default. Never drop attempt columns/events or
restore the old singleton key as a routine rollback: repeated attempts would
collide and history would be lost. An emergency restore requires an explicitly
approved maintenance/data-recovery plan. Even the preceding timer binary cannot
correctly interpret Deferred attempts or parking eligibility.

New commit/push, strict CI/scans, hosted OAuth/two-identity journey, actual region/
source linkage and human pilot acceptance remain separate permissions/evidence.
The preceding 266-test result does not cover this proposed implementation.

## Planned verification

This is the approved verification plan. Actual execution results and remaining
delivery evidence are recorded in `tasks/parking-lot.md`.

| Criteria | Planned proof |
|---|---|
| PL1 | Strict input/role/join/phase/team/nonexistent/removed-topic matrices; current-membership revocation under actual queued locks; same-team nonjoined history-only reads. |
| PL2 | Waiting park creates an event but no attempt; reason trim/empty/limit/text rendering and retained attribution; unchanged topic content/votes/ranks/counts. |
| PL3 | Exact-ms current parking before/equal/after expiry and while paused; FINISHED/DEFERRED with allocation/remaining and no deadline/advance. Reuse timing/timezone assertions. |
| PL4 | Multiple waiting cycles and multiple actual attempts; restore while another topic is current; original eligible order, fresh 300,000 ms start and immutable old attempts; Discussed irreversible. |
| PL5 | All-parked versus All discussed, mixed waiting/parked/Discussed closure and closed history; current still blocks close; unchanged action/review/late-join behavior. |
| PL6 | Real PostgreSQL queue barriers for park/finish/extend/start/close, restore/start/close, duplicate and competing controls, revocation. Scoped test-only injected failure after timebox/event writes before revision proves complete rollback. |
| PL7 | `tests/e2e/parking-lot.spec.ts`: two distinct visible identities measure park/restore/current/next updates below 5,000 ms; keyboard controls, confirmation/cancel and stable focus/drafts. |
| PL8 | Stale confirmation across same-topic newer attempts, lost committed park/restore response with one POST/no replay, offline/hidden/reconnect, malformed snapshots and protected-draft clearing on access loss. |
| PL9 | `tests/integration/parking-lot-migration.test.ts`: every-old-column preservation and new integrity checks. Extended exact all-table archive/recovered-app restart verification. |
| PL10 | `tests/unit/parking-lot.test.ts` and component checks, `tests/integration/parking-lot.test.ts`, existing AC/TC/VP/TD/BugMagnet regressions, full local aggregate/recovery; separate CI/scans and hosted release/acceptance. |

Use deterministic injected instants for arithmetic and real lock barriers for
races, not scheduling sleeps or five-minute waits. Adapt old test references to
the attempt key/DTO without deleting assertions about unparked behavior. Keep the
existing keyboard retry, clock/timezone and captured-close regressions intact.

## Gate B review

- Preserve original discussion rows as attempt 1, then append new numbered
  timeboxes; retain Deferred versus Discussed outcomes and immutable prior attempts.
- Retain ordered parking events, including waiting topics with no fictional
  attempt; derive parked state without a second mutable flag.
- Reuse session/membership locks, exact server clock and lifecycle versions so
  timer changes, events and eligibility commit together and stale commands fail.
- Reuse private snapshots, stable controls/drafts and monotonic timing; no new
  infrastructure or background automation.
- Require data-preserving migration/recovery proof and a separately authorized
  coordinated cutover; no mixed old/new binaries or destructive schema rollback.

The owner selected "Approve Gate B" on 2026-10-28 after reviewing this design and
its technical checklist. This authorizes task planning and TDD, not publication,
production migration, maintenance or human pilot acceptance. Execution evidence
belongs in `tasks/parking-lot.md`.
