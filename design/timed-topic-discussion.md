# Timed topic discussion: technical design

Status: Gate B approved by the owner on 2026-10-28.
Date: 2026-10-28.
Prerequisite: Gate A approved in `spec/timed-topic-discussion.md`.
Baseline: accepted source `d22256b` plus the locally implemented voting slice.
Voting's local aggregate/recovery evidence is recorded in its task document;
neither slice is a newly accepted production release.

## Architecture and alternatives

Keep Next.js/React/TypeScript, Auth.js, Prisma and PostgreSQL, the existing
server-only service, typed server actions and private snapshot endpoint.
No new dependency, scheduler, broker, WebSocket, worker, hosted service or auth
mechanism. Keep Frankfurt placement, two-second polling/read timeout and the
five-second confirmed-change visibility target.

Persist deadlines or paused remaining time, never per-second tick writes.
Expiry is derived from the persisted deadline and database time. It does not
need a process alive at the deadline, so restart, browser suspension and database
compute suspension cannot accidentally pause a running discussion.

A browser-only timer would lose cross-device/restart integrity. An in-memory
server interval would not survive serverless execution. A scheduled expiry job
would add operational failure modes without an approved automatic transition.
The deadline model is the smallest implementation of the approved behavior.

## Additive persistence

Add one `TopicDiscussion` row only when an agenda topic actually starts.
An agenda entry without a discussion row is Not discussed.

| Entity | Planned change |
|---|---|
| AgendaEntry | Add scoped unique `(teamId, sessionId, topicId)` alongside existing primary/rank keys, for a restrictive discussion FK. Do not change any saved position or count. |
| TopicDiscussion | `teamId`, `sessionId`, `topicId`; primary key `(sessionId, topicId)`; scoped FK to AgendaEntry. |
| Timing/progress | Stored `state`: RUNNING / PAUSED / FINISHED; `deadlineAt` nullable; `remainingMs` nullable integer; `allocatedMs` integer; `startedAt`; nullable `finishedAt`. |
| Attribution | `startedById` and nullable `finishedById`, restrictive User references. Current membership is an authorization check, not a history-erasure FK. |
| Revision | Reuse TeamSession.lifecycleVersion for every discussion transition and collection/voting control. No second revision counter or current-topic pointer. |

Add a partial unique PostgreSQL index on `TopicDiscussion(sessionId)` where state
is RUNNING or PAUSED. It independently enforces at most one current topic.
Expired discussions remain stored RUNNING and still occupy that slot; expiry
never releases the topic for an implicit advance.

Migration CHECK constraints:

- allocatedMs is positive and at least the initial 300,000 ms.
- RUNNING has deadlineAt, null remainingMs and no finish metadata.
- PAUSED has no deadline, strictly positive remainingMs and no finish metadata.
- FINISHED has no deadline, nonnegative remainingMs, finishedAt and finishedById.
- Stored remainingMs cannot exceed allocatedMs. FinishedAt cannot precede
  startedAt. State-specific finish attribution must be complete.
- Retain every existing collection, voting, version, topic and rank constraint.

Scoped FKs guarantee an existing agenda topic; the partial index guarantees one
current row. Ordinary row CHECKs do not enforce a finalized/nonclosed parent or
the first unstarted rank: the locked service transaction does so. Do not claim
these cross-table invariants are database-row checks.

The migration adds empty discussion storage and indexes/constraints. It does not
backfill fictional discussions or modify any prior column/row. Keep restrictive
history deletion and extend test fixture cleanup before deleting agenda/people.
No schema or migration is changed before Gate B approval.

## Database clock and exact arithmetic

Use the integer epoch milliseconds from database `clock_timestamp()`, truncating
fractional milliseconds to match Prisma Date precision. Construct the Date from
that absolute numeric epoch, not an adapter-decoded local timestamptz value.
This avoids session-timezone-dependent driver conversion; test with an explicit
non-UTC transaction timezone. For mutations sample it after acquiring session/membership locks and
loading the current discussion, not before waiting in the lock queue.
Do not use transaction-start `CURRENT_TIMESTAMP` for a queued command's deadline.
Pass the sampled instant into a small pure timing/transition helper in
`src/lib/discussion.ts`; it must not import Prisma, React or authentication.

