# Facilitated sessions and topic collection: technical design

Status: approved. Gate B approved by Guy Van Put on 2026-10-27 at 10:37 +01:00.
Date: 2026-10-27.
Prerequisite: Gate A approved in `spec/facilitated-topic-collection.md`.
Baseline: `design/action-follow-up.md` and ADR-0001.

## Architecture and scope

Keep the existing Next.js/React/TypeScript application, Auth.js database sessions,
Prisma and PostgreSQL. No new hosted service, broker, WebSocket server, AI
provider or client-state library is required.

Reuse `src/lib/service.ts` as the server-only application-service boundary,
`src/lib/rules.ts` for pure Zod validation/state rules, and server actions for
mutations. Add a client session workspace for shared updates and draft state.
The existing action-follow-up session page remains a separate rendering path.
Do not refactor unrelated auth or deployment code.

The five-second requirement is an observed small-team acceptance target under
normal connectivity, not a guarantee under database/network outage. The browser
must visibly identify failed/stale updates rather than pretending it is current.

## Additive data model

| Entity | Changes and constraints |
|---|---|
| TeamSession | Add `kind` (`ACTION_FOLLOW_UP`, `FACILITATED`), nullable `facilitatorId`, nullable `collectionState` (`COLLECTING`, `PAUSED`, `CLOSED`), integer `lifecycleVersion` default 0, nullable `closedAt` |
| SessionParticipant | `teamId`, `sessionId`, `userId`, `joinedAt`; primary key `(sessionId, userId)`; composite session FK `(teamId, sessionId)` |
| Topic | UUID `id`, `teamId`, `sessionId`, `authorId`, `title`, `description` default empty, `createdAt`, `updatedAt`, integer `version` default 0, nullable `removedAt` and `removedById`; composite session FK `(teamId, sessionId)` |

Use User references for facilitator, participant, author and removal actor, with
restrictive deletion, rather than making historical records depend on retaining
a current Membership row. Current membership is an authorization requirement on
every request, not something a historical FK can establish. Existing Action and
ActionReview membership constraints stay unchanged.

Use explicit PostgreSQL check constraints in the Prisma migration:

- ACTION_FOLLOW_UP has no facilitator, collection state or closed timestamp.
- FACILITATED has facilitator and collection state; `closedAt` is set exactly
  when CLOSED.
- Topic removal timestamp/actor are both null or both present; versions are
  nonnegative. Enforce trimmed nonblank title and title/description bounds using
  application validation, consistent with the accepted first slice.

Index Topic by `(teamId, sessionId, createdAt, id)` and the participant roster
by session. Order topics by creation time then id. Filter active topics by
`removedAt IS NULL`; expose removed rows only in the read-only history section.
Do not retain a full edit log or introduce hard deletion.

Create a facilitated session and its creator's roster entry atomically.
The facilitator role derives from `TeamSession.facilitatorId`; do not store
another independently editable role on the participant record. Joining cannot
grant facilitator permission.

## Migration and compatibility

The migration adds fields/tables and defaults all existing sessions to
ACTION_FOLLOW_UP, with null facilitator/state. It does not update existing ids,
timestamps, action statuses, ownership, reviews or content. Do not infer creators.
Keep existing `createSession` behavior; expose a separate facilitated-creation
operation and explicit UI choice.

The legacy page is visibly labeled "Action follow-up session"; the new page is
labeled "Facilitated session". Existing routes and action-history links remain.
Earlier-session selection continues using `(createdAt, id)` across both kinds.
Closing a facilitated source never excludes its unresolved actions from later
follow-up.

Apply migrations only after an operator backup, migration-fixture comparison,
and isolated validation. The previous application can ignore additive fields
but does not enforce facilitated-session closure: therefore do not roll back
to the old binary while new sessions are writable. Prefer a forward fix; an
emergency rollback requires an explicitly approved access/maintenance plan.
Do not drop new tables/columns or restore production during routine deployment.

## Authorization and transactional mutation rules

Resolve the actor exclusively from Auth.js. Validate all identifiers/content
on the server. Never trust submitted author, facilitator, team or permission
flags. Foreign-team resources produce the existing generic denied/not-found
behavior, not a response identifying their owner or state.

