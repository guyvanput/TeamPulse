# Facilitated topic collection execution

Gates A and B approved on 2026-10-27. Scope and decisions are in
`spec/facilitated-topic-collection.md` and `design/facilitated-topic-collection.md`.

- [x] TC1/TC11: additive schema, legacy migration comparison and fixtures.
- [x] TC1/TC4/TC6: validation, permissions and lifecycle unit tests.
- [x] TC1-TC7/TC10: transactional services and PostgreSQL concurrency checks.
- [x] TC3/TC8/TC9: authenticated uncached snapshot DTO/endpoint and failure tests.
- [x] TC5/TC6/TC8/TC9/TC12: draft-preserving workspace and multi-user browser checks.
- [x] TC10/TC11: mixed-session follow-up, restart and archive recovery.
- [x] Preserve AC1-AC10 and auth tests locally; leave strict CI/release checks
  enabled and unchanged.
- [x] BugMagnet assessment with its separate approval pauses.
- [x] Resolve the two confirmed BugMagnet findings and reactivate all 11 bug
  reproductions after the owner's separate local-fix approval.
- [x] Obtain separate publication/production migration permission.
- [ ] Complete Linux CI/scans and hosted verification before requesting human
  slice acceptance.

## Local execution evidence (2026-10-27)

Typecheck/lint and standalone build passed. Pre-BugMagnet suite results:
72 unit/component tests, 26 PostgreSQL integration tests, 16 browser tests.
Original first-slice tests remain enabled. New evidence is in:

- `tests/unit/topics.test.ts`: topic bounds and collection transitions.
- `tests/integration/topics.test.ts`: creation, participation, permissions,
  soft removal/version conflicts, closed-source follow-up, and coordinated
  PostgreSQL locks for write/pause, join/close, review/close and revocation races.
- `tests/integration/topic-migration.test.ts`: compare every original column/row
  before/after the new migration in a generated isolated `_test` database.
- `tests/e2e/topics.spec.ts`: two-user updates within five seconds, preserved
  drafts, keyboard flows, removal confirmation/history, stale/failed responses,
  failed save, offline/reconnect, expiry and simulated visibility return.
- `tests/e2e/action-follow-up.spec.ts`: retained first-slice checks plus actual
  process restart of facilitated state/roster/active and removed topics.

The extended `verify:recovery` drill passed against isolated local databases.
All twelve public tables matched exactly after restore; restored topic/roster/
removal history was readable, a new topic was saved, and an earlier action
completed with both notes retained. Latest archive SHA-256:
`5c3a0e865a7197b1330b49661cb7c4ebfb35415fe9bdfb7996e5bdd10b36b9f0`.
Restore/comparison took 1 second; this full drill took approximately 65 seconds.
The source/target databases and app process were removed before success reporting.
Only synthetic ignored archives/evidence remain.

Initial harness attempts exposed an ambiguous session form locator and invalid
Prisma nested-fixture input; corrected without changing the existing acceptance
behavior. A review-draft assertion needed accessible-role rather than implicit
label-text matching, and two new browser tests initially registered inside
another test were moved to top level. These failed runs are not passing evidence.
Zod's current max-length behavior counts Unicode code points; new topic rules
explicitly enforce the approved UTF-16 limits to match browser maxlength.

The pg adapter emits a concurrent-query deprecation warning in the harness.
Checks pass, but this is not a claim of warning-free database dependencies.
No measured coverage percentage is claimed. BugMagnet, Linux CI/container scans,
new hosted multi-user evidence and human acceptance are still pending for this
slice. The accepted production first slice is unchanged; no production migration,
commit or push was performed.

## BugMagnet core assessment (2026-10-27)

The owner selected `src/lib/service.ts`, confirmed the approved documents as
context, and approved all six proposed gap categories. Tests-only core exploration
added 16 integration cases: 11 pass and five are skipped reproductions of one
unresolved input-validation bug. The full integration suite now has 37 passing
tests and five skipped bug cases; the skipped cases were first executed and
failed and are not passing coverage.

`src/lib/rules.ts:16` coerces null, false and empty-string expected versions to
zero. An otherwise authorized command can therefore pause a version-zero session
or edit/remove a version-zero topic without a valid explicit expected version.
The minimal reproductions and proposed type-before-coercion fix are documented
in `tests/integration/topics.test.ts`. Existing authorization still applies and
persisted versions greater than zero still reject those coerced zero values.
No production fix was made during this assessment.

Passing gaps cover identity-field forgery, mismatched/missing topic IDs, malformed
payloads/text/versions, paused action operations, closed reviews/repeated controls,
revoked facilitator access, duplicate-topic identity/stable ordering, immutable
metadata/removal history, and recovery after rejected commands.

