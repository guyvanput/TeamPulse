# Topic voting and automatic prioritization: technical design

Status: Gate B approved by the owner on 2026-10-28.
Date: 2026-10-28.
Prerequisite: Gate A approved in `spec/topic-voting-and-prioritization.md`.
Baseline: accepted source `d22256b`, ADR-0001, and
`design/facilitated-topic-collection.md`.

## Architecture and bounded change

Keep the existing Next.js/React/TypeScript application, Auth.js, Prisma and
PostgreSQL. Reuse server-only `src/lib/service.ts`, pure `src/lib/rules.ts`,
`sessionCommand`, the snapshot DTO/endpoint and `SessionWorkspace`.
No new dependency, service, broker, WebSocket transport or auth mechanism.

The implementation adds voting/agenda persistence and operation-specific guards,
not a general meeting workflow engine. Keep action-follow-up and legacy rendering
unchanged. Retain the single Frankfurt (`fra1`) Vercel function region alongside
the database, the two-second poll/timeout and the measured five-second target.
The hosted latency failure from the previous release is a regression risk,
not permission to relax that target.

## Additive schema

| Entity | Planned changes |
|---|---|
| TeamSession | `votingState` enum NOT_STARTED / OPEN / FINALIZED, default NOT_STARTED; nullable `votingStartedAt` and `votingFinalizedAt`. Reuse `lifecycleVersion` for both collection and voting controls. |
| SessionParticipant | Add nonnegative integer `ballotVersion` default 0. Add unique `(teamId, sessionId, userId)` for a scoped ballot FK; retain existing `(sessionId, userId)` primary key. |
| Topic | Add unique `(teamId, sessionId, id)` for scoped vote/agenda FKs; preserve existing identity, content and creation-order index. |
| TopicVote | `teamId`, `sessionId`, `userId`, `topicId`, `createdAt`; primary key `(sessionId, userId, topicId)`; scoped FKs to participant and topic; index `(teamId, sessionId, topicId)` for aggregate counts. |
| AgendaEntry | `teamId`, `sessionId`, `topicId`, integer `position`, integer `voteCount`; primary key `(sessionId, topicId)`, unique `(sessionId, position)` and scoped topic FK. |

Use restrictive deletes on historical votes/agenda, matching the existing session
history model. A vote refers to SessionParticipant, not Membership; current access
is rechecked at runtime, while membership revocation must not delete contributions.
Do not expose a Vote-to-User include tree through the snapshot.

Explicit migration check constraints:

- Legacy sessions always have NOT_STARTED and null voting timestamps.
- NOT_STARTED has null voting timestamps. OPEN has startedAt but no finalizedAt
  and collection must be PAUSED. FINALIZED has both timestamps and collection
  must be PAUSED or CLOSED. FinalizedAt must not precede startedAt.
- Ballot versions and agenda counts are nonnegative; positions are positive.
- Retain the accepted collection/facilitator/removal/version checks.

The three-vote budget, matching aggregate counts, contiguous complete agenda and
finalization's cross-table invariants are enforced in the serialized service
transaction and tested against PostgreSQL. Do not claim ordinary row CHECK
constraints enforce cross-row sums. Unique keys independently prevent duplicate
selections/ranks. All application writes go through the service; no public
generic vote/agenda write endpoint or browser database access.

Migration only adds fields, constraints and empty tables. Existing legacy and
facilitated sessions receive NOT_STARTED; participant ballotVersion starts at 0.
No topic, collection state, lifecycle version or existing historical value changes.

## Transaction and authorization boundary

Reuse `writableSession`: authorize team/session, lock TeamSession FOR UPDATE,
recheck/hold the actor's current Membership FOR SHARE, reread state and require
participation as appropriate. Maintain lock order:
session -> actor membership -> participant/ballot -> topic/action.

All commands for one session serialize on the same row. This is intentionally
coarse at small-team scale: it makes budget/finalization/lifecycle races explicit
without serializable retry loops or multi-row lock-order complexity. Do not
parallelize queries on the same transaction client; retain sequential awaited
queries. A different session does not contend on this session row.