For session-scoped mutations, centralize a transaction-aware session guard:

1. Find the session through current same-team membership.
2. Lock that session row `FOR UPDATE`, scoped by its authorized team/id.
3. Recheck current actor membership inside the transaction, holding a shared
   lock on that Membership row until commit so revocation serializes with it.
4. Read the locked session's current kind/state and participant entry.
5. Apply the operation-specific permissions and execute the write atomically.

For creation, similarly verify/lock the creator's current membership in the
creation transaction. No mutation may authorize solely before the transaction.
Membership deletion that commits first denies the operation; an already
authorized operation holding the shared lock completes before deletion.

| Operation | Transaction behavior |
|---|---|
| Join | Reject CLOSED; insert participant if absent. Concurrent/repeated joins return the existing entry, with no role changes |
| Create topic | Require joined and COLLECTING; persist authenticated author |
| Edit/remove topic | Require COLLECTING, active same-session topic, author or facilitator, and submitted expected topic version |
| Pause/resume/close | Require facilitator, matching expected lifecycle version and valid transition; increment lifecycle version; set `closedAt` on close |
| Create action | For FACILITATED require joined/non-CLOSED inside the same transaction as action creation; retain same-team owner validation |
| Review action | For FACILITATED require joined/non-CLOSED, then retain existing action row lock, earlier-session rule, unique review and atomic status update |

All paths use lock order session -> actor membership -> action/topic. Legacy
action operations also use the shared guard while preserving their permissions
and first-slice outcomes. A review in a later session locks its review session,
not the source session: closure freezes writes through the closed session, not
the future lifecycle of its originating actions.

Session serialization ensures a queued topic write/join/review rechecks state
after a competing pause/close. Session state commands carry only the lifecycle
version, so an unrelated topic edit does not cause a false state conflict.
Topic edits/removals use `WHERE id/version/removedAt` conditions and increment
version; a zero-row match is a visible stale conflict, not silent success.
Do not silently retry non-idempotent content writes after an unknown network
outcome. Refresh and explain uncertainty; only joining is explicitly idempotent.

Database state/authorization checks remain authoritative even when stale browser
controls are visible. Translate expected conflicts into `UserError`; unexpected
errors follow existing safe server logging and user-visible retry behavior.

## Read API and shared updates

Add a read-only authenticated endpoint
`GET /api/sessions/[id]/snapshot` for facilitated sessions:

- Call `auth()` directly; return JSON 401 on expiry, not a redirected sign-in
  HTML response. Return generic 404 on absent/foreign-team resource.
- Use a read-only Repeatable Read transaction for a coherent snapshot and
  membership authorization. Return only explicitly selected public fields:
  session state/version, viewer capabilities, roster display identities,
  active/removed topic display fields/versions, and the existing action/review
  display data. Never serialize complete User, Account or auth Session rows.
- Serialize instants as ISO strings and due dates as calendar dates. Define
  one typed DTO shared by initial render and endpoint; validate fetched JSON
  at runtime, rejecting invalid payloads rather than guessing defaults.
- Disable caching: dynamic route and `Cache-Control: private, no-store`;
  browser fetch uses `cache: "no-store"`. No CORS access is enabled.
- Fail explicitly with a safe 500 response/log for unexpected errors.

The server-rendered page supplies an initial authorized snapshot. Poll on a
two-second cadence while the document is visible/online, without overlapping
requests; use a two-second request timeout. Refresh immediately on focus,
visibility return, reconnect, successful local mutation or explicit retry.
Stop timers and abort requests on unmount; pause background/offline polling.
Do not add an extra two-second wait after a successful response.

Use request sequence numbers to discard responses superseded by a local
mutation or a newer refresh. After mutation confirmation, invalidate/abort
older reads before refreshing. Measure the actual end-to-end five-second
requirement in two-browser tests; polling intervals alone are not proof.
Normal-connectivity test assumptions include individual requests completing
within the timeout; failures explicitly indicate stale state and offer retry.