Advanced BugMagnet exploration requires its separate approval. This finding
remains unresolved before release; publication and production are unchanged.

## BugMagnet advanced assessment (2026-10-27)

The owner approved advanced exploration. The dated suite added 12 cases:
six pass and six are skipped, confirmed failing bug reproductions.

Advanced numeric cases broadened the coercion finding: true and `[1]` become 1,
allowing otherwise-authorized lifecycle, edit and removal commands at version 1.
This is not limited to initial version-zero rows. The comparison still checks
the coerced numeric value, and all membership/role/lifecycle guards still apply.
Validate number/nonblank numeric-string types before coercion; retain support
for explicit numeric strings used by form-style input.

A second finding is in `src/lib/service.ts:122-123`: large nonnegative expected
versions such as 2147483648 and Number.MAX_SAFE_INTEGER pass input validation but
overflow the PostgreSQL Int filter for topic edits/removals. Expected stale-write
conflict; actual Prisma P2020 / PostgreSQL 22003 error. Rows remain unchanged and
subsequent valid saves work. Compare the loaded topic version/removal state after
authorization and before updateMany, retaining its conditional update guard.
The lifecycle service already returns an explicit conflict for these same inputs.

Passing advanced checks cover explicit numeric-string versions, the int32
boundary, exact UTF-16 limits and Unicode normalization preservation, literal
markup/query-like text storage, three-way edit/pause/close concurrency, recovery
after rejected oversized versions, and complete stable ordering for 100 topics.

Final local evidence: 72 unit/component tests and 43 integration tests pass;
11 integration reproductions remain explicitly skipped for the two unresolved
bugs. All 11 were run and failed before skipping. Typecheck and focused test lint
pass. No coverage percentage or new browser/build/hosted evidence is claimed.
The local database was stopped after assessment. Production code, database,
deployment and Git publication were not changed during BugMagnet.

## Approved BugMagnet fixes (2026-10-27)

After the tests-only assessment, the owner explicitly approved fixing both bugs
and verifying locally. Expected-version validation now checks number/nonblank
string input types before conversion. Topic mutations compare the loaded
version/removal state after authorization, before the database integer filter;
the existing conditional write guard remains.

All 11 confirmed reproductions are active and passing, with no remaining skipped
bug cases. Fourteen additional unit cases protect malformed input types and
explicit numeric-string compatibility. Final regression: 86 unit/component and
54 PostgreSQL integration tests pass (140 total, zero skipped). Typecheck, full
lint and standalone build pass. Three affected browser journeys were rerun and
pass: two-user create/join/moderate/close, remote edit/removal draft preservation,
and keyboard validation/text rendering/confirmed removal. This is not a claim
that all 16 browser tests were rerun after these two fixes.

The first static run exposed Zod's pipe input-generic mismatch; corrected with
an explicit `string | number` coercion input type and reran validation. The first
targeted Playwright invocation selected no tests because its file argument is a
regular-expression filter; reran successfully using test-name filtering.
The existing pg concurrent-query warning remains. No production migration,
commit, push or deployment was performed. The local database and test app were
stopped after verification.

## Release authorization and migration (2026-10-28)

At 07:59 +01:00 the owner stated "accepted, proceed" in response to the proposed
backup, production migration, commit/push, CI/deployment and hosted-verification
sequence. This authorizes publication and rollout; it is not acceptance of an
as-yet unverified deployed second-slice candidate.

A fresh encrypted pilot backup passed DPAPI decrypt/checksum and pg_restore
listing verification at 07:01:23Z. Encrypted archive SHA-256:
`d7c2034ab4aa5c15537188f2dfea724c34c68d8f2a258245a9aac89a7d92b063`.
Seven-day retention remains in effect; Neon still reports a six-hour restore
window. The private archive remains ignored and is not a CI artifact.

Prisma migration deployment was first rehearsed on an expiring copy of production
branch `br-silent-hall-baftggb8`. Every original business-table projection matched
exactly afterward: User 2, Team 2, Membership 2, TeamSession 4, Action 3 and
ActionReview 4 rows. Legacy defaults were correct and the new tables were empty.
The disposable branch was deleted after successful verification.

The same migration `20261027100000_facilitated_topics` was then applied through
the configured direct connection at 07:02:10Z. The same exact original-column
comparisons, legacy defaults and empty-new-table checks passed in production.
The still-deployed first-slice application passed its read-only hosted smoke
after migration. Source publication, new Linux CI/deployment, real hosted
multi-user evidence and explicit candidate acceptance remain subsequent gates.
