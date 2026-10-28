# TeamPulse Product Requirements Document (PRD)

| Property | Value |
|-----------|---------|
| Product | TeamPulse |
| Version | 1.8 |
| Status | Draft |
| Author | Guy Van Put |
| Date | 2026-10-28 |
| Type | Open-source reference application for an AI-assisted SDLC demonstration |

---

# 1. Product Vision

## Vision Statement

TeamPulse helps teams turn discussions into owned improvements and brings those commitments back into the next session.

It is an open-source reference application demonstrating an AI-assisted software development lifecycle using free and open-source resources where practical. Commercial sales and market differentiation are not the primary goals.

The demonstration connects requirements, acceptance criteria, design decisions, implementation, automated testing, review, delivery, and feedback. Each stage distinguishes AI contributions, human approvals, and verification evidence.

---

# 2. Mission

Provide Scrum Masters, QA Engineers, Product Owners and Team Leads with a simple platform to:

- Facilitate collaborative sessions
- Capture and follow up actions
- Improve user story quality
- Drive continuous improvement
- Reduce administrative overhead

---

# 3. Problem Statement

Most teams use multiple disconnected tools:

- Microsoft Teams
- Outlook
- Jira
- Confluence
- OneNote
- Excel
- Miro

As a result:

- Actions get lost
- Meeting outcomes are difficult to find
- Retro improvements are not followed up
- Stories enter development without sufficient quality
- Teams spend excessive time on administration

---

# 4. Product Goals

## Goal 1

Provide a lightweight Lean Coffee facilitation tool.

## Goal 2

Provide structured action tracking.

## Goal 3

Provide AI-assisted Agile coaching.

## Goal 4

Build a foundation for future team health and analytics capabilities.

---

# 5. Target Audience

## Primary Users

### Scrum Masters

Needs:

- Meeting facilitation
- Lean Coffee management
- Action follow-up

### QA Leads

Needs:

- Requirement quality assessment
- Test idea generation
- Readiness validation

### Team Leads

Needs:

- Visibility of improvement actions
- Meeting follow-up

---

## Secondary Users

### Product Owners

Needs:

- Story quality feedback
- Definition of Ready validation

### Agile Coaches

Needs:

- Team improvement support

### Communities of Practice

Needs:

- Structured workshops
- Discussion management

---

# 6. Users and Roles

## Facilitator

Responsibilities:

- Create sessions
- Start and stop voting
- Start and stop timers
- Move topics to the parking lot
- Reorder the agenda
- Create summaries
- Close sessions
- Manage participants

Permissions: full control of a session.

## Participant

Responsibilities:

- Join sessions
- Submit discussion topics
- Vote on topics
- Participate in discussions
- View outcomes and actions

Permissions: contribute but not administer.

These are session-level product roles. Their assignment, participant-management
rules, and exact operation permissions must be specified and approved before
implementation. They do not replace the existing server-side team-membership
boundary or imply unrestricted access to other teams' sessions.

---

# 7. Scope and Release Boundaries

## MVP (Release 1)

The MVP must enable teams to run a complete Lean Coffee session digitally.

### Included

- Create and manage Lean Coffee sessions
- Add discussion topics
- Vote on topics
- Automatic prioritization based on votes
- Session timer management
- Parking lot for deferred topics
- Meeting summary generation
- Action item capture, including ownership, optional due dates, status tracking,
  and later-session follow-up from the accepted first slice
- Basic role management
- Session history

### Explicitly Excluded

- AI coaching
- AI-generated facilitation recommendations
- Team health analytics
- Trend analysis across multiple sessions
- Meeting sentiment analysis
- Jira/Azure DevOps synchronization
- Enterprise reporting dashboards

Meeting summary generation is an MVP capability, not approval for AI-generated
summaries. Summary contents and generation behavior must be defined in the
applicable specification and design.

## Post-MVP (Release 2+)

Potential future capabilities, not committed Release 1 deliverables:

- AI Agile Coach
- Retrospective insights
- Recommendation engine
- Team participation analytics
- Meeting quality scoring
- Organization-wide reporting
- Predictive coaching and guidance

Potential AI Agile Coach functions include story analysis, readiness assessment,
improvement suggestions, test ideas, and risk identification. These remain
outside the MVP and require separate scope, specification, and design approval.

The owner supplied these release boundaries and session roles on 2026-10-27.
This PRD records product direction, not detailed behavioral or technical approval
for the remaining Lean Coffee capabilities.

---

## First Delivery Slice

Create an owned action during a team session and review it in the next session.

- Authenticate a user and enforce team membership.
- Create a session and capture an action with an owner and optional due date.
- Persist the action and its originating session.
- Bring unresolved actions from earlier sessions into a later session's review.
- Record a review outcome without losing the original action context.

The acceptance criteria and proposed behavior are in
[the first-slice specification](../spec/action-follow-up.md).
The design is in [the first-slice design](../design/action-follow-up.md).
The user approved the specification and design on 2026-10-26 before application
implementation.

The owner accepted the first-slice personal pilot on 2026-10-27; it is the
baseline for the remaining MVP work, not completion of Release 1. Full Lean
Coffee topic management, voting, timers, parking lots, summaries, and session
roles remain to be specified and delivered. In-product AI coaching remains
post-MVP. AI assistance in development does not require AI features in the
application.

## Second Delivery Slice

Create a facilitated session, explicitly join as a same-team participant, and
collect discussion topics with shared updates and facilitator-controlled
collection/closure. The proposed rules and acceptance criteria are in
[the second-slice specification](../spec/facilitated-topic-collection.md).
The owner approved the complete specification (Gate A) on 2026-10-27.
The owner approved the technical design (Gate B) on 2026-10-27; see
[the second-slice design](../design/facilitated-topic-collection.md).
Voting, timers, parking lots, and summaries remain subsequent Release 1 work.

