# Meeting summary: seventh delivery slice

Status: Gate A and Gate B approved by the owner on 2026-10-28.
Date: 2026-10-28.
Source: `docs/prd.md`, Release 1 meeting summary generation.
Dependencies: existing facilitated sessions, voting, discussion, parking,
manual order and action follow-up. Local verification does not publish or accept them.

## User outcome

After closing a Lean Coffee session, the facilitator can create a durable,
readable record of topics, outcomes and owned commitments. The team can revisit
that report without later action updates rewriting what was captured.

This proposal is deterministic reporting, not AI summarization. The application
has no transcript or discussion notes from which to infer decisions. Topic
descriptions are submitted context, not evidence of what people said. An optional
facilitator-written wrap-up can add the meeting's conclusions.

## Proposed product decisions for Gate A

| Decision | Proposed rule |
|---|---|
| Availability | Explicit Generate summary after a facilitated session is Closed. Current joined facilitator only; current team membership is still required. No automatic summary or change to existing close behavior. |
| Older sessions | Previously closed facilitated sessions are eligible. No report is invented during migration; legacy action-only sessions are excluded. |
| Before generation | Show that no summary exists; closing a meeting does not assert that a summary has been produced. |
| Wrap-up | Optional plain-text facilitator note, trimmed, at most 4,000 characters; whitespace-only means no note. No required invented decisions or outcomes. |
| Confirmation | Review the note and confirm creating one permanent report. State that current action details will be captured at generation time, not necessarily as they stood when the meeting closed. Cancel/failure preserves the draft. |
| Report identity | One immutable generated summary per session. Retrying or another tab cannot create duplicates, overwrite the note or change the report. An existing summary is shown explicitly. |
| Source content | Session title, facilitator and joined roster; active topic titles/submitted context; original final vote ranks/counts when held; saved discussion planning positions; final Discussed/Deferred/not-discussed outcomes and latest parked reason; owned actions and reviews associated with this session. |
| Action truth | Capture action title/context, owner, due date, status and this session's recorded follow-up notes as observed when generated. Label action statuses **at summary generation**, not **at meeting close**. Subsequent follow-up remains on the linked action, not silently reflected in the saved report. |
| Attribution | Show who generated the report and its generation time. Wrap-up is clearly facilitator-written. Do not invent a meeting end time, duration, transcript or decision from existing timestamps/descriptions. |
| Unprioritized sessions | Closed-before-voting sessions remain eligible: mark voting Not held and topics Not discussed; do not fabricate agenda ranks, zero-vote results or completed discussion. Removed topics stay in protected session history, not the active-topic summary. |
| Final topic outcomes | Discussed is permanent completion; currently parked is Deferred with its latest reason; restored but never subsequently discussed is Not discussed. Prior Deferred attempts remain in the linked discussion history and do not imply that a currently restored topic is still parked. |
| Reading | Current team members, including nonjoined readers, may view the saved summary from session history. No public link or access through former membership. |
| Delivery | In-app readable report and protected links back to the source session/actions. No new export, file storage, email delivery or public sharing. |
| Exclusions | AI, transcript/sentiment/quality analysis, recommendations, summaries for live sessions, rewriting closed source content, report editing/regeneration/versioning, reopening sessions, participant administration and external integrations. |

One immutable report is intentionally narrower than an editable minutes system.
Corrective summary revisions would require a separately approved follow-up
specification; action progress can continue through the existing workflow.

## Permissions, coherence and failure behavior

- Authenticate and recheck current membership, facilitator, joined status and
  Closed state on the server. Submitted actor, role, content snapshots or action
  ownership cannot confer permission.
- Only summary creation is newly permitted after closure. Topics, votes,
  planning order, clocks, parking, participation and existing close protections
  must not change as a side effect.
- Capture one coherent source view. Persist report content and attribution
  together, or nothing. Concurrent creation yields one retained report; no
  second generation or different note silently replaces it.
- Concurrent later-session action reviews may result in the complete before or
  after action state being captured, not a mixed status/history. Gate B must
  explain the precise consistency boundary.