All stored durations are integer milliseconds; display formatting alone rounds
up to whole seconds. A pause at 200,001 ms remaining must retain 200,001 ms, not
201,000 or a fresh minute.

| Transition | Exact planned computation |
|---|---|
| Start | RUNNING; deadline = sampled now + 300,000; allocatedMs = 300,000. |
| Pause | Require RUNNING and deadline strictly after now; store deadline minus now as remainingMs, clear deadline, set PAUSED. |
| Resume | Require PAUSED with remainingMs > 0; deadline = now + remainingMs; clear remainingMs, set RUNNING. |
| Extend running | If deadline > now, add 120,000 to that deadline; otherwise use now + 120,000. Increment allocatedMs by 120,000. |
| Extend paused | Add 120,000 to remainingMs and allocatedMs; stay PAUSED. |
| Finish | Store the paused remainingMs, or max(0, deadline minus now); clear deadline; set FINISHED with sampled finish time and actor. |

Effective state is EXPIRED exactly when stored RUNNING has deadline at or before
the sampled now. It is a read projection, not a fourth stored state or a write
triggered by polling. At the exact deadline, pause/resume fail with
extend-or-finish guidance; extension grants 120,000 from now.

Guard integer/version and Date arithmetic before updates. There is no business
cap on extensions, but representational exhaustion is an explicit conflict,
never wraparound, clamping or silently missing time. Use the existing strict
expected-version validator and in-memory comparison before integer DB filters.
The database clock is the authority; the design does not promise correctness
under a broken/backward-moving database host clock.

## Serialized commands and authorization

Reuse `writableSession`: session FOR UPDATE, actor Membership FOR SHARE,
current joined participation and state checks. Preserve lock order:
session -> actor membership -> participant -> discussion/agenda/action.
Only the recorded facilitator can administer discussion. Resolve actor from
Auth.js, never input. Run sequential awaited queries inside one transaction.

Extend `sessionCommand` with start-discussion, pause-discussion,
resume-discussion, extend-discussion and finish-discussion.
Every command carries `{ sessionId, topicId, version }`:

- Require FACILITATED, PAUSED collection, FINALIZED voting and matching
  lifecycleVersion. Closed/legacy/pre-finalized sessions reject.
- Start requires no current discussion. Query the lowest saved agenda position
  without a discussion row; require its ID to match topicId before inserting.
  No remaining entry is an explicit conflict, not a restart or successful no-op.
- Other commands require that exact current topic and valid effective state.
  Finished, nonexistent, foreign-session or other agenda topics cannot be used.
- Each successful transition updates the discussion and increments
  lifecycleVersion atomically. No automatic replay, even for pause or finish.
- Failure leaves all discussion/timing/revision values unchanged.

The same session lock serializes two starts, extension versus pause/finish and
start versus close. Exactly one matching revision wins; stale requests conflict
instead of extending twice, starting a different topic or finishing newer work.
Sample time only after queued locks so a delayed resume grants the preserved
duration, not a deadline already partly spent while waiting.

Extend `changeCollection` with a server-side current-discussion guard for close,
in addition to the existing finish-voting guard. A current row blocks closure
even after expiry. Finishing and closing stay separate transactions/confirmations.
Every discussion transition increments the version used by closure, so an old
close confirmation cannot silently apply after new discussion progress.
Topic/ballot/rank freezes remain; action capture/review and explicit late joining
retain approved nonclosed behavior.

Current membership is rechecked under lock. A revocation committed before the
membership lock denies the write; an authorized transaction already holding the
shared membership lock finishes before deletion. Stored attribution survives
revocation and restoration without resetting progress.

## Snapshot and browser time

Extend the validated private SessionSnapshot with required `discussion` data:

- a database sampledAt timestamp, captured after reading rows in the existing
  read-only RepeatableRead transaction;
- saved-rank progress per topic: Not discussed, current or Discussed, including
  start/finish attribution/times and total allocated time for started topics;
- nullable current topic with persisted timing fields and effective state/
  remainingMs computed from that single sample;
- next topic ID, lifecycleVersion and server capabilities for each operation;
- canClose narrowed by the absence of a current discussion.

For the current-topic wire projection, `state` is RUNNING, PAUSED or EXPIRED,
`deadlineAt` is the nullable persisted deadline, and `remainingMs` is always the
nonnegative duration at sampledAt, not RUNNING's null storage field. History
entries use an explicit Discussed outcome for FINISHED rows. Do not mix the
storage enum with its derived client state or use a client estimate as command
input.

Snapshots remain coherent, authenticated, private/no-store and runtime-validated.
Do not cache timers publicly, include another person's ballot or fetch raw auth
records. A missing/malformed discussion field is a failed read, not an invented
five-minute fallback. Expiry reads do not write or increment versions.

In the browser, treat the rendered countdown as an estimate anchored to a fresh
server remainingMs sample and elapsed `performance.now()`, never Date.now or the
device wall clock. Record request/receipt monotonic instants; account for estimated
return transit using half the round-trip interval. This is an estimate, not a
claim of exact one-way latency or network clock synchronization. The existing
two-second read deadline bounds the age of an accepted response.

Pair accepted snapshot and timing anchor in one confirmed-state update guarded
by the existing generation/cancellation checks. A discarded old response cannot
replace either the data or its clock anchor. On initial server-rendered load,
show Synchronizing timer and keep timer controls disabled until an immediate
authorized client refresh supplies a timing sample; do not assume hydration was
instant or use a client wall-clock offset.

Run a local display tick at least once per second while current, visible and
available. Derive time from the monotonic anchor each tick; never decrement a
counter once per callback. Clamp display to zero without changing server state.
Every command revalidates effective state against database time, even if a
network-delayed estimate momentarily shows a different remaining second.

On hidden/offline transitions invalidate in-flight reads, label last-confirmed
timing as stale and disable writes. Failed reads have the same stale behavior.
On return/focus/reconnection, refresh before claiming a current countdown.
A suspended tab does not replay missed ticks. Preserve the existing two-second
polling and five-second shared-change target; no tick generates a server write
or an extra network request.

## UI, confirmation and accessibility

Add a separate Timed discussion section beside the read-only final agenda.
Show the current topic by stable ID, formatted minutes/seconds, explicit
Running/Paused/Time expired label and next topic. Preserve the existing stable
topic cards and action/review form identity; do not key them by time, revision
or current rank.

Use clearly named keyboard controls. Pause/resume/extend are immediate explicit
commands; Finish topic has a confirmation capturing topicId and lifecycleVersion.
Cancel changes nothing. After finish, Start next topic remains separate.
Stale confirmation disables itself with reconcile guidance. All discussed shows
the outcome rather than a restart control. Explain why close is blocked by a
current discussion, including an expired one.

Reuse pending-through-reconciliation behavior: disable subsequent commands until
the fresh snapshot has completed; reveal success/error with current enabled or
stale controls. Ambiguous committed responses are never automatically replayed.
Keep protected drafts in component memory only; access loss unmounts them.

Expose textual states and a readable timer without a per-second live region.
Announce state/topic transitions and expiry once per meaningful transition,
including an expiry after a later extension, not on every poll/tick. Key expiry
announcements by topic and confirmed deadline so a clock-estimate correction
around zero cannot announce the same expiry repeatedly. Preserve
focus during ticking, topic progress refresh and remote changes.

## Migration, recovery and release safety

- Add a new Prisma migration after all three existing migrations, never rewrite
  an accepted or already-applied migration. No production connection during TDD.
- Compare every original column/row across existing tables, including ballots,
  stored agenda, removals and auth, before/after migration on an isolated target.
  Assert empty discussions and unchanged defaults/history.
