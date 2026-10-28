# Meeting summary: technical design

Status: Gate B approved by the owner on 2026-10-28.
Date: 2026-10-28.
Prerequisite: owner-approved Gate A in `spec/meeting-summary.md`.
Baseline: accepted production `d22256b` plus unpublished voting, discussion,
parking and manual-order implementation. The last local aggregate passed 346
tests and exact 17-table archive/restarted-app verification, recorded in
`tasks/manual-agenda-order.md`. That is not evidence for this proposed slice.

## Architecture and alternatives

Keep the single Next.js/React application, Auth.js, Prisma/PostgreSQL and the
private validated snapshot. No new dependency, AI provider, storage bucket,
worker, cache, external endpoint or export format.

Store one versioned report document rather than recomputing a report on every
read. Live projections would silently rewrite captured action statuses and user
names. A normalized copy of every source table would add unnecessary identities
and joins for a single immutable report. A typed JSON document is sufficient:
validate on generation, storage reads and the public DTO boundary.

Keep existing close behavior and all closed-source guards. Generation is a
separate narrowly authorized operation that adds an artifact, not permission
to edit closed topics, votes, order, timers, parking, participation or actions.

## Persistence

Add `SessionSummary`:

| Field | Proposed meaning |
|---|---|
| sessionId | Primary key: one report per session, including competing tabs/retries. |
| teamId | Scoped restrictive FK with sessionId to TeamSession(teamId, id). Declare the composite uniqueness required for the Prisma one-to-one relation. |
| generatedById | Restrictive User FK, not current Membership; removing membership must not erase report attribution. |
| generatedByName | Captured safe display name from the same source snapshot; do not resolve it live on later reads. |
| generatedAt | Absolute database time at generation's source-snapshot capture, not a fictional meeting end or transaction commit time. |
| formatVersion | Positive integer, generated as 1; runtime parser explicitly supports version 1. Unknown formats fail rather than being reinterpreted. |
| note | Trimmed plain text, at most 4,000 characters; empty string means no facilitator wrap-up. |
| content | JSONB object containing the validated source snapshot described below. No auth records or secrets. |

Add inverse optional TeamSession and User relations. A new transactional
migration creates the empty table, scoped/user FKs, format/note/object checks
and uniqueness; it does not change old columns or fabricate reports.
Every-original-column/row comparison must cover the existing manual-order,
parking, discussion, voting, action and auth data.

No update/delete/report-regeneration API. Immutability is an application
guarantee, not a claim that privileged SQL cannot alter a row. Do not add a
trigger that blocks legitimate isolated fixture cleanup/recovery or pretend
ordinary JSON checks enforce all document semantics.

## Versioned content and rendering

Put pure content building/validation in `src/lib/meeting-summary.ts`, independent
of React, Prisma and authentication. Use precise typed inputs and a strict Zod
schema; JSON values contain only strings, finite integers, booleans, arrays,
objects and explicit nulls. Assign valid JSON types without `any` or unchecked
JSON-to-domain casts.

Capture only:

- Session ID/title and facilitator's safe ID/display-name projection.
- Joined roster with safe IDs/names and recorded join times, in stable order.
- Active topics with ID/title/submitted description; stable original topic order.
- Voting state and, only when Finalized, saved original rank/count and saved
  discussion position for every final agenda topic.
- Final topic outcome: Discussed; currently parked Deferred with its latest
  recorded reason; otherwise Not discussed. Prior Deferred attempts remain in
  source history and do not mislabel a restored waiting topic as still parked.
- Actions created in this session and earlier actions with a review recorded
  here, deduplicated by ID. Include title/context, safe owner, due date,
  current status at generation and source-session ID/title.
- Reviews recorded in this session: action ID, retained note/resulting status,
  recorded actor and time. Include Done actions reviewed here even if they no
  longer appear in today's unresolved-prior-actions panel.

Keep a clear distinction between an action's status at generation and the
historical resulting status of the review recorded here. Do not copy all
unresolved actions from other meetings merely because they currently appear in
the workspace. Do not copy other users' individual ballots, auth data, email,
provider records or unrelated reviews.

Use the existing shared `parkingProgress` projection for final topics; validate
the saved planning permutation and original vote ranks, preserving all prior
invariant/error behavior. A Closed source cannot have a current discussion or
Open voting. Such inconsistent source data fails generation explicitly.
For Closed-before-voting sessions, use active topics with Not discussed outcome;
vote rank/count/planning position are null and labelled Not held, not fabricated
zeros or ranks. Removed topics stay in the linked protected session history.

Generation stores names/content as observed; later profile or action changes
must not rewrite the report. Protected action links deliberately lead to current
action details and are labelled accordingly. Source IDs inside JSON are checked
against the authorized source query, not accepted from the browser. Restrictive
source-session FK preserves the report's parent; existing application workflows
do not delete source topics/actions. Arbitrary privileged SQL is outside that
application-immutability guarantee.

