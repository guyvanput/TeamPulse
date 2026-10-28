# Manual agenda order: technical design

Status: Gate B approved by the owner on 2026-10-28.
Date: 2026-10-28.
Prerequisite: owner-approved Gate A in `spec/manual-agenda-order.md`.
Baseline: accepted source `d22256b` plus locally verified voting/timers/parking.
Those unpublished changes have 312-test and 16-table recovery evidence in
`tasks/parking-lot.md`; that evidence does not validate this new behavior.

## Architecture and alternatives

Keep the existing single application, Auth.js, Prisma/PostgreSQL, private
RepeatableRead snapshot, two-second polling/read deadline and five-second shared
visibility requirement. No dependencies, infrastructure, background jobs or
per-second writes. Reuse session/membership locks and lifecycle revisions.

Persist a complete planning permutation alongside immutable vote rank, rather
than rewriting rank or storing only the currently eligible subset. A complete
permutation retains a parked/current topic's planning slot even while it is
temporarily absent from the future eligible queue.

Dynamic priority overrides based on counts would conflate vote results and
facilitator intent. A single client array would lose restart/shared integrity.
Fractional/sparse sort keys add precision/renumbering cases unnecessary for
approved adjacent swaps. A complete integer permutation and transactional
two-position swap are the smallest durable model.

## Persistence

| Entity | Proposed change |
|---|---|
| AgendaEntry | Add required positive integer `discussionPosition`. Keep original `position`, voteCount and scoped identity unchanged. |
| Planning permutation | Unique `(sessionId, discussionPosition)` as a named PostgreSQL DEFERRABLE INITIALLY IMMEDIATE constraint; ordinary positive-position CHECK. No FK targets this mutable ordering key. |
| AgendaOrderChange | `teamId`, `sessionId`, positive integer `version`, `actorId`, `createdAt`, `topicId`, `neighborTopicId`, `direction`: EARLIER / LATER, `beforeQueue` and `afterQueue` JSON arrays of topic IDs. PK `(sessionId, version)`. |
| History scope | Restrictive composite FKs for both topics to the same AgendaEntry scope; restrictive User FK for actor. No current-Membership FK. |
| Revision | Resulting TeamSession.lifecycleVersion is the event version; every successful swap increments it once. No new counter, current pointer or reorder toggle. |

Migration backfills discussionPosition = existing position on every saved
AgendaEntry, then enforces nonnull/positive/unique. Existing original columns and
all attempts/parking history remain unchanged. No fabricated order-change events.
Future voting finalization atomically supplies both positions from its complete
final rank; update every direct fixture/recovery constructor accordingly.

The history arrays record only the future unfinished/noncurrent queue at that
move, including parked placeholders, before and after the adjacent swap.
Their topic IDs remain readable later because scoped topic/history deletion is
restricted. Keep actor/time and order history immutable through the application.
Read person names through existing safe person projections, not auth records.

CHECKs enforce positive version, distinct topic/neighbor, both JSON values being
arrays of equal length at least two, and valid enum direction. Scoped FKs protect
the two explicit topic identities. The locked service additionally validates
complete scoped ID sets, uniqueness, adjacency, a two-ID swap, current/nonclosed
phase and matching event version. Do not claim ordinary JSON CHECKs/FKs prove
every historical array element or cross-table lifecycle invariant.

## Full positions versus future queue

Maintain all final agenda rows in one complete discussionPosition permutation
1..N, even for current and Discussed topics. Validate this invariant in the
shared projection; missing/duplicate/gapped stored positions fail explicitly.
Original final vote position remains its own complete immutable permutation.

Extend `parkingProgress` to accept required discussionPosition:

- Keep returned per-topic progress/parking entries in original vote-rank order.
  Existing interactive parking controls must not move when planning order changes.
- Add `future` entries sorted by discussionPosition, excluding current and
  permanently Discussed topics but including parked placeholders.
- Select nextTopicId from the first Not discussed entry in future; parked entries
  never become eligible merely because they were moved.
- Current, attempts/outcomes, parking history and allDiscussed keep their existing
  meanings. FINISHED alone is still not permanent Discussed.

Swap adjacent IDs in `future`, not necessarily adjacent physical slots. Their
full discussionPosition values are exchanged. Positions of all other topics,
especially current/Discussed ones, remain exactly unchanged. The full permutation
therefore stays complete without renumbering history or temporary sentinel slots.

Example: full plan `[A(current), B(parked), C, D(Discussed), E]` has future
`[B, C, E]`. Move E earlier swaps C/E's full positions; A and D retain their
positions. If A is later parked, its unchanged full slot makes future
`[A(parked), B(parked), E, C]`. Restoring a topic changes eligibility, not position.
No current clock is interrupted and no timer starts as a side effect.