- Extend the isolated archive/recovered-app drill with running, paused and finished
  discussions. Compare all public tables exactly, then actually restart the
  recovered app. Verify paused time unchanged and running deadline unchanged,
  including a deliberately past deadline that reads expired without a write.
- Before a production migration, verify encrypted backup and rehearse against an
  isolated production-copy branch using a direct migration connection; keep pooled
  runtime traffic and the existing driver/ORM. Do not provision replacement Neon
  infrastructure or change private environment files for this feature.
- Additive schema is old-binary compatible only before discussion is used.
  Once current discussion exists, older voting code lacks the new closure guard.
  A partial index does not stop that old binary from closing a session.
  **Do not roll back to pre-discussion code after use.** Default to roll-forward;
  an emergency alternative needs explicit maintenance/access approval.
- Old browser tabs can submit old actions; the new server/version checks remain
  authoritative. Reconcile or reload on DTO/action version mismatch.
- Commit/push, CI/scans, production migration/deployment, real two-user hosted
  timing/OAuth and human pilot acceptance remain separate permissions/evidence.
  Gate B cannot waive them or declare the voting slice released.

## Planned verification

This is a proposed plan, not implemented tests or passing evidence.

| Criteria | Planned proof |
|---|---|
| TD1 | Finalized/nonfinalized/legacy/closed and role/join combinations; scoped first-rank selection; partial unique index rejects a second current topic independently. |
| TD2 | Pure exact-ms transitions at before/equal/after deadline, pause/resume, every extension state and integer exhaustion; queued command samples post-lock database time. Wrong browser wall clock does not affect authoritative time. |
| TD3 | No mutation at expiry, no implicit next topic, confirmed finish/cancel, immutable completion and distinct discussed/not-discussed history. |
| TD4 | PostgreSQL blocker/barrier races: simultaneous starts, double extension, pause/extend, finish/extend, close/start and membership revocation. Inject transaction failure between discussion write and session revision to prove full rollback. No scheduling sleeps. |
| TD5 | Current expired/paused/running rows block close; finish then close succeeds; untouched ranks/counts, unstarted topics and accepted action/review flow. |
| TD6 | Two distinct visible contexts measure start/pause/resume/extend/finish propagation below 5,000 ms; late joins, keyboard, stable drafts/focus and local ticking. |
| TD7 | Same-user stale tab and lost committed extension response with exactly one POST, offline/hidden/reconnect, malformed snapshots, expiry/revocation and foreign/anonymous administration denial. |
| TD8 | Every-original-column migration comparison, exact all-table archive restore and actual app restart with running/paused/finished state and attribution. |
| TD9 | Existing AC/TC/VP and active BugMagnet tests, full local aggregate, strict CI/scans, hosted release and explicit acceptance remain required. |

Use injected instants for arithmetic tests. For real persistence/expiry cases,
seed explicit deadlines around a sampled database time or use coordinated locks;
do not make a suite sleep five minutes or weaken threshold assertions.
Browser display tests may control local clock/ticks while the server clock remains
real; separate that evidence from actual distinct-user propagation timing.

## Gate B review

Verify these implementation trade-offs:

- Persistent database deadlines/paused milliseconds, derived expiry and a
  monotonic browser estimate; no scheduler or per-second database updates.
- One current row enforced by a partial unique index; session lock, shared
  membership guard and lifecycle revision make commands atomic and stale-safe.
- Discussion progress is separate from immutable votes/ranks; missing rows mean
  Not discussed, never invented history.
- Shared snapshot/time anchoring preserves drafts/focus and disables timer
  writes until fresh synchronization or after uncertain responses.
- Additive migration and real restart/recovery evidence are required; old code
  cannot safely enforce the workflow after discussion has been used.

The owner selected "Approve Gate B" on 2026-10-28 after reviewing this design and
its technical checklist. This authorizes tasks/TDD within the approved scope.
Execution results belong in `tasks/timed-topic-discussion.md`; approval is not
evidence that implementation, migration or release checks have passed.