- A lost committed response reconciles by reading the saved report, never
  automatically replays generation. Stale tabs show the already-created report
  and preserve any unsaved note until the user can review it.
- Disable generation offline, hidden, awaiting reconciliation or without a fresh
  authorized view. Missing/malformed report state fails explicitly; do not show
  a live projection masquerading as an immutable saved report.
- Preserve unsaved wrap-up/action/review/reason drafts across shared updates and
  errors, but not reload or lost authorization. Access loss clears protected
  content, including saved reports and local notes.
- Render all text safely, with keyboard-accessible controls and clear
  generation/confirmation/error/read-only states. No customer data or tokens in
  logs or generated evidence.
- Distinct visible online users observe confirmed report availability and the
  same retained contents below five seconds under normal connectivity, without
  a manual propagation reload.

## Compatibility, verification and delivery

Gate B must define immutable report contents versus live links, source/action
consistency, concurrent generation, authorization and safe old-session behavior.
No table, endpoint, transport or third-party service is prescribed here.

Preserve all old rows/columns and histories through migration. No fabricated
reports for old sessions. Extend archive/recovered-app restart proof with the
generated report, wrap-up, attribution and action snapshot; demonstrate that
later action progress does not rewrite it. Retain all AC/TC/VP/TD/PL/MO and active
BugMagnet regressions.

No commit/push, production migration, deployment or human acceptance is
authorized by preparing this proposal. Release evidence, encrypted backup/
production-copy rehearsal and matching-source cutover remain separate.

## Acceptance criteria and planned harness

The following are proposed, not implemented or passing evidence.

| ID | Testable criterion | Planned evidence |
|---|---|---|
| MS1 | Only a current joined facilitator generates one report for a Closed facilitated session; role/team/join/phase/legacy/forged commands change nothing. | Strict input/authorization matrix and actual queued revocation. |
| MS2 | Exact stored content distinguishes original vote ranks, saved planning positions, Discussed/Deferred/not-discussed outcomes and unprioritized topics without inferred conversation. | Pure content checks, seeded integration and browser assertions. |
| MS3 | Optional wrap-up obeys trim/4,000-character limits, remains plain text and cannot overwrite a generated report. | Boundary/input, rendering and duplicate-generation tests. |
| MS4 | Generation captures owned actions and this session's follow-up notes coherently; later progress changes live actions, not saved report fields. | Coordinated review/generation and subsequent-session follow-up integration/browser checks. |
| MS5 | Concurrent generation, stale tabs, injected failure and a lost committed response produce one immutable attributed report or no writes, never duplicates or partial content. | Real database barriers/rollback and one-POST browser failure injection. |
| MS6 | Distinct visible users see the same saved report below 5,000 ms; keyboard controls, drafts/focus, offline/reconnect and protected access clearing work. | Measured browser journey and separate hosted evidence. |
| MS7 | All old data and newly generated reports survive preserving migration, exact archive restore and actual app restart. | Every-original-column comparison and extended independent recovery. |
| MS8 | Existing workflows, quality gates and separate publication/acceptance boundaries remain enforced. | Complete local aggregate/recovery; separate CI/scans and authorized hosted acceptance. |

## Gate A review

Verify these deliberate choices before approving:

1. Generate a deterministic, non-AI report only after closure, with an optional
   facilitator-written wrap-up; no inference from conversation that was not recorded.
2. Keep one permanent report per session, with no editing/regeneration in this
   slice. Failed/ambiguous commands cannot overwrite it.
3. Capture actions as observed at generation, label that explicitly, and retain
   the report unchanged while live action follow-up continues.
4. Include older closed/unprioritized facilitated sessions honestly, without
   invented vote ranks, discussion outcomes or meeting timestamps.
5. Restrict generation to the current joined facilitator and reading to current
   team members; no public sharing, exports or new AI/backend service.

The owner selected "Approve Gate A" on 2026-10-28, including the immutable
single-report rule, non-AI generation after closure and generation-time action
snapshot. The proposed technical design is in `design/meeting-summary.md`.
The owner approved Gate B on the same date. Execution is tracked in
`tasks/meeting-summary.md`; no publication or release is authorized.