The owner accepted the deployed second slice on 2026-10-28 at source `d22256b`;
verified rollout and acceptance are recorded in
[readiness issue #2](https://github.com/guyvanput/TeamPulse/issues/2).

## Third Delivery Slice

Vote on collected topics and finalize an automatically prioritized agenda.
The proposed product rules, boundaries and planned acceptance coverage are in
[the voting specification](../spec/topic-voting-and-prioritization.md).
The owner approved Gate A on 2026-10-28, including the three-vote budget,
one-round lifecycle, topic freeze, visibility and tie-break rules.
The proposed design is in
[the voting technical design](../design/topic-voting-and-prioritization.md).
The owner approved Gate B on 2026-10-28. Implementation and verification are
tracked in `tasks/topic-voting-and-prioritization.md`; voting is not yet a released
or accepted capability.
Discussion timers, parking lots, manual agenda reordering and summaries remain
separate later slices.

## Fourth Delivery Slice

Run timed topic discussions from the finalized agenda. The approved rules and
planned acceptance coverage are in
[the timed-discussion specification](../spec/timed-topic-discussion.md).
The owner approved Gate A on 2026-10-28: the five-minute timebox, repeatable
two-minute extension, single ordered pass and explicit expiry/completion/closure
behavior. The proposed design is in
[the timed-discussion technical design](../design/timed-topic-discussion.md).
The owner approved Gate B on 2026-10-28. Implementation and verification are
tracked in `tasks/timed-topic-discussion.md`; timers are not a released capability.
Parking lots, manual agenda reordering and summaries remain separate slices.
Preparing this slice does not publish or accept the voting implementation.

## Fifth Delivery Slice

Defer unfinished topics into a shared parking lot and restore them before closure
without changing final vote ranks or losing earlier timeboxes. Approved rules and
planned acceptance coverage are in
[the parking-lot specification](../spec/parking-lot.md).
The owner approved Gate A on 2026-10-28: finalization-only availability,
reason/history retention, fresh timeboxes after restoration and the explicit
eligibility/closure changes. The approved technical design is in
[the parking-lot design](../design/parking-lot.md). The owner approved Gate B
on the same date. Execution is tracked in `tasks/parking-lot.md`; implementation
and release evidence remain separate from approval. Manual reordering and
meeting summaries remain later Release 1 slices.

## Sixth Delivery Slice

Allow explicit facilitator reordering of the future discussion queue while
preserving original vote results, current timeboxes and historical outcomes.
The approved requirements and review examples are in
[the manual-agenda-order specification](../spec/manual-agenda-order.md).
The owner approved Gate A on 2026-10-28, including the intentional choice that
restored topics respect saved manual queue positions once an explicit manual move
has occurred. The proposed design is in
[the manual-agenda-order design](../design/manual-agenda-order.md).
The owner approved Gate B on the same date; implementation/evidence are tracked in
`tasks/manual-agenda-order.md`. This is not a published or accepted capability.
Meeting summaries and remaining participant/
role-management requirements remain separate Release 1 work.

## Seventh Delivery Slice

Generate a durable, deterministic report after closing a facilitated session,
with an optional facilitator-written wrap-up and owned-action details explicitly
captured at generation time. The proposal and deliberate review decisions are in
[the meeting-summary specification](../spec/meeting-summary.md).
The owner approved Gate A on 2026-10-28. The proposed technical design is in
[the meeting-summary design](../design/meeting-summary.md); the owner approved
Gate B on the same date. Execution is tracked in `tasks/meeting-summary.md`.
The local implementation stores immutable reports and retains captured action
values while later follow-up continues. It is not published or accepted.
This does not approve AI summarization, editing/regeneration, exports,
participant administration or release.

## Eighth Delivery Slice

Complete basic session role/participant management: explicit handover to a joined
member, contribution suspension/readmission and protected administration history,
without deleting prior contributions or interrupting a timer. Proposed rules and
Gate A review choices are in
[the session-administration specification](../spec/session-participant-and-role-management.md).
The owner approved Gate A on 2026-10-28. The proposed design is in
`design/session-participant-and-role-management.md`; the owner approved Gate B
on the same date. Local execution is tracked in `tasks/session-administration.md`;
no publication, production operation or acceptance is authorized.
Team membership administration, invitations, co-facilitators and Closed-role
changes are excluded from this proposal.

The approved local implementation now supports immediate handover, retained
removal/readmission and protected history across all contribution guards and
private capabilities. Existing joins/ballots, clocks and saved reports are
preserved. The task document records final aggregate and recovered-app evidence;
local completion is not approval to publish or cut over production.

## Demonstration Success Criteria

- Trace one requirement through design, implementation, tests, and delivery.
- Reproduce the application setup from documented instructions.
- Demonstrate action persistence and follow-up across two sessions.
- Demonstrate a rejected unauthorized operation and a failed validation case.
- Show automated evidence rather than treating AI-generated output as proof.
- Label free hosted services, open-source tools, model licenses, quotas, and
  infrastructure costs separately.

## Approved First-Slice Technical Direction

Next.js, React, TypeScript, PostgreSQL, and Prisma in a single application.
Use Vitest and Playwright for automated evidence, Git/GitHub for traceability,
GitHub Actions for CI, and Podman-compatible containers for local deployment.
Authentication is proposed through Auth.js and GitHub OAuth.

GitHub is a proprietary hosted service with a free tier. Local AI through
Continue/Ollama is optional; model licensing and hardware requirements must be
checked independently. No paid service is required by the proposed first slice.

## Out Of Scope

Not included in MVP:

- Jira integration
- Azure DevOps integration
- Teams integration
- Outlook integration
- Native mobile applications
- Transcript analysis