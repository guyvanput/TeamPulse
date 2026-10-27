# ADR-0001: One application and PostgreSQL for the demonstration slice

- **Status:** Accepted as part of the design approval
- **Date:** 2026-10-26
- **Owners:** TeamPulse project owner

## Context

TeamPulse demonstrates an AI-assisted SDLC through an owned action that is
reviewed in a later session. The first slice needs persistent state, team access
controls, browser interaction, and reproducible automated evidence.

## Decision

Use Next.js/React/TypeScript as one application, PostgreSQL with Prisma migrations,
and Auth.js/GitHub OAuth with operator-provisioned team membership.
Use Vitest for rules/components/integration and Playwright against the production
standalone runtime. Use GitHub for version control and CI traceability.

Package with Podman-compatible containers. An optional embedded PostgreSQL helper
is development tooling only and allows local verification without Podman.

## Consequences

- One language and deployment unit keep the demonstration understandable.
- PostgreSQL transactions and constraints protect review consistency.
- GitHub hosting is a proprietary free-tier service, not an open-source component.
- Auth.js v5 is currently a pinned beta; revisit its status before production use.
- Real OAuth and container deployment require separate verification.
- No brokers, microservices, Kubernetes, or in-product AI provider are needed.
- Publishing requires an explicit project-license decision.
