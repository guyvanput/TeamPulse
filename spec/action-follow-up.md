# Action follow-up: first delivery slice

Status: approved. Gate A: approved by the user on 2026-10-26.
Source: `docs/prd.md`, first delivery slice.

## User outcome

As a team member, I capture an owned improvement during a session and review
its progress in the next session without losing the original discussion context.

## Proposed behavior

The user approved these rules and the local implementation on 2026-10-26.

- A signed-in member can create sessions and actions for their own team.
- Actions have a title, optional context, one owner, optional due date, and
  status: Open, In progress, or Done.
- Owners must belong to the same team. Dates are calendar dates, not timestamps.
- A later session shows unresolved actions originating in earlier sessions of
  that team, ordered by originating session creation time, then action creation
  time and id for stable ties.
- A review records a progress note and the resulting status. Done actions
  disappear from the unresolved list, but remain in their source and history.
- An action can be reviewed at most once per session. A repeated submission is
  rejected explicitly without duplicating history or changing status.
- Team membership administration, invitations, reassignment, reopening completed
  actions, deleting sessions/actions, and notifications are outside this slice.
- A documented local seed creates two synthetic teams with members and no
  actions. No public signup or automatic access to seeded teams is provided.
  An operator explicitly maps authorized GitHub accounts to demo memberships.

## Acceptance criteria

| ID | Criterion | Automated evidence |
|---|---|---|
| AC1 | A signed-out user cannot access team data or mutate it. | Browser and server integration auth checks |
| AC2 | A member creates a named session for their team; another team's sessions remain inaccessible. | Browser and integration authorization checks |
| AC3 | A member creates an action with a nonblank title and same-team owner, optional context and due date; initial status is Open and source session is retained. | Unit validation, database integration, browser journey |
| AC4 | Blank titles, invalid dates, missing owners, and foreign-team owners fail explicitly and create no action. | Unit, integration, browser validation |
| AC5 | A session created later shows unresolved actions from earlier sessions of that team; same-session, future-session, foreign-team, and Done actions are excluded. | Integration selection checks and browser journey |
| AC6 | A member records a nonblank progress note and selected status; actor, review session, and timestamp are retained atomically with the status update. | Unit transition checks, integration transaction checks |
| AC7 | Repeated review in the same session is rejected without duplicate history or another status change. | Integration constraint and concurrent-request checks |
| AC8 | After reload and application restart, actions and reviews remain available from PostgreSQL with their original context. | Browser reload plus restart persistence check |
| AC9 | Changing resource ids or submitting a foreign-team action, session, or owner cannot read or modify another team's data. | Server integration negative cases |
| AC10 | The two-session journey is usable by keyboard, has labeled inputs, and announces validation errors. | Playwright keyboard and accessible-role checks |

## Delivery evidence

The first-slice implementation is covered by:

| Criteria | Test file |
|---|---|
| AC2, AC3, AC4, AC5, AC6 | `tests/unit/rules.test.ts` |
| AC10 form labeling | `tests/unit/forms.test.tsx` |
| AC1-AC7, AC9 and database consistency | `tests/integration/follow-up.test.ts` |
| AC1-AC6, AC8-AC10 browser journeys | `tests/e2e/action-follow-up.spec.ts` |

`npm run gate:merge` runs the checks against an isolated PostgreSQL database and
the built standalone application. The persistence test stops and restarts an
application process against the same database.

GitHub OAuth provider configuration, Linux container packaging, GitHub CI, and
backup/restore are not established by fixture-based browser tests. They require
their own evidence before a customer-facing/public deployment.
