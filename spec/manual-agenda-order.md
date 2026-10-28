# Manual agenda order: sixth delivery slice

Status: Gate A and Gate B approved by the owner on 2026-10-28.
Date: 2026-10-28.
Source: `docs/prd.md`, facilitator responsibility to reorder the agenda.
Dependencies: finalized voting, timed discussion and parking, implemented and
verified locally but not newly published or accepted.

## User outcome

The facilitator can deliberately change the order of future discussions without
rewriting vote results, interrupting a current timebox or losing deferred history.
The team can distinguish original vote priority from the facilitator's current
discussion plan and see who changed that plan.

The owner approved these requirements at Gate A and the design at Gate B before
implementation. Publishing the preceding slices and human pilot acceptance
remain separate permissions.

## Approved product decisions

| Decision | Approved rule |
|---|---|
| Availability | Facilitated, nonclosed session after voting is Finalized; only the current joined facilitator administers order. |
| Default | Without a manual move, discussion order stays original final vote rank, including parking/restoration's approved behavior. No fabricated manual change history for old sessions. |
| Separate meanings | Keep final vote ranks/counts/content immutable and visible as vote results. Show a separate Discussion queue in its current planned order. |
| Movable topics | Reorder future unfinished topics, including parked placeholders. The current topic and permanently Discussed topics are not reorderable. |
| Controls | Topic-specific, keyboard-operable Move earlier / Move later swaps adjacent future entries. No drag-only UI, bulk sorting, priority editing or reset command in this slice. |
| During discussion | Reordering the future queue is allowed while another topic is current, including paused/expired. Never change that topic's timing, outcome or need for explicit finish/parking. |
| Parking | A parked placeholder has a visible future position but stays ineligible to start. Parking/restoration do not themselves reorder the queue. |
| Restoration after manual moves | Return to the saved queue position, not necessarily original vote rank. Its next explicit start still gets a fresh five minutes with old attempts retained. |
| Next start | Choose the first eligible future topic in current discussion-queue order, skipping parked topics. Never start, finish, restore, extend or advance as a side effect of a move. |
| History | Retain actor/time and the before/after future order of each successful move. All current team readers can see it, including after closure. |
| Reversibility | The facilitator may move eligible future entries again before close; do not erase earlier move history. Boundary moves are unavailable, not recorded successful no-ops. |
| Explicit exclusions | Pre-finalized reordering, moving current/Discussed topics, vote/rank/count changes, participant administration, custom timeboxes, automatic carry-over, summaries, AI and imports/exports. |

**Approved intentional change:** parking currently restores eligibility
by original vote rank. Once the facilitator explicitly changes the future queue,
restoration instead respects that saved queue position. Original vote results
remain intact. Without manual moves, the existing behavior stays unchanged.

## Permissions, lifecycle and coherence

- Authenticate and check current team membership for every read/write. Recheck
  facilitator membership, joined status, phase and revision after queued locks.
  Joining cannot grant team membership; submitted actor/role/order cannot grant
  permission.
- Reject foreign/nonexistent/removed/non-agenda topic IDs, Legacy, Closed and
  pre-finalized session commands without changes. Participants cannot reorder
  even their own topics, and nonjoined readers have no controls.
- Every unfinished noncurrent topic occurs exactly once in the future queue;
  include parked placeholders clearly labelled Parked. Current and Discussed
  topics stay visible in progress/history but outside move controls.
- A swap changes only the two adjacent future positions. Reject a stale target,
  direction or adjacency rather than moving some newer neighbor.
- Starting a topic takes the first eligible item out of future eligibility;
  finishing it makes it permanently Discussed. Parking the current topic returns
  it to its saved planning position as an ineligible placeholder. No current
  discussion can be displaced by a move.
- Two-user updates must show one coherent queue, current timer, parked state and
  next-start eligibility. Never combine a new order with old capabilities.
- Keep all-parked distinct from all-Discussed. Close still requires finishing or
  explicitly parking a current topic; queue moves cannot bypass that guard.
- Existing actions/reviews, topic/ballot freezes, late joining, timer arithmetic,
  restored fresh timeboxes and protected history keep their approved behavior.

## Commands, conflicts and failures

- Each move is an explicit action; no additional confirmation is proposed for
  the reversible adjacent swap. Identify the topic and requested neighbor/order
  from the state the facilitator actually reviewed.
- Stale tabs and moves racing with start/finish/park/restore/close or another
  move must yield a single authorized result. An old move cannot silently adopt
  a different neighbor or alter a newer attempt/queue.
- Duplicate/retried/ambiguous commands must not swap twice or multiply history.
  Report explicit conflict/failure and reconcile; never automatically replay.
- The order and its attributed history commit together. Injected partial failure
  must leave both untouched, with all timer/parking/vote values unchanged.
