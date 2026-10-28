# Facilitated sessions and topic collection: second delivery slice

Status: Gates A and B approved by the owner on 2026-10-27.
Date: 2026-10-27.
Source: `docs/prd.md`, Release 1 and session roles.
Baseline: accepted `spec/action-follow-up.md`.

## User outcome

A team member creates a facilitated session, colleagues explicitly join and
contribute discussion topics, and the facilitator controls collection. People
see each other's saved changes without manually refreshing. Closing preserves
the session history and leaves unresolved actions available to later sessions.

This is the foundation for voting and discussion, not a complete Lean Coffee
meeting or completion of Release 1.

## Decisions confirmed by the owner

On 2026-10-27, the owner selected:

- The creator becomes facilitator; provisioned same-team members explicitly join.
- Saved changes appear automatically within five seconds while the session page
  is active.
- Authors manage their own topics; the facilitator can manage any topic.
- Lifecycle: Collecting -> Collection paused -> Collecting, with final Closed.
- Closed sessions are read-only; unresolved actions continue into later sessions.

The owner approved the complete specification on 2026-10-27 after reading it.
Gate A approval does not constitute design approval or permission to start
production changes before Gate B.

## Scope and permissions

### Creation and participation

- Any authenticated team member can create a facilitated session for that team.
  The creator is its sole facilitator and is automatically a participant.
  New sessions start Collecting.
- Creation uses the existing nonblank session-title rule: trim surrounding
  whitespace, then require 1-160 characters. Persist creator and creation time.
- A team member can view the session and its outcomes before joining. Joining
  is required to submit/manage topics or capture/review actions in that session.
  Reading remains team-scoped, not restricted to the participant roster.
- A member can join while Collecting or Collection paused. Joining twice has
  the same outcome as joining once: one roster entry, no role escalation.
  Closed sessions reject new joins.
- No guest/public links, automatic team enrollment, invitations, participant
  removal, leaving, facilitator transfer, or additional facilitators in this
  slice. Those are deferred role-management capabilities, not implemented MVP
  claims. Team membership remains operator-provisioned.
- The facilitator has participant contributions plus session-control permission.
  Participants cannot change lifecycle state or another author's topics.
- Every operation checks current team membership and identity on the server.
  A saved participant/facilitator record never grants access after team membership
  is lost. No team member is automatically promoted if the facilitator loses
  access; recovery/transfer needs separately approved requirements.

| Operation | Same-team member, not joined | Participant | Facilitator |
|---|---|---|---|
| Read session, topics, roster and outcomes | Yes | Yes | Yes |
| Join a non-closed session | Yes | Already joined | Already joined |
| Submit topic while Collecting | No | Yes | Yes |
| Edit/remove topic while Collecting | No | Own topics | Any topic |
| Pause/resume collection or close | No | No | Yes |
| Capture/review actions in a non-closed session | No | Yes | Yes |

Action operations retain all existing validation, same-team ownership, ordering,
transition and duplicate-review constraints. This slice does not introduce
owner reassignment, reopening Done actions, or deletion of actions/sessions.

### Lifecycle

| Current state | Facilitator operation | Result |
|---|---|---|
| Collecting | Pause collection | Collection paused |
| Collection paused | Resume collection | Collecting |
| Collecting or Collection paused | Close session, with explicit confirmation | Closed |
| Closed | Resume, reopen or other mutation | Rejected; no change |

- In Collection paused, people can read, join, and capture/review actions, but
  nobody, including the facilitator, can add/edit/remove topics.
- Closed freezes the session title, roster, topics, and action/review mutations
  made through that session. Reading history stays available.
- Closing does not complete, delete, or change any action status. An unresolved
  action from a closed source session still appears in an eligible later session
  and can be reviewed there. Its source and earlier reviews remain unchanged.
- Authorization and lifecycle are checked when saving, not just when rendering
  controls. A submission racing pause/close cannot commit after that transition
  has taken effect. An operation that committed first remains part of history.
- Duplicate/stale lifecycle commands return a visible conflict and current state;
  they do not silently reopen or overwrite a newer transition.

### Topics

- A topic has a title, optional description, author, creation time, and last
  update time. Author identity comes from the authenticated user, not form input.
- Trim title/description. Title is 1-160 characters and description 0-4000,
  following existing title/context conventions. Blank titles and over-limit
  input fail visibly without creating or changing data.
- Render content as text, never executable HTML. Accept ordinary Unicode text;
  apply the same length-validation semantics on the server and in the UI.
- Identical topic titles are allowed: separate people may raise the same concern.
  Every topic has a distinct identity. No merging, voting, or topic-to-action
  link is introduced.
- Show topics in creation order, with a stable identity tie-breaker. Editing does
  not move a topic. Author and creation time cannot be edited.
- Removing a topic requires confirmation. Removed topics leave the active list
  but retain their last saved content, author and removal attribution/time for
  read-only session history. No permanent erasure or full revision history is
  promised by this slice.
- Stale edits/removals fail visibly rather than overwriting another saved change.
  Preserve the user's unsaved input so they can reload and reconcile it.

### Shared updates and failure behavior

- Under normal connectivity, another participant's saved topic, roster or
  lifecycle change is visible within five seconds on an active, visible session
  page without a manual refresh. Hidden/offline pages have no five-second SLA.
  Returning to a visible online page refreshes current state within five seconds.
