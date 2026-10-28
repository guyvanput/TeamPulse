# Session participant and role management: eighth delivery slice

Status: Gate A and Gate B approved by the owner on 2026-10-28.
Date: 2026-10-28.
Source: `docs/prd.md`, Release 1 basic role management and facilitator participant
management. Dependencies: existing facilitated sessions and all approved Lean
Coffee slices. Local implementation is not production publication or acceptance.

## User outcome

A facilitator can hand a running meeting to another joined team member and
manage who may contribute, without losing prior contributions or disturbing the
meeting. Team membership remains the outer access boundary.

This is session administration, not invitations, account/team administration,
private subgroups or an expanded enterprise role system.

## Proposed product decisions for Gate A

| Decision | Proposed rule |
|---|---|
| Role model | Exactly one facilitator per facilitated session. Other active joined users are participants. Same-team nonjoined/removed users remain readers, not administrators. No co-facilitators or custom roles. |
| Initial participation | Preserve explicit self-join by current team members, including late joiners. Creating a session still makes its creator the first joined facilitator. No force-joining someone who has never joined. |
| Transfer | Only the current joined facilitator can transfer facilitation to a different, currently active joined member of the same team. The target needs no separate acceptance step. |
| After transfer | The target immediately becomes the sole facilitator; the former facilitator remains an ordinary active participant. A later transfer back is a new attributed operation, not history deletion. |
| Availability | Transfer, removal and readmission are available in any nonclosed facilitated phase, including Open voting or a running discussion. They are unavailable in Closed or legacy action-follow-up sessions. |
| Remove participant | Only the current joined facilitator may remove another active participant. Removal suspends this session's contribution permission, not team membership or read access. |
| Protect the facilitator | The facilitator cannot remove themself or transfer to themself. Hand over first; there is never a facilitatorless session. Participants cannot remove/readmit others or promote themselves. |
| Rejoining | A removed user cannot bypass removal using Join session, a stale page or a forged command. The facilitator must explicitly readmit them while they are still a current team member. |
| Readmission | Readmit restores the previously joined user's active participation; it does not invent a first join, reset original join time, erase removal history or provide a new voting budget. |
| Existing work | Removal/transfer/readmission never deletes topics, ballots, original vote counts/ranks, saved planning positions, attempts, parking, actions or reviews. Existing votes remain counted; previous selections and used budget persist on readmission. |
| Action ownership | Do not reassign actions when a participant is removed or facilitation changes. Existing same-team ownership rules remain; removing session participation is not removing team membership. |
| Running clocks | Changing people/roles never pauses, restarts, extends, advances or rewrites a timebox. The new facilitator explicitly decides subsequent operations under existing timer rules. |
| Confirmation | Confirm transfer and removal with the named target and captured session revision. Removal may include an optional trimmed plain-text reason, at most 4,000 characters. Readmission is also explicit and confirmed. Cancel/failure retains drafts. |
| History | Retain attributed, ordered transfer/removal/readmission events with actor, target, recorded time and removal reason. Transfer history identifies both old and new facilitator. No fabricated events for existing sessions or destructive history cleanup. |
| Rosters | Show active participants separately from previously joined removed participants. Original joined history stays readable. Current team membership is still required for every read/write; no emails, auth records or tokens are exposed. |
| Summaries | Existing reports never change. Future generation still captures the session's facilitator and historical joined roster, including previously joined people who were removed; that roster is not an assertion of active permission or attendance at close. Administrative events remain in linked source history, not a new summary format. |
| Closed history | Closing freezes participant administration and facilitator assignment. Only the current joined facilitator at closure can generate the separately approved single summary. Existing reports, contributions and administration history remain protected and readable. |

Read access is deliberately team-wide: removal is **not** a privacy mechanism.
If someone must lose access to team data, the existing operator-managed membership
boundary applies. This slice does not introduce a team-member removal UI.

## Coherence and failure behavior

- Authenticate and recheck current membership, active participation, current role,
  target scope/status, phase and exact expected revision on the server.
- Role/participant changes and their attributed history commit together or not
  at all. Concurrent changes never create two facilitators, an orphaned session
  or a contribution accepted after removal has taken effect.
- Preserve the established session-first lock order and distinguish lifecycle
  revisions from per-user ballot versions. Gate B must explain all relevant
  mutation guards, including existing topic/action/review/voting commands.
- A stale confirmation does not silently adopt a new role, target state or phase.
  Exactly one competing transfer/removal/readmission wins; the loser refreshes
  and reconciles. A lost committed response is read back, never replayed.