Resolve the actor from Auth.js, not input. Validate inputs with Zod; strip
unrecognized role/author/team/count fields. Use the already-fixed expected-version
validation: numbers or nonblank numeric strings only; reject null, booleans,
arrays, fractions and negative values. Compare versions in memory before passing
untrusted numbers to integer filters. On integer version exhaustion reject with
an explicit conflict rather than overflowing or wrapping.

| Operation | Planned transaction behavior |
|---|---|
| Start voting | Joined facilitator, FACILITATED/PAUSED/NOT_STARTED, matching lifecycleVersion; require at least one active topic; set OPEN/startedAt and increment lifecycleVersion. |
| Set topic selection | Current joined member, FACILITATED/PAUSED/OPEN; validate active scoped topic and matching ballotVersion; apply the explicit desired selected boolean, cap the resulting ballot at three, increment ballotVersion only if changed. |
| Finalize voting | Joined facilitator, PAUSED/OPEN, matching lifecycleVersion; rank every active topic from stored votes; create all AgendaEntry rows; set FINALIZED/finalizedAt and increment lifecycleVersion in the same transaction. |
| Resume collection | Existing permission/version guard plus votingState NOT_STARTED. |
| Close session | Reject OPEN with finish-voting-first conflict; otherwise preserve existing close behavior and retain finalized agenda. |
| Create/edit/remove topic | Existing permission/version guard plus votingState NOT_STARTED. |
| Join | Existing idempotent roster insertion in any nonclosed state; retain an existing ballotVersion and selections. |
| Capture/review actions | Existing nonclosed/joined constraints unchanged, including Open/Finalized sessions. |

Start and topic mutations share the session lock. A queued write reads committed
state after start and cannot exploit old Collecting controls. Votes and finalize
share the same lock: votes that commit first are included; subsequent votes see
FINALIZED and reject. Finalization failures roll back every agenda entry and state
change; no partial agenda is observable. No silent automatic operation retry.

Membership deletion that commits before the membership lock denies the write;
an existing authorized write holding that shared lock finishes before deletion.
Counts include persisted votes regardless of the voter's current Membership.
Reprovisioning a user reuses their original roster/ballot, not a new identity.
Existing restrictive action-owner/reviewer membership FKs remain unchanged.

## Ballot command protocol and retry semantics

Extend typed `sessionCommand` with start-voting, vote and finalize-voting.
Vote input is `{sessionId, topicId, selected, version}`:

- `selected` is a strict boolean, not coerced text or a toggle instruction.
- `version` is the viewer's session-wide ballotVersion from the last confirmed
  snapshot, not topic.version or a session lifecycleVersion.
- Compare ballotVersion before any write, even if the requested selection
  currently looks like a no-op. A mismatch returns an explicit conflict.
- With matching version, an already-matching selection is a successful no-op:
  no duplicate row, spent vote or version increment.
- A changed selection inserts/deletes exactly one scoped vote, enforces the
  three-vote maximum, and increments the participant's ballotVersion.
- Retrying a committed change with its previous version produces a conflict,
  not another change. Refresh and reconcile; do not silently replay a toggle.
- Concurrent choices at a last free slot cannot both consume it. Exactly one
  version-matched mutation commits; the other conflicts. Different voters have
  independent ballot versions but still serialize aggregate/finalization writes.

This deliberately favors explicit conflicts over "last tab wins". A successful
server response followed by a failed refresh leaves a visible stale state and
disabled writes until reconciliation; never reset local ballotVersion by guess.
Retain busy state until the post-command authorized snapshot finishes. Release
the mutating guard before that refresh so it is not blocked by its own guard.
Subsequent controls use confirmed data, not a captured pre-command revision.

The protocol requires no durable request-ID ledger because absolute selection
plus ballotVersion prevents duplicate spend or stale undo. New HTTP routes or
client-side identity state are unnecessary.

## Counts, deterministic ordering and finalization

Add a small pure ranking helper, preferably `src/lib/voting.ts`, shared by
provisional snapshot projection and finalization. Inputs are topic ID, original
createdAt and integer aggregate count. Sort:

1. Count descending.
2. Creation instant ascending.
3. Canonical topic ID ascending by explicit ordinal string comparison, not
   localeCompare or database-locale-dependent ordering.

Use one grouped count query scoped to team/session, not one query per topic.
Join counts onto the complete active-topic set with zero for topics with no
stored votes. Missing count for a known topic means zero, not a hidden missing
topic. Do not filter by roster attendance, current Membership or author.

Finalization persists one-based contiguous ranks and final counts as AgendaEntry.
Read FINALIZED agenda from those entries; do not recompute its historical ranks
on each request. Preserve full topic identity/content through restrictive FKs
and the permanent topic freeze; a duplicated title is still a separate entry.
Validate entry completeness, unique positions and count totals in tests.
There is no "currently discussing" or manual agenda manipulation in this design.

## Snapshot extension and privacy

Extend `src/lib/session-snapshot.ts` with a required `voting` DTO:

- state, startedAt/finalizedAt, fixed budget=3;
- viewer ballotVersion (null before joining), selectedTopicIds and remaining
  budget (null before joining);
- per-topic aggregate totals and ordered agenda entries with topicId,
  one-based position and count, labeled provisional or final by voting state;
- server-computed canStart/canVote/canFinalize/canResume/canClose capabilities.

Keep topic cards' base list in original creation order for stable draft/focus
identity. A separate agenda list consumes the voting ordering.
NOT_STARTED has no agenda and no selections; eligible topics can display count 0.
Closed/NOT_STARTED remains a valid historical state with no fabricated agenda.

Use the existing read-only RepeatableRead transaction so collection/voting state,
own ballot, counts and final entries represent one coherent database snapshot.
Fetch only the viewer's vote rows plus aggregate counts. Never include full voter
rows, named ballots, Account or auth Session data in returned payloads.
Schema-validate the DTO at runtime; no catch-and-default for missing voting data.

Keep the authenticated endpoint JSON 401 on expiry, generic 404 on absent/foreign
team, safe logged 500 on unexpected failures, dynamic/private/no-store and no
CORS exposure. Counts are team-sensitive; do not add shared HTTP caching.

## UI, confirmations and focus

Keep the existing SessionWorkspace polling/cancellation/generation model.
Add voting state, remaining budget and explicit selected/unselected controls to
stable topic cards. Use `aria-pressed` with topic-specific accessible button
names. A selected topic can still be unselected at zero remaining budget.
Disable only additional selections at the limit, with explanatory text.

Display a read-only ordered agenda separately, labeled provisional while OPEN
and final when FINALIZED. Because this live list has no focusable voting controls,
reordering it need not move the actively focused control or reparent TopicCard.
The original stable cards retain edit drafts; freeze them with explicit
"Draft retained; topics are locked for voting" guidance.

Facilitator controls show start/finalize confirmation panels. Hide/disable resume
after start and explain why closing during OPEN requires finalization first.
Server guards remain authoritative if stale controls are submitted directly.
Cancel preserves drafts and does not mutate the voting state.

Retain topic/action/review drafts during background state changes and agenda
movement. Do not key the workspace or topic cards by vote count, agenda position,
ballotVersion or lifecycleVersion. Do not store protected drafts in localStorage.
On access loss, unmount protected snapshots/drafts as before.

Use explicit pending/saved/conflict/uncertain messages. Announce budget/state/
failure changes, not repeated polling or every global vote. Offline/read failures
disable writes until a fresh authorized snapshot; never claim an unconfirmed
selection succeeded. Add tests for two tabs of one user and two different users.

## Migration, deployment and recovery

- Add a new Prisma migration; never rewrite either accepted migration.
- Compare every original column/row across all existing tables, including Topic,
  SessionParticipant and auth tables, against pre-migration projections.
  New columns use defaults; voting/agenda tables start empty.
- Extend fixture cleanup in FK order: AgendaEntry/TopicVote before Topic and
  SessionParticipant. No test fixture or auth bypass against production.
- Extend the isolated archive/recovered-app harness with Open and Finalized
  sessions, distinct-user votes, final ranks, removed history and existing actions.
  Compare every public table exactly, restore into a generated isolated target,
  then continue Open voting and read an unchanged Finalized agenda in the app.