Keep this stateless per HTTP request for Vercel/standalone compatibility. No
process-memory subscription registry or long-lived database connection per user.
Two-second polling trades database requests for simplicity at pilot scale;
measure it before expanding team size. An event-driven transport needs a later
design decision if observed load makes polling unsuitable.

## UI and drafts

Add facilitated-session creation alongside the existing legacy creation form.
Show session state, facilitator, roster and Join; render mutation controls from
server-computed capabilities. Include explicit confirmation for remove and close.
Provide separate active topics and removed-topic history sections.

Keep form drafts in client component state keyed by stable session/topic/action
identity, separate from snapshots. Background updates must not reset inputs,
change captured expected edit versions or steal focus. Editing captures its
base topic version; a newer snapshot marks the draft stale without replacing it.
Do not use page-wide `router.refresh()` polling or snapshot-version React keys.

The facilitated workspace must retain action/review drafts even if a background
update removes a card from the unresolved list or closes the session. Preserve
such drafts in a visible blocked/conflict panel rather than unmounting and
discarding them. Do not persist drafts containing team data in localStorage.

On timeout/offline/read failure, show an accessible "updates unavailable /
displaying last confirmed state" status with last-success time and Retry; disable
writes until a fresh authorization snapshot succeeds. On 401 or membership loss,
clear protected snapshots and drafts from the rendered workspace, stop polling,
and show sign-in/access-denied guidance. Access revocation takes priority over
draft preservation. Never leave revoked team content visible under a login error.

Use labeled controls, keyboard confirmation/cancel flows, inline validation
and conflict errors, and a restrained live region. Announce meaningful state
or connectivity changes, not every successful poll.

## Planned verification and traceability

The table below defines the verification plan. Local implementation/results
are recorded in `tasks/facilitated-topic-collection.md`; this does not establish
new hosted acceptance or publication.

| Criteria | Planned tests/evidence |
|---|---|
| TC1, TC4, TC6 | Unit tests for creation/topic boundaries, UTF-16 string-length parity with existing Zod/HTML limits, transitions and permissions |
| TC1-TC7, TC10 | PostgreSQL integration tests for server services, roster uniqueness, exact topic versions, closure, same-team guards and cross-kind follow-up |
| TC3, TC7 | Coordinated concurrent transactions with barriers/locks, not scheduling sleeps: edit/edit, edit/remove, write/pause, join/close, review/close and membership revocation |
| TC8-TC9 | Independent authenticated browser contexts; measure confirmed save to other page's DOM within 5 seconds; visibility/reconnect, delayed/stale responses, failed fetch/save, draft retention and expiry/access loss |
| TC5-TC6, TC12 | Keyboard flows for join/edit/remove/pause/resume/close, accessible feedback, removed history and no focus theft |
| TC11 | Migrate a pre-change synthetic fixture and compare every original row; reload/restart new session state/roster/topics/removal metadata |
| TC10-TC11 | Extend isolated archive recovery to include facilitated and legacy sessions, participants and removed topics; compare all public tables and continue through the recovered app |

Retain all first-slice AC1-AC10 checks, BugMagnet auth tests, strict scans,
production build, and the release/hosted evidence workflow. Update fixture
cleanup in FK-safe order. Tests continue using guarded isolated `_test`
databases and test-only database sessions, never production fixtures.

After implementation, use BugMagnet's approval-gated tests-only workflow on the
new session mutation boundary. Do not claim test coverage percentages without
instrumentation. Hosted multi-user verification and human candidate acceptance
remain separate from automated fixture evidence.

## Delivery order and Gate B decision

After Gate B: migration/compatibility tests -> pure validation/permission tests
-> transactional services/concurrency -> authenticated snapshot endpoint ->
draft-preserving UI/shared updates -> browser/recovery evidence -> hosted
verification. Prepare execution tasks with explicit test mapping before code.

The owner approved Gate B on 2026-10-27 at 10:37 +01:00, stating
"Gate B approved". Approval covers additive session kinds, historical identity
references, session-serialized writes with optimistic topic/lifecycle versions,
two-second authenticated polling with measured five-second behavior, and the
legacy/rollback constraints. Implementation may proceed within the approved
specification and design, beginning with execution tasks and tests. Production
migration, commit and push remain separate operator-authorized actions.