- New capabilities reconcile through the authenticated uncached snapshot.
  Distinct visible users observe confirmed role/participation changes below
  five seconds under normal connectivity, without a propagation reload.
- Removed users retain unsaved local drafts with an explicit read-only explanation;
  readmission permits saving only where the current topic/phase rules still allow.
  Transfer must not discard old/new facilitator drafts or steal keyboard focus.
- Offline, hidden, pending, unsynchronized or malformed state disables writes.
  Access loss clears protected rosters/history/contributions/reports and drafts.
  Browser-only disabling is not an authorization boundary.
- Render names/reasons as plain text with keyboard-accessible confirmations,
  clear current roles and explicit errors; do not infer a live role from history.

## Compatibility, verification and delivery

Gate B must specify minimal persistence and preserving migration, active versus
historical participation, retained ballots/budget, role-transition concurrency,
all affected authorization surfaces and source/report compatibility.
Preserve every old row/column without invented administration events. Retain all
existing AC/TC/VP/TD/PL/MO/MS and active BugMagnet regressions.

Extend exact archive restoration and actual recovered-app restart to the
transferred role, removed/readmitted state, original voting budget, unchanged
clocks/contributions and attributed history. Previously stored summaries must
remain byte-for-byte unchanged as live administration occurs in other sessions.
Production backup/copy rehearsal, matching-binary cutover, CI/scans, hosted
identity/latency checks and human acceptance remain separate.

## Acceptance criteria and planned harness

The following are proposed, not implemented or passing evidence.

| ID | Testable criterion | Planned evidence |
|---|---|---|
| RM1 | Only a current active joined facilitator administers a nonclosed facilitated session; strict target/team/role/phase/forged-input denials. | Authorization/input matrix and actual queued membership/participation races. |
| RM2 | Transfer leaves exactly one facilitator and keeps the old facilitator active; a running clock and all contributions remain unchanged. | Exact before/after source comparison, real competing transfers and timed browser journey. |
| RM3 | Removal blocks all existing contribution/admin mutations and self-rejoin, without revoking same-team reads or deleting contributions. | Complete existing-command guard matrix, stale-page and forged-command browser/service checks. |
| RM4 | Explicit readmission restores active participation with original join history, selected votes and used budget. | Remove/readmit/reverse cycles, budget-boundary and role/target race checks. |
| RM5 | Named revision-bound confirmations, optional bounded plain-text reason and atomic attributed history preserve drafts and reject stale/ambiguous replacement. | Component, rollback-injection and one-POST lost-response browser cases. |
| RM6 | Distinct visible users reconcile permissions below 5,000 ms without losing drafts/focus; unavailable reads disable writes and access loss clears protected content. | Measured multi-identity browser journey, keyboard and offline/malformed/access cases. |
| RM7 | Closed administration is frozen; historical roster and saved reports do not become live permission/attendance claims or get rewritten. | Closed/summary compatibility and source/report equality checks. |
| RM8 | Every old column/row and new administration history survive migration, exact archive restore and actual app restart. | Migration failure rollback, all-table equality and recovered application continuation. |
| RM9 | Prior accepted/approved behavior and separate publication/acceptance boundaries remain enforced. | Unchanged full aggregate/recovery, separate CI/scans and authorized hosted acceptance. |

## Explicit exclusions

Invitations, public signup/sharing, account/team membership administration,
co-facilitators, custom roles, self-leave, anonymous users, removing the current
facilitator without transfer, changing Closed roles, automatic handover after
absence, approval requests for the receiving facilitator, erasing historical
votes/contributions, resetting vote budgets, reopening sessions, report editing,
AI recommendations and external integrations.

## Gate A review

Verify these deliberate choices:

1. One facilitator; explicit immediate handover to another active joined team
   member, with the old facilitator remaining a participant.
2. Removal stops contributions, not team-wide reading. Self-rejoin is blocked
   until explicit facilitator readmission; original history/budget survives.
3. Administration is allowed during voting/discussion, but never changes clocks,
   ballots, agenda or actions. Closed and legacy sessions cannot be administered.
4. Confirm named targets and record attributed history; retain drafts through
   role changes, conflicts and ambiguous responses.
5. Summaries remain immutable historical records, not current permission lists;
   no invitations, team administration or expanded roles are included.

Gate A approval authorizes technical design only. No schema, application behavior,
commit/push, production migration, downtime or deployment is approved here.

The owner selected "Approve Gate A" on 2026-10-28, including immediate handover,
contribution-only removal, explicit readmission with retained budget/history and
Closed-state restrictions. The proposed technical design is in
`design/session-participant-and-role-management.md`. The owner approved Gate B
on the same date; local execution is tracked in `tasks/session-administration.md`.