- Before production migration, take/verify the encrypted pilot backup, rehearse
  the migration on a disposable production-copy branch, and verify default/history
  preservation. Keep private branch data and archive contents out of logs/Git.
- Roll forward is the default remediation. The previous binary has no voting
  controls or operation-specific voting guards; database checks may reject its
  incompatible writes, but it cannot operate the new workflow reliably:
  **do not roll back to it once voting is in use**. Emergency rollback requires an explicitly approved
  maintenance/access plan; do not drop voting data or restore over production.
- An old open browser tab can lack new guards after deployment. Server rejects
  stale commands; instruct reload when DTO/server-action versions differ.
  Before any new voting has begun, the additive migration remains compatible
  with the old accepted binary; after first use the above restriction applies.
- Retain Frankfurt placement and confirm actual output region plus authenticated
  latency after deployment. Never accept CI as proof of the five-second hosted
  target. Use two real provisioned OAuth users for hosted verification.

## Planned verification and traceability

This table is the verification plan approved at Gate B, not execution evidence.
Actual results and remaining release checks are recorded in
`tasks/topic-voting-and-prioritization.md`.

| Criteria | Required design evidence |
|---|---|
| VP1, VP5 | Pure state/validation tests and real service cases for every lifecycle combination, permissions, zero eligible topics, confirmation/cancel and irreversible round. |
| VP2, VP3, VP7 | Service tests for 0/1/2/3 votes, fourth rejection, own-topic votes, unselect/refund, late joins, other-user forgery, wrong-session/removed topics, retained/revoked ballots and explicit version/string boundaries. |
| VP4 | PostgreSQL blocker/barrier tests: last-slot same voter; simultaneous different voters; start versus stale topic write; vote versus finalize; membership revocation versus write; stale pause/resume/close versus voting transitions. No scheduling sleeps. |
| VP6 | Pure ranking with equal totals/timestamps, distinct IDs/duplicate titles/all-zero results; stored final positions/counts/completeness; finalization rollback when agenda write fails. |
| VP7, VP9 | Exact DTO privacy assertions for each viewer; never return another voter's selected IDs/ballotVersion; denied access/expired auth; error propagation and valid save after rejected/failed request. |
| VP8, VP11 | Measured distinct-browser vote/count/state/final-agenda propagation under 5000 ms, keyboard budget controls, stable focus and topic/action/review drafts across read-only agenda reorder and voting freeze. |
| VP9 | Ambiguous POST failure, failed snapshot, offline/reconnect, stale same-user tab, unknown-outcome reconciliation without automatic replay. |
| VP10 | Original-projection migration comparison, actual app restart, every-table isolated archive restore and recovered-app continuation for Open/Finalized sessions. |
| VP12 | All existing AC/TC and BugMagnet tests, static checks/build, full browser suite, strict CI/scans and actual hosted history/follow-up/sign-out verification. |

Run the smallest focused checks while implementing; run the full merge/recovery
and release gates before claiming readiness. Record failures and their resolution.
Preserve all active BugMagnet regressions from the accepted service assessment.
The planned edge cases above are part of ordinary requirements-driven TDD, not a
new BugMagnet assessment with extra approval phases. Do not silently skip required
human pilot acceptance.

## Gate B review

Verify that these technical trade-offs are acceptable:

- Three-vote integrity uses one serialized session transaction plus per-voter
  optimistic revisions; duplicate/stale tabs conflict instead of overwriting.
- Final agenda is stored atomically with finalization; it is not reconstructed
  from changing membership or a later client-side sort.
- Protected snapshots reveal totals and the viewer's ballot only; no named
  ballot list or caching.
- Live ordered agenda is separate from stable interactive topic cards to retain
  focus/drafts without a new client-state framework.
- Migration is additive, tests include concurrency/recovery, and rollback to
  pre-voting code is unsafe after use.

The owner selected "Approve Gate B" on 2026-10-28 after reviewing the design and
its focused technical checklist. This authorizes tasks/TDD within the approved
requirements/design.
Required release acceptance and genuine authorization/credential blockers remain
separate; no technical approval can turn unexecuted evidence into a pass.
