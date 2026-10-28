# TeamPulse architecture and test rules

Status: first-slice rules, aligned with the approved design. Type checks, lint,
and behavior tests provide evidence, but are not a complete automated architecture
audit. See `design/action-follow-up.md`.

The approved second-slice design is in
`design/facilitated-topic-collection.md`. Facilitated session mutations lock the
session and recheck current membership/participation/state inside the write
transaction. Topic/lifecycle versions detect stale commands. Accept only numbers
or nonblank numeric strings as expected versions, not coerced nulls, booleans or
arrays. Compare loaded topic versions before building database integer filters;
oversized stale versions must return a conflict rather than a database error.
Keep the conditional write-version guard. Shared snapshots
are authenticated, uncached, validated DTOs; polling must not reset drafts or
preserve protected content after access loss. Legacy session behavior remains.

- Keep business validation and action transition rules independent of React,
  Next.js, Prisma, and authentication providers.
- Keep database access and authentication integration in server-only modules.
- Validate untrusted input on the server; browser validation is supplementary.
- Resolve the actor from a verified session, never from a submitted user id.
- Check team membership for every session, action, and review read or mutation.
- Validate action owners against membership in the action's team.
- Persist review outcomes and action status changes in one database transaction.
- Keep originating sessions and review history when actions are followed up.
- Render user content as text, not raw HTML.
- Test business rules with Vitest, database behavior against PostgreSQL, and
  complete journeys with Playwright.
- Use accessible names and roles for browser locators. Avoid arbitrary sleeps.
- Isolate test data and never target a customer or production database in tests.
- Keep authentication fixtures confined to a separate test environment; never
  add a production authentication bypass for demonstrations.
- Keep secrets, customer content, and raw OAuth/session tokens out of logs,
  screenshots, prompts, and committed fixtures.

Do not introduce microservices, brokers, vector databases, or Kubernetes for the
first slice. Revisit architecture only when a demonstrated requirement needs it.