- Disable mutations offline, hidden, stale or awaiting fresh synchronization.
  Preserve local action/review/reason drafts and focused controls across reads,
  failures and remote moves. Access loss clears protected content and drafts.
- Render titles/reasons/history as text. No customer data or credentials in logs
  or generated evidence.

## Shared experience and accessibility

- Two distinct visible online contexts observe confirmed order, next-topic and
  parking/restoration consequences within five seconds under normal connectivity,
  without manual refresh.
- Keep interactive controls at stable topic-ID locations; a reordered read-only
  queue must not remount editors, steal focus or move a focused control.
- Provide topic-specific keyboard names and unavailable boundary controls.
  Announce confirmed move/conflict once, not on every poll.
- Display original vote rank/count separately from current discussion position.
  Show parked placeholders and explain why they are skipped.
- Same-team nonjoined readers can read queue and history. Closed sessions retain
  order changes, final vote results and existing topic/discussion/parking outcomes
  without writable controls.

## Compatibility, verification and delivery

Gate B must define a durable complete order, current-topic reinsertion semantics,
atomic history/revisions, consistent eligibility projection, private snapshots,
safe migration and rollout. This specification does not prescribe tables,
transport, pointer updates, workers or infrastructure.

Preserve all old rows/columns, vote results and timed/parking history across
migration; derive default order from existing final ranks without invented moves.
Extend original-column comparison, real database races/rollback injection,
distinct-user browser failures and exact archive/recovered-app restart proof.
Keep existing AC/TC/VP/TD/PL and active BugMagnet regressions; explicitly test the
new manual-order restoration rule, not deletion of default-order assertions.

No commit/push, production migration, downtime, deployment or human acceptance is
authorized by preparing this proposal. Strict CI/scans, encrypted backup and
production-copy rehearsal, matching source/deployment, actual hosted OAuth/timing
and explicit pilot acceptance remain separate requirements.

## Acceptance criteria and planned harness

This table records the approved criteria and planned harness, not passing
evidence. Actual execution results are in `tasks/manual-agenda-order.md`.

| ID | Testable criterion | Planned evidence |
|---|---|---|
| MO1 | Only a current joined facilitator reorders future finalized/nonclosed topics; malformed/foreign/participant/legacy/phase commands change nothing. | Strict unit/integration authorization and browser denial. |
| MO2 | Default order matches original vote rank; moves change only future planning, keep every entry once and retain immutable ranks/counts/current/Discussed history. | Unit/integration/migration comparisons. |
| MO3 | Parked placeholders retain manual position; restore does not interrupt/start; next explicit start follows saved eligible order with a fresh timebox. No-manual-move behavior is unchanged. | Exact integration and browser journeys. |
| MO4 | Each move retains actor/time/before-after order; subsequent reverse moves and closure preserve all history. | Integration/closed-history assertions. |
| MO5 | Coordinated move/move/start/finish/park/restore/close and revocation races preserve one coherent authorized result; injected failure rolls back order/history together. | PostgreSQL queue barriers and transaction failure injection. |
| MO6 | Distinct visible contexts observe queue/next changes below 5,000 ms; keyboard controls, boundary behavior and stable focus/drafts work. | Measured browser journey and separate hosted evidence. |
| MO7 | Stale neighbor commands and lost committed responses never double-swap/replay; offline and access loss preserve then clear protected drafts correctly. | Browser failure injection and service conflicts. |
| MO8 | Every old column/row, default order, all historical outcomes and new move history survive migration, archive restore and actual app restart. | Migration comparison and extended recovery script. |
| MO9 | Existing regressions, strict checks/scans and separate authorized release/acceptance boundaries remain enforced. | Full local aggregate/recovery and separate release-readiness evidence. |

## Gate A review examples

- Original votes rank A, B, C. Move C earlier: vote results still read A, B, C;
  future discussion order becomes A, C, B. Each successful move is retained.
- A is current. Move waiting C before B: A's clock is unchanged; C becomes next,
  not current. A still requires a separate finish or parking operation.
- B is parked. Move its placeholder after C, then restore B: B returns at that
  saved planning position. It does not jump back ahead of C by original vote rank.
- Park a current topic: its Deferred timebox remains intact and its placeholder
  returns to its saved planning position, without automatic next start.
- An old tab attempts C-before-B after B started or another move changed that
  adjacency: conflict/reconcile, never a different automatic swap.

The owner selected "Approve Gate A" on 2026-10-28 after reviewing these rules and
the explicit manual-position restoration change. The proposed technical design
is in `design/manual-agenda-order.md`. The owner approved Gate B on the same
date. Execution and evidence are tracked in `tasks/manual-agenda-order.md`;
approval is not passing test or release evidence.