Without explicit moves, discussionPosition always equals vote position, so
original-rank start/parking/restoration behavior is unchanged.

Put pure adjacency/swap planning and validated history-vector logic in
`src/lib/agenda-order.ts`, using the same projected future queue as the service
and snapshot. Reject bad directions, missing/moved neighbors, duplicates and
boundary moves explicitly, without manufacturing a success event.

## Serialized command and database uniqueness

Add `move-agenda-topic` to sessionCommand with strict input:
`{ sessionId, topicId, neighborTopicId, direction: earlier | later, version }`.
Accept existing strict numeric expected-version syntax; reject unknown keys and
submitted actor, time, positions, arrays or capabilities. Server derives all
stored values from current authorized rows, not a supplied full-order array.

Reuse `discussionControl` for FACILITATED, PAUSED collection, FINALIZED voting,
joined current facilitator and expected lifecycleVersion. Lock order remains
session FOR UPDATE -> current Membership FOR SHARE -> participation -> scoped
agenda/attempt/parking reads. Time is sampled after those locks/reads with the
existing absolute database-epoch helper.

Within one transaction:

1. Load and validate the shared progress projection. Both topic IDs must be
   active scoped future entries; parked is allowed, current/Discussed is not.
2. Purely verify exact requested direction and neighbor against the captured
   revision's future adjacency. Guard lifecycle exhaustion before writes.
3. Defer only the named planning-position unique constraint in this transaction.
   Swap the two positive positions with one parameterized SQL UPDATE scoped by
   team/session/exact topic IDs; require exactly two affected rows.
4. Insert attributed immutable before/after future order history at version + 1.
5. Increment lifecycleVersion. Require uniqueness again before commit (or at
   deferred commit enforcement); any constraint/failure rolls back everything.

Do not use position zero, negative positions, delete/reinsert, arbitrary temporary
slots or broad constraint disabling to get around uniqueness. The scoped FK/PK,
positive CHECK and original vote-position uniqueness remain active throughout.
Declare uniqueness and its exact constraint name in the Prisma schema; retain
deferrability in the custom migration SQL. Name mapping alone is not protection
against a future migration changing deferrability. Add a PostgreSQL catalog
assertion and review generated migration SQL to preserve that behavior.

Current PostgreSQL/Prisma queries remain sequential awaited operations within
the transaction. No event/order write runs outside that transaction.

Move/move/start/finish/park/restore/close serialize through the same session lock.
One matching version succeeds; stale work conflicts before mutation. Neighbor ID
is an additional exact-intent guard, never a request to find a replacement.
A queued revocation is rechecked under the membership lock. Previous accepted
membership-lock semantics and historical attribution retention remain.

Start continues inserting a fresh numbered attempt for the shared nextTopicId.
Park/restore/finish do not update planning positions. Close retains its current-
discussion guard and captured revision; moving the future queue cannot bypass
closure, advance a timer or complete a topic.

## Snapshot and UI

Read order-change rows and discussionPosition alongside existing authorized
agenda/attempt/parking records in the same read-only RepeatableRead transaction.
Add required runtime-validated `agendaOrder` data:

- a future queue with topicId, saved discussionPosition, original vote position/
  count, parked status and exact earlier/later neighbor IDs/capabilities;
- ordered move history with version, moved topic/neighbor, direction, actor/time
  and validated beforeQueue/afterQueue ID vectors.

The existing final vote results stay original-rank order. Discussion progress/
parking controls stay stable original-topic order; only the separate read-only
Future discussion queue changes display order. Snapshot nextTopicId and move
capabilities use the same validated projection, not a separate sort algorithm.
All-parked is still distinct from all-Discussed.

Missing/malformed positions, arrays or agendaOrder fail the read and disable
writes. No silent fallback to original rank, dropped entries or empty history:
that would hide persisted manual intent. Existing private/no-store boundaries,
safe person projections and own-ballot-only visibility remain.

Add a small agenda-order component with stable original-topic-ID control rows.
Keep earlier/later buttons mounted at those stable locations, with clear disabled
boundaries and topic-specific accessible names. Use the actual neighbor IDs and
version from the snapshot the user reviewed. The reordered list is read-only;
it must not move the focused button or remount action/review/reason editors.

The approved reversible swap is immediate and has no modal confirmation. Reuse
pending-through-reconciliation feedback: disable new commands until a fresh
snapshot finishes, then show explicit success/conflict/error. Capture the old
revision/neighbor for each invocation, never silently adopt newer neighbors.
Lost responses reconcile without replay; protected drafts remain in component
memory and access loss clears them. Preserve hidden/offline/initial sync guards.

