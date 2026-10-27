# Spec-driven process

Idea -> Spec -> Gate A -> Design -> Gate B -> Tasks -> TDD -> PR

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
