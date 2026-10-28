# TeamPulse architecture and test rules

Status: first-slice rules, aligned with the approved design. Type checks, lint,
and behavior tests provide evidence, but are not a complete automated architecture
audit. See `design/action-follow-up.md`.

The approved second-slice design is in
`design/facilitated-topic-collection.md`. Facilitated session mutations lock the
session and recheck current membership/participation/state inside the write
transaction. Topic/lifecycle versions detect stale commands. Accept only numbers
or nonblank numeric strings as expected versions, not coerced nulls, booleans or
arrays. Compare loaded topic versions before building database integer filters;
oversized stale versions must return a conflict rather than a database error.
Keep the conditional write-version guard. Shared snapshots
are authenticated, uncached, validated DTOs; polling must not reset drafts or
preserve protected content after access loss. Legacy session behavior remains.

The third-slice voting design is approved in
`design/topic-voting-and-prioritization.md`. Voting writes use the same session
lock, explicit desired selections and per-participant ballot versions; start/
finalize share the lifecycle version with collection controls. Enforce the
three-vote cap and immutable topic set on the server. Persist the complete agenda
atomically with Finalized state, ordered by votes, original time and ordinal ID.
Retain historical vote identity independently of current Membership; return only
aggregate totals and the viewer's own ballot in uncached snapshots. After saves,
reconcile the current snapshot before enabling another ballot write.

The fourth-slice design is approved in `design/timed-topic-discussion.md`.
Discussion transitions reuse the session lock, membership guard and lifecycle
revision. A partial unique index independently limits current discussion to one
topic. Preserve immutable votes/ranks separately from discussion progress. Sample
PostgreSQL clock_timestamp as absolute integer epoch milliseconds after locks;
never trust browser wall time or transaction-start time for queued deadlines.
Paused durations retain exact milliseconds; expiry is derived without writes.
Pair fresh snapshots with monotonic client timing anchors, synchronize before
timer writes and keep local ticks out of database/network traffic. A current
discussion blocks closure, even after expiry; finish and close are separate.

The fifth-slice design is approved in `design/parking-lot.md`. Discussion rows
are numbered attempts; FINISHED ends a timebox, while DISCUSSED versus DEFERRED
outcome determines permanent topic completion. Never infer completion from
FINISHED alone or overwrite a terminal attempt on restore. Retain revision-ordered
park/restore events, including waiting topics with no fictional clock. Use the
shared progress projection for service/snapshot eligibility, and the same session/
membership locks and lifecycle revision for atomic event/clock changes. Parking
is an explicit alternative to finishing before close; restore never starts or
interrupts a timer. Preserve original vote ranks/counts, private attempt/history
DTOs and stable reason drafts/confirmations. Migration key evolution requires
preservation/recovery proof and a separately authorized coordinated roll-forward
cutover, not mixed old/new application versions.

The sixth-slice design is approved in `design/manual-agenda-order.md`. Keep
immutable vote ranks separate from a complete positive `discussionPosition`
permutation. Current/Discussed physical slots stay fixed; swap only exact adjacent
future entries, including parked placeholders. The named planning-position
unique constraint is DEFERRABLE INITIALLY IMMEDIATE; preserve that property in
future migration SQL and its PostgreSQL catalog regression. Only this constraint
is deferred for a parameterized, scoped two-row swap. Persist attributed
before/after queue vectors and the lifecycle revision in the same locked
transaction. Never use sentinel positions or silently adopt a different neighbor.
Shared progress determines future/next eligibility; restoration retains saved
manual planning positions, while no-move sessions behave as before. Read-only
queue changes must not reorder interactive controls or discard drafts. Move
buttons use guarded `aria-disabled` semantics to retain keyboard focus through
pending synchronization and unavailable boundaries. Required positions/history
must fail explicitly if malformed, not fall back to original rank. The required
column also changes voting finalization; older binaries are not compatible.

The seventh-slice design is approved in `design/meeting-summary.md`. A Closed
session remains read-only except for narrowly authorized creation of its single
immutable summary. Do not weaken existing write guards. Generation samples the
numeric database clock as the first snapshot statement in a RepeatableRead
transaction, then follows session/member locks and joined-facilitator/version
checks. Capture created-here or reviewed-here actions, including Done actions;
the live unresolved-work projection is not the report source. Persist safe names,
versioned validated JSON and attribution together, never recompute them on read.
Actual Prisma raw-query serialization conflicts use P2010 with
`driverAdapterError.cause.kind=TransactionWriteConflict` and `originalCode=40001`;
only tested conflict signatures and the report-only insert's uniqueness conflict
are classified as reconciliation conflicts. Other failures remain explicit.
No automatic request/transaction replay. The required private snapshot validates
saved format/content rather than returning null on malformed data. Closed-state
summary capability is separate from ordinary write capability. Stable note/
confirmation state survives updates and remote winners, with unused notes
explicitly distinguished from saved text. Later action progress, restore and
actual app restart must leave every report field unchanged.

- Keep business validation and action transition rules independent of React,
  Next.js, Prisma, and authentication providers.
- Keep database access and authentication integration in server-only modules.
- Validate untrusted input on the server; browser validation is supplementary.
- Resolve the actor from a verified session, never from a submitted user id.
- Check team membership for every session, action, and review read or mutation.
- Validate action owners against membership in the action's team.
- Persist review outcomes and action status changes in one database transaction.
- Keep originating sessions and review history when actions are followed up.
- Render user content as text, not raw HTML.
- Test business rules with Vitest, database behavior against PostgreSQL, and
  complete journeys with Playwright.
- Use accessible names and roles for browser locators. Avoid arbitrary sleeps.
- Isolate test data and never target a customer or production database in tests.
- Keep authentication fixtures confined to a separate test environment; never
  add a production authentication bypass for demonstrations.
- Keep secrets, customer content, and raw OAuth/session tokens out of logs,
  screenshots, prompts, and committed fixtures.

Do not introduce microservices, brokers, vector databases, or Kubernetes for the
first slice. Revisit architecture only when a demonstrated requirement needs it.

## Session administration boundary

The eighth-slice Gates A/B are approved in
`design/session-participant-and-role-management.md`. Retain participant records
and ballots; require active participation on all facilitated writes, never
historical row presence alone. The sole current facilitator administers through
the session-first/member-locked transaction; exact revision, current target
membership/state, change and attributed event commit together. Self-join cannot
clear removal. Reads remain team-membership-based. Current versus historical
rosters and saved report content are distinct.

Retain presentation/drafts after role loss, not authority. Every retained
handler checks current capabilities; named confirmations keep their captured
target/revision. Exact 19-table archive/restarted-app proof joins preserving
migration and real lock-barrier checks. Pre-administration binaries are unsafe
after removal; production cutover remains separately approved.