Announce a confirmed move or conflict once, not every poll. Show parked labels
and original vote rank/count separately from planned position. Current/Discussed
topics have no usable move controls; history remains visible after those states change.
Same-team nonjoined readers get read-only queue/history; closed sessions show
retained history with no usable mutations. Render all content as text.

The existing monotonic timer/attempt identity stays unchanged. No new clock
arithmetic, polling interval, request replay or network operation per display tick.

## Migration, recovery and release safety

Create a new migration after parking. Explicitly transact adding/backfilling/
requiring positions, checks, the deferrable unique constraint and empty history.
Do not rewrite old migrations. Test a pre-order schema containing full historical
business/auth data, multiple discussion attempts and parking events. Compare
every original row/column and confirm defaults are exact saved vote rank.

Independently verify positive/unique planning positions, scoped topic FKs and
history checks. Demonstrate deferral permits the real two-position swap without
sentinels. Force a deferred uniqueness failure at transaction end and verify
rollback, not a partially committed plan/history. Also inject failure after
actual swap/event persistence but before lifecycle update.

Extend actual archive/recovered-app restart proof with a manually reordered
queue, current/Discussed frozen slots, parked placeholders, restored eligibility
and retained reverse-move history. Compare all public tables exactly after
restore, then restart the recovered app and verify unchanged order/history/
clocks and the correct next eligible topic. Preserve all prior recovery flows.
Fixture cleanup deletes order-change history before agenda/users.

The required column changes voting finalization writes, so do not claim old
binary compatibility even before the first manual move. Rehearse all four
unpublished migrations from accepted production on an isolated production copy.
Require separately approved encrypted backup, write drain/maintenance, migration
and coordinated matching-binary cutover. No mixed old/new application versions.
Default to roll-forward; dropping positions/history would lose manual intent
and is not an acceptable ordinary rollback. No production operation is authorized
by this proposed design.

Keep the current pooled runtime/direct migration driver, private environment
files and Frankfurt placement. No new Neon project or infrastructure. Commit/
push, CI/scans, hosted OAuth/real two-user timing, source/deployment verification
and explicit human pilot acceptance remain separate permissions/evidence.

## Planned verification

This was the planned harness at Gate B. Actual implementation and executed
evidence are recorded separately in `tasks/manual-agenda-order.md`.

| Criteria | Planned proof |
|---|---|
| MO1 | Strict input/role/join/phase/team/removed/boundary matrix, unknown-field rejection and queued membership revocation. |
| MO2 | Exact default/permutation/adjacent swaps, including future neighbors separated by frozen physical slots; unchanged vote/current/Discussed fields. |
| MO3 | Parked placeholder moves, current parking reinsertion, restore during another discussion, fresh next attempt and default-order regression. |
| MO4 | Immutable before/after vectors, actor/time, repeated reverse moves and closed-history display. |
| MO5 | Real session-lock queue barriers for competing moves and every relevant start/finish/park/restore/close/revocation race; scoped post-write failure and deferred uniqueness rollback. |
| MO6 | Two distinct visible users measure queue/next/parking consequences below 5,000 ms; keyboard boundaries and stable action/review/reason drafts/focus. |
| MO7 | Same-user stale neighbor/version and ambiguous committed response with one POST/no double swap, offline/hidden/reconnect and protected-draft clearing. |
| MO8 | Every-original-column migration comparison, exact all-table archive restore and actual app restart with order changes, old clocks and parking attempts/history. |
| MO9 | Existing AC/TC/VP/TD/PL and active BugMagnet tests, full local aggregate/recovery; separate strict CI/scans and hosted acceptance. |

Planned files: `tests/unit/agenda-order.test.ts`,
`tests/unit/agenda-order-controls.test.tsx`, `tests/integration/agenda-order.test.ts`,
`tests/integration/agenda-order-migration.test.ts`, `tests/e2e/agenda-order.spec.ts`
and the extended existing recovery script. Use deterministic instants and real
lock barriers, not scheduling sleeps or relaxed thresholds.

## Gate B review

- Separate complete planning permutation from immutable vote rank; keep current/
  Discussed slots fixed and parked placeholders durable across restore/restart.
- Swap only adjacent future entries using a narrowly deferred unique constraint
  and one parameterized UPDATE; no sentinel positions or deletion.
- Reuse session/member locks, lifecycle revisions and exact neighbor checks;
  positions and attributed before/after history commit or roll back together.
- Share one projection for next-topic/move eligibility, keep controls/drafts
  stable and reorder only a read-only queue.
- Require data-preserving migration and actual archive/restart evidence, followed
  only by a separately authorized coordinated roll-forward cutover.

The owner selected "Approve Gate B" on 2026-10-28. This authorizes tasks and TDD,
not commit/push, production migration, maintenance, deployment or human acceptance.
Actual execution evidence belongs in `tasks/manual-agenda-order.md`.