Render report content as text in `src/components/meeting-summary.tsx`; share the
versioned schema with the server and client. No HTML/Markdown interpretation of
wrap-up or submitted context. Show generator/time, "Action details at summary
generation", and a separate "Facilitator-written wrap-up". Do not infer a
transcript, meeting decision, sentiment, end time or total meeting duration.

## Generation transaction and coherent source boundary

Add strict input:
`{ sessionId, version, note }`.
Reuse existing ID/expected-version validation; note defaults explicitly to empty
when omitted, then trims and enforces 4,000 characters. Reject submitted actor,
time, report JSON, content, format, role, positions or capabilities.
Add `generate-summary` to the authenticated sessionCommand.

Do not weaken `writableSession`: it correctly rejects all existing writes after
closure. The new operation uses a small dedicated closed-session guard, reusing
`authorizedSession`, membership locking and existing error conventions:

1. Start a RepeatableRead read/write transaction. Sample the existing numeric
   database-epoch helper as its first snapshot-establishing statement; this
   timestamp identifies generation/source capture, not commit or meeting end.
2. Resolve the authorized scoped session; lock its row FOR UPDATE, then lock/
   recheck current Membership FOR SHARE in the existing order.
3. Require FACILITATED, Closed, current facilitator, existing participation and
   the exact captured lifecycleVersion. Do not increment that revision or alter
   the closed source session.
4. If a summary already exists in this snapshot, return an explicit existing-
   summary conflict; the client refreshes and displays it. Never overwrite or
   treat a different submitted note as a successful replacement.
5. Load safe scoped source rows, build and validate the content document, and
   insert the single report with actor, timestamp, format and note.
6. Commit everything together; any failure leaves no artifact or source writes.

**Why RepeatableRead:** `reviewAction` locks its nonclosed review session and
the action, then records the review and status in one transaction. Reading report
sources in one MVCC snapshot therefore captures the complete before or after
state of such a review, even if it commits between individual report queries.
It cannot mix the newly committed status with an inconsistent source version.
No new action locks, cross-session locks or lock-order reversal is required.
Do not reuse `sessionDetails.priorActions` as the report source: that query
intentionally excludes Done actions and is a live unresolved-work panel.

The source capture clock is intentionally sampled at the beginning of this
snapshot, unlike post-lock timer-transition clocks. It labels the data version
being captured, not a queued deadline. Existing timer arithmetic, post-lock
time sampling and monotonic display anchors remain unchanged.

The same session lock serializes generation with any authorized session-level
operation. Current membership is rechecked under its row lock; a membership
deleted/changed after the RepeatableRead snapshot must deny or abort, not allow
a stale membership-based write.

Two transactions may establish snapshots before either obtains the session lock.
The later snapshot can then fail serialization or encounter the report primary
key created by the winner. Handle only real, tested Prisma/PostgreSQL transaction
conflict signatures and this operation's report uniqueness conflict as explicit
conflict/reconcile results. Verify the adapter's actual serialization error
mapping with PostgreSQL tests; do not assume every raw-query failure means a
conflict or swallow an unrelated error. No automatic transaction or request
replay. Unexpected failures use the repository's explicit logged error boundary.

The primary key and read-only content API enforce at most one saved report.
A lost response is resolved by a new authorized read, not regeneration.
Generation-time action values are those at the source snapshot, which may
precede a concurrent later-session review; the report says this explicitly.
Previously closed sessions use current values at generation, not a retrospective
claim about action status at closure.

## Private snapshots and UI

Extend required SessionSnapshot with:

- `summary.report`: null when absent, otherwise validated format/note/content,
  generator's captured safe identity and generation/source-capture time;
- `summary.canGenerate`: current joined facilitator, Closed state and no report.

Build the generator DTO from stored generatedById/generatedByName, not a live
profile join when rendering history. The User FK still preserves actor identity.
Validate stored format/document completely. Missing/malformed summary DTOs fail
the snapshot and disable writes, not become null or a recomputed report.
Read in the existing authorized, read-only RepeatableRead snapshot; preserve
private/no-store boundaries and five-second shared visibility.

Add a summary region within the existing session workspace, reachable from
session history. Existing protected session links suffice to reach it; expose a
summary anchor/link for saved reports without adding a public route. If home
history shows report availability, load only its existence/identity there, not
the document. Legacy sessions have no summary controls or fabricated reports.

Existing `canWrite` must stay false for Closed sessions. The summary controls use
their own server capability plus available/not-pending/confirmed-anchor checks;
do not globally enable the existing action/topic/discussion/parking controls.
Reuse sessionCommand's pending-through-reconciliation/error/no-replay behavior.