- Never replace unsaved form input during a shared update. If permissions/state
  changed, explain why saving is blocked and preserve the draft.
- Failed saves and failed shared updates have visible, accessible error states.
  Do not claim a save succeeded before server confirmation or silently present
  stale data as current. Offer retry; detect session expiry/access loss without
  exposing protected data or credentials.
- This is small-team pilot collaboration, not an enterprise availability or
  scale guarantee. Transport, refresh strategy and concurrency mechanisms belong
  in the design; no WebSocket or external service is mandated here.

## Compatibility with the accepted pilot

Existing sessions have no recorded creator or participant roster. Do not infer
a facilitator from the first action author, reviewer, or current visitor.

Approved compatibility rule: existing sessions retain their accepted first-slice
behavior and team access, visibly identified as legacy action-follow-up sessions.
They gain no topic collection or fabricated facilitator. Users explicitly create
a facilitated session for the new journey. The existing session-creation journey
remains available as an action-follow-up session alongside the new choice.

Later-session follow-up includes unresolved actions from both kinds of source
session, under the existing ordering/authorization rules. Existing sessions,
actions, review identities, dates, status and history must survive migration
unchanged. No automatic legacy conversion is approved.

## Acceptance criteria and planned harness

The table below defines the planned evidence for each criterion. Local
implementation and executed results are recorded in
`tasks/facilitated-topic-collection.md`; hosted release evidence is still pending.
`TC` identifiers distinguish these criteria from first-slice `AC1-AC10`.

| ID | Testable criterion | Planned evidence |
|---|---|---|
| TC1 | A member creates a same-team facilitated session with a valid title; it starts Collecting, with that member as sole facilitator and participant. Invalid titles create nothing. | Unit boundaries, database integration, browser creation |
| TC2 | A same-team member can read before joining, joins once in Collecting/paused, and gains contribution permissions; repeated joins create no duplicates or role changes. Closed rejects joining. | Integration including concurrent joins, two-user browser |
| TC3 | Signed-out and foreign-team users cannot read or mutate sessions/topics/rosters; forged facilitator/author/session identifiers grant no access. Losing membership invalidates saved session roles. | Negative integration and browser authentication checks |
| TC4 | Joined users submit valid topics only in Collecting. Test title lengths 0/1/160/161, description lengths 0/4000/4001, whitespace-only titles, duplicate titles, Unicode and literal HTML-like text. | Unit validation, integration persistence, browser rendering |
| TC5 | Authors edit/remove their own topics; facilitator manages any topic; participants cannot manage others' topics. Removal confirmation and preserved removed-topic history work. | Authorization integration, participant/facilitator browser checks |
| TC6 | Only the facilitator pauses/resumes/closes. Paused rejects topic writes; Closed rejects all through-session mutations and reopening. Stale controls/direct submissions cannot bypass state. | Transition unit tests, integration, browser state/confirmation |
| TC7 | Concurrent edit/edit, edit/remove, topic-write/pause, join/close and review/close requests preserve the approved permissions/state rules with explicit conflicts, not lost changes. | Real PostgreSQL concurrency integration |
| TC8 | Two independent joined browsers see saved topics/roster/state updates within five seconds on visible online pages, without manual refresh; returning to visibility refreshes within five seconds. | Browser checks measuring save confirmation to rendered update, no arbitrary sleeps |
| TC9 | Shared updates preserve unsaved input; stale saves conflict visibly. Network/read/save failure and session expiry show accessible errors without false success or protected-data exposure. | Browser network/failure scenarios and integration |
| TC10 | A closed session is readable; its unresolved action is reviewed in a later session, retaining source/context/owner/due date and both review histories. Closing does not change action status. | Integration and browser cross-session journey |
| TC11 | Reload/restart preserves new sessions, roles, topics, removed-topic history and lifecycle. Legacy sessions/data remain unchanged and retain first-slice behavior; follow-up spans both session kinds. | Migration fixture comparison, integration, restart browser journey |
| TC12 | Create/join/topic/state controls are keyboard usable, labeled, and announce validation, conflict, state and connectivity messages without background-refresh focus theft. | Accessible-role/keyboard browser checks and focused component tests |

Retain first-slice AC1-AC10 coverage and all strict existing CI/release gates.
Extend the synthetic archive/recovered-app harness to verify the new persisted
records without production fixtures. Any destructive migration needs a separately
reviewed recovery/compatibility plan. Real hosted multi-user verification remains
separate from fixture-based browser tests.

## Explicitly outside this slice

Voting, vote-based agenda ordering, manual agenda reordering, discussion timers,
parking lots, generated summaries, topic-to-action linking, participant
administration beyond joining, session renaming, AI coaching, notifications,
and third-party integrations are deferred. They remain Release 1 or post-MVP
scope as defined by the PRD; this specification does not silently drop them.

## Approval record

- Gate A: approved by Guy Van Put on 2026-10-27 at 10:06 +01:00, stating
  "gate A is ok, just read it". Approval covers the complete specification,
  including role restrictions, topic bounds/removal history, state conflicts,
  and legacy compatibility.
- Gate B: approved by Guy Van Put on 2026-10-27 at 10:37 +01:00,
  stating "Gate B approved"; see `design/facilitated-topic-collection.md`.
- Implementation: authorized within the approved specification and design.
  Production migration, commit and push require separate authorization.
