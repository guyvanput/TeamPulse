# TeamPulse Product Requirements Document (PRD)

| Property | Value |
|-----------|---------|
| Product | TeamPulse |
| Version | 1.1 |
| Status | Draft |
| Author | Guy Van Put |
| Date | 2026-10-26 |
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

# 6. Scope

## MVP In Scope

### Lean Coffee Module

- Session management
- Topic management
- Voting
- Discussion timer
- Parking lot
- Session summary

### Action Tracker

- Action registration
- Owner assignment
- Due dates
- Status tracking

### Agile Coach (future increment)

- Story analysis
- Ready score
- Improvement suggestions
- Test ideas
- Risk identification

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

Full Lean Coffee voting, timers, parking lots, and in-product AI coaching are
deferred until the first slice is demonstrated. AI assistance in development
does not require AI features in the application.

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