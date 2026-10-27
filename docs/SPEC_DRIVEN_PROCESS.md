# Spec-driven process

Idea -> Spec -> Gate A -> Design -> Gate B -> Tasks -> TDD -> PR -> CI ->
Deployment evidence -> Human pilot acceptance -> Feedback -> Triage -> Next spec

## Required artifacts

- `/spec` : requirements + acceptance criteria
- `/design` : architecture and technical decisions
- `/tasks` : implementation plan and execution order

## Gate definitions

- **Gate A (Spec approval):** scope and acceptance criteria are complete and testable.
- **Gate B (Design approval):** architecture/design covers constraints and trade-offs.

## Delivery rule

No production implementation starts before Gate A and Gate B are approved.

## Refactoring track

A refactoring changes structure, not behaviour. It uses a shorter path:

Debt item -> Tasks -> Refactor -> Proof -> PR

- **Tasks:** `/tasks/<name>.md` names the debt, the target structure and
  what stays observably the same. A spec and design are needed only when a
  public boundary or observable behavior changes.
- **ADR:** required when the refactoring moves a responsibility between
  layers or retires a public element. Otherwise the commit message is enough.
- **Proof of preserved behaviour:**
  1. Relevant automated checks pass before and after. Document any baseline failures.
  2. Existing acceptance coverage is preserved; explain retired or replaced tests.
  3. New behavior or boundaries receive focused tests mapped to acceptance criteria.
- **One debt item per commit**, so any refactoring can be reverted alone.

## Approval and evidence

Record Gate A and Gate B decisions in the applicable specification and design.
A proposed document is not an approval. Initial artifacts may describe intended
test paths and commands, but must label them as planned until implemented.

Use the PRD as product context, not as evidence that every later design choice
has been approved. AI prepares proposals and implementation; humans approve
scope and design. Tests and delivery artifacts verify the resulting behavior.

## AI-assisted demonstration, not vibe coding

The purpose is to show AI doing traceable engineering work inside an approved
specification and design, with an executable test harness deciding whether the
result meets the agreed behavior. AI is not an in-product feature in this slice.

| Stage | AI contribution | Required boundary/evidence |
|---|---|---|
| Feedback and requirements | Analyze observed feedback on demand, identify defects versus new scope, draft testable criteria | Human approves Gate A; no inferred requirements |
| Design | Propose the smallest design and explain alternatives/risks | Human approves Gate B before production behavior changes |
| Implementation | Write focused tests and code against approved criteria | Trace changes to the specification; preserve team/auth boundaries |
| Verification | Run the harness, investigate failures, and use approved BugMagnet phases for additional test ideas | `npm run gate:merge`, strict CI scans, archive/recovered-app checks, and hosted evidence |
| Delivery and learning | Prepare candidate evidence and feedback decisions | Human explicitly accepts the pilot; AI cannot waive failed gates or approve its own changed scope |

Feedback triage is AI-assisted and operator-invoked for the demonstration, not
a promise that the operator manually analyzes every report or that an autonomous
agent is already scheduled. AI prepares a decision with specification links,
reproduction, a regression test or proposed next-slice criteria, and actual
evidence. The human remains accountable for approval and prioritization.
Do not treat AI-generated explanations or a green build alone as proof.

## Release and learning

Follow `docs/RELEASE_AND_FEEDBACK.md` for release evidence, hosted smoke,
interactive acceptance, recovery, rollback, and feedback triage. A successful
deployment is a candidate, not acceptance. Track failed or unverified gates in
a release-readiness issue, and link feedback to regression tests or approved
next-slice requirements before closing the loop.
