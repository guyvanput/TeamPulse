# Session history: technical design

Status: Gate B approved by the owner on 2026-10-28.
Date: 2026-10-28.
Prerequisite: owner-approved Gate A in `spec/session-history.md`.
Baseline: published `main` at `677c66c` (CI green), production still `d22256b`.

## Architecture and alternatives

Keep the single Next.js, Auth.js, Prisma/PostgreSQL application. This slice is
**read-only**: no migration, no new column, no new table, no dependency and no
write path. The 19-table recovery drill is therefore unchanged.

Rejected alternatives:

- Stored counters or a materialized history table would add write paths and
  consistency risk for 20-row pages.
- Offset pagination would skip or repeat rows when a session is created between
  pages (violates SH3).
- Loading every session and filtering in the browser (today's behavior) is
  unbounded.

## Lifecycle derivation (pure, tested function `src/lib/session-history.ts`)

Derived only from existing `TeamSession` columns, with no extra joins:

| Condition | Label |
|---|---|
| `kind = ACTION_FOLLOW_UP` | Action follow-up |
| `FACILITATED`, `collectionState = CLOSED` | Closed |
| `FACILITATED`, `votingState = OPEN` | Voting |
| `FACILITATED`, `votingState = FINALIZED` | Discussing (agenda is prioritized; individual topic clocks are not inspected) |
| otherwise facilitated | Collecting (includes paused collection) |

Filter mapping: **In progress** = facilitated and not Closed; **Closed** =
facilitated and Closed; **All** = everything. Action follow-up sessions appear
only under All because they have no lifecycle. Gate B asks you to confirm this.

## Query and pagination

`listSessionHistory(actorId, { teamId, filter, cursor? })` in `service.ts`:

1. Authenticate; require current `Membership` for the team. A non-member, a
   former member and a nonexistent team all get the same generic denial, so
   counts and errors cannot reveal sessions (SH2).
2. One Prisma `findMany` ordered `createdAt desc, id desc`, `take: 21`.
   The 21st row only decides `hasMore` and is dropped.
3. Keyset predicate `(createdAt, id) < cursor`, served by the existing index
   `(teamId, createdAt, id)`. Rows created later are newer than every cursor, so
   they never shift an in-progress page walk; they appear on refresh.
4. `select` includes facilitator name (existing safe display-name rule),
   `_count.topics` where `removedAt = null`, `_count.actions` where
   `status != DONE` and the action's source is this session, and
   `summary: { select: { sessionId: true } }`. Report content is never selected
   (SH5).
5. Counts come from the same statement, so each row is internally coherent
   as of one statement time. Counts across rows and pages are not one global
   snapshot; stated in the UI help text as "counts as of load".

Cursor: opaque base64url of `{ createdAt, id }`, validated with zod (ISO date,
UUID). A malformed cursor returns a validation error, never a different page.
The filter is passed separately and re-applied on every page.

Legacy action-only rows return `facilitator: null`, no topic count and no
summary signal (SH7).

## Interfaces

- `src/app/page.tsx` renders each team's first page through the same service
  function, replacing the unbounded `sessions` include in `listTeams`.
- `GET /api/teams/[id]/history?filter=&cursor=` returns the page DTO. Private,
  `no-store`, authenticated, response validated by a shared zod schema.
- Client component `session-history.tsx`: filter control (native radio group),
  list, Load more, per-filter empty state, Retry. Appends pages, de-duplicates
  by id, keeps loaded rows on failure (SH6), ignores stale responses after a
  filter change using a request token. Keyboard operable; focus stays on the
  Load more button, then moves to the first new row.

## Security and privacy

Server-side membership check on every page; client-supplied team, role or
counts confer nothing. No report text, topic text or action text in the DTO.
Removed participants who remain team members read the same list.

## Test plan (written first)

- Unit: lifecycle derivation table, cursor encode/decode and tamper cases, DTO
  schema, filter mapping.
- Component: filter change resets pages, Load more append and de-dup, failure
  keeps rows and Retry recovers, stale response ignored, empty states.
- Integration (real PostgreSQL): SH1 counts, SH2 non-member and former member
  indistinguishable, SH3 25 sessions with a concurrent create between pages,
  SH4 filters with paging, SH5 summary flag only, SH7 legacy rows, no-write
  check (row counts unchanged), explain-style assertion that the page uses
  the existing index.
- Browser: two identities, filter and Load more, keyboard path, failed load.

## Risks and limits

- Counts are per statement, not a global snapshot (accepted, documented).
- Very large teams filter after the index range scan; fine for pilot scale and
  bounded to 21 returned rows. Revisit with an index only if measured slow.
- No search, sorting options or date ranges (Gate A exclusions).

## Release boundary

Local verification only. Nothing is committed, published or deployed by this
document. Because there is no schema change, production needs only a normal
application deploy after separate authorization.
