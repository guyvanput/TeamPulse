# Action follow-up design

Status: approved. Gate B: approved by the user on 2026-10-26.
Prerequisite: Gate A approval of `spec/action-follow-up.md`.

## Stack and deployment

Use one Next.js/React/TypeScript application, PostgreSQL, and Prisma migrations.
Use Auth.js with GitHub OAuth for sign-in; configure the OAuth application and
secrets locally. No cloud database or paid AI service is required.

Run PostgreSQL and, for packaged demonstration, the application through
Podman-compatible containers. Development can run Next.js directly on Windows.
GitHub Actions supplies an isolated PostgreSQL service for CI.
Git is initialized locally on `main`, with `origin` set to
`https://github.com/guyvanput/TeamPulse.git`. No commit or push is implied.

## Boundaries

- UI: team sessions, session details, action capture, prior-action review,
  and action history.
- Server entry points: authenticated reads and mutations, input validation,
  team membership authorization, and explicit error responses.
- Business rules: pure validation and allowed status transitions.
- Persistence: server-only Prisma queries and transactions.

Server-render data where practical; use client components for interactive forms.
Resolve ownership and authorization on the server on every request.
The database is authoritative; browser state and process memory are not storage.
Use Zod for input schemas, with bounded title/context/note lengths defined in
implementation and covered by boundary tests.

## Data model

| Entity | Essential fields and constraints |
|---|---|
| User / Account / Session | Auth.js-compatible identity, provider account, and login session records |
| Team | id, name |
| Membership | teamId, userId; unique pair |
| TeamSession | id, teamId, title, createdAt |
| Action | id, teamId, sourceSessionId, title, context, ownerId, dueDate (PostgreSQL date), status, createdAt, updatedAt |
| ActionReview | id, teamId, actionId, reviewSessionId, actorId, note, resultingStatus, createdAt; unique action/session pair |

Use composite foreign keys where needed to keep source/review sessions and
owner/actor memberships in the same team. Use UUID ids and UTC instants for
creation/history. Earlier sessions use `(createdAt, id)` as a deterministic
ordering key; follow-up queries use that ordering consistently.

## Review consistency

Authorize the actor and both resources. In a transaction, lock the action row,
confirm it remains unresolved and originated in an earlier session, insert the
review, and update status. The unique action/session constraint prevents
duplicate reviews. Translate constraint or concurrent-state conflicts into
explicit user-visible conflict responses, never silent success.
Different-session concurrent reviews serialize on the action and revalidate
against its current status.

## Security and errors

GitHub sign-in does not grant team membership automatically. Seed configuration
must explicitly identify allowed provider accounts and refuse ambiguous or
missing account mappings. Do not use email alone as authorization identity.
Do not create shared default passwords or a runtime demo bypass.

Protect mutations against cross-site requests using the framework's supported
server mutation protections and verify deployment origin/proxy settings.
Return sign-in/access-denied, validation, not-found, and conflict states without
disclosing another team's resource content. Log unexpected failures server-side
without tokens or user-entered content and show a safe failure message.

## Verification

Vitest covers rules. Integration tests use a disposable PostgreSQL database and
real migrations. Playwright covers the two-session flow and access denial.
Test-only authenticated fixtures must be confined to the test harness and must
not introduce an authentication bypass into the shipped application.
Browser fixtures provision actual database sessions in the isolated test database.
Production code uses the same Auth.js database-session validation in every environment.
Include a separately documented real GitHub OAuth smoke check; fixture-based
acceptance cannot prove provider configuration.

Check persistence across an application restart with the same database.
CI runs static checks, tests, and a production build, retaining sanitized failure
evidence. Dependency, secret, and container scans have explicit triage.

## Trade-offs and deferred work

### Personal cloud pilot (user-directed, 2026-10-27)

The user approved connecting the existing application to the existing Neon
project, Postgres only. Auth.js and GitHub sign-in remain unchanged.
Use the pooled `DATABASE_URL` for runtime queries and the direct
`DATABASE_URL_UNPOOLED` for Prisma migrations (local development falls back to
`DATABASE_URL`). Keep node-postgres and Prisma rather than replacing the ORM.
On Vercel, attach the shared pool to the platform lifecycle; each pool is bounded.
No database credential is exposed to client components.

Verification uses a separate, expiring schema-only Neon branch with its own
`teampulse_test` database. Remote tests require an explicitly pinned
`NEON_TEST_DATABASE_HOST`; application/production database names are rejected.
Provisioned GitHub accounts are seeded on the pilot branch, but test auth
sessions and test actions are created only on the isolated verification branch.
Connecting Neon does not deploy the Next.js application to Vercel.

No real-time collaboration is needed for this slice; refresh loads current state.
Manual seed provisioning avoids building membership administration prematurely.
GitHub OAuth adds provider setup but avoids implementing password storage.
No in-product AI calls, external notifications, voting, timers, or third-party
backlog integrations are part of this design.
Public deployment awaits HTTPS, configured secrets, and backup/restore evidence.