Wrap-up text remains component memory under a stable summary region. Capture
note and lifecycle revision when opening confirmation; cancel retains the draft.
Confirm explains permanent creation and generation-time action capture.
On successful confirmed creation, show the persisted artifact; never show an
optimistic content snapshot as saved.

When another tab generates first, show that report without substituting the
local note. Retain any unused nonempty draft with an explicit "not included in
the saved report" explanation until the user dismisses it. Offline, hidden,
invalid reads, conflict and ambiguous saves must not silently erase that note.
Loss of access unmounts the protected workspace, report and drafts.
Keep existing action/review/reason drafts and focused controls stable.

## Migration, recovery and release safety

Create a new migration after manual order, not changes to old migration files.
Explicitly transact new table/check/FK creation and compare every old row/column.
Check empty old-session report state, strict note/object/format constraints,
same-team session FK and restrictive actor identity. Inject migration failure
to prove no partial schema/seeded report remains.

Extend exact archive comparison to the new table (18 public tables including
migration metadata). Seed a valid immutable report with wrap-up, all final topic
outcomes, unchanged original/manual order and captured action details. After
restore, continue live action follow-up and verify saved report fields/time/
attribution are unchanged. Restart the recovered app process and compare them
again. Retain all original voting/clock/parking/manual-order recovery fixtures.
Fixture cleanup deletes summaries before parent sessions/users.

No source-schema rewrite or historical backfill is required for this slice.
An older application could leave new reports invisible rather than erase them,
but that is not permission to roll back product behavior, run mixed client DTOs
or skip compatibility tests. Prior unpublished migrations already require
matching binaries. Rehearse all five unpublished migrations from accepted
production on an isolated copy; require separate encrypted backup, coordinated
write-drain/migration/matching-binary cutover and roll-forward recovery approval.
Do not drop reports or other histories as an ordinary rollback.

No production operation, commit/push or deployment is approved here. Strict
CI/scans, matching source/deployment, actual hosted OAuth/two-identity timing,
Frankfurt region verification and explicit human acceptance remain required.

## Planned verification

Nothing below is executed summary evidence.

| Criteria | Planned proof |
|---|---|
| MS1 | Input/role/team/join/phase/legacy/closed-version matrix, forged fields and real queued membership revocation; no source writes. |
| MS2 | Exact source-to-document output for original/manual order, Discussed/parked/restored/unstarted topics and Not held voting; malformed stored/source state fails. |
| MS3 | Optional/blank/trimmed/4,000/4,001-character notes, plain-text rendering, cancel/draft preservation and no overwrite. |
| MS4 | Include created and reviewed-here Done actions, exclude unrelated unresolved work, retain historical review results, and use real review/generation barriers to verify complete before/after snapshots. Later progress cannot rewrite reports. |
| MS5 | Real competing-generation/session-lock barriers; uniqueness and actual adapter serialization mapping; failure injected after content insert rolls back; one-POST lost-response and stale note retention. |
| MS6 | Two distinct visible users measure report availability/content below 5,000 ms; keyboard confirmation, stable other drafts/focus, hidden/offline/invalid reads/reconnect and access clearing. |
| MS7 | Every-old-column migration comparison and failure rollback; exact all-table archive restore, later live action continuation and actual recovered-app restart with unchanged report. |
| MS8 | Existing AC/TC/VP/TD/PL/MO and active BugMagnet tests, full unchanged aggregate/recovery; separate CI/scans and authorized hosted acceptance. |

Planned test files: `tests/unit/meeting-summary.test.ts`,
`tests/unit/meeting-summary-controls.test.tsx`,
`tests/integration/meeting-summary.test.ts`,
`tests/integration/meeting-summary-migration.test.ts`,
`tests/e2e/meeting-summary.spec.ts`, and extended recovery.
Use real barriers and deterministic fixtures, not scheduling sleeps, retries or
relaxed thresholds. Tasks and implementation follow only after Gate B approval.

## Gate B review

1. One immutable, versioned JSON report with strict validation and a unique
   session identity; safe captured names/content, not live regeneration.
2. Dedicated closed-session authorization without weakening any old write guard.
   RepeatableRead captures a coherent before/after action view; its first-statement
   source-capture time is distinct from timer-transition timing.
3. Exact session/member locks, real conflict classification, primary-key
   deduplication and no automatic replay or closed-source revision changes.
4. A protected report region with a separate Closed-state capability, permanent-
   creation confirmation and explicit retention of unused notes after a remote win.
5. Additive preserving migration, exact archive/actual restart proof and separate
   authorized coordinated release; no AI, storage or new service.

The owner selected "Approve Gate B" on 2026-10-28. This authorizes tasks and
implementation, not publication, production migration, deployment or human
acceptance. Actual execution is tracked in `tasks/meeting-summary.md`.
