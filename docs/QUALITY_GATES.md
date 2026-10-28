# TeamPulse quality gates

Status: the first slice was accepted on 2026-10-27 after passing CI, strict scans,
hosted checks and recovery; its final evidence is in
[readiness issue #1](https://github.com/guyvanput/TeamPulse/issues/1).
Facilitated topic collection was accepted on 2026-10-28 at `d22256b`, with the
final CI, regional-latency correction, distinct-user hosted journey and explicit
owner decision in [readiness issue #2](https://github.com/guyvanput/TeamPulse/issues/2).
The voting slice has approved Gate A/B; its local implementation/evidence is in
`tasks/topic-voting-and-prioritization.md`. It is not a published or accepted
release. Publication/deployment cannot waive CI/scans, hosted checks or explicit
candidate acceptance.

Timed discussion has approved Gate A/B; its local implementation and execution
record are in `tasks/timed-topic-discussion.md`. It is also unpublished and
unaccepted. Exact timing, non-UTC clock sampling, coordinated races, scoped
migration preservation and running/paused/expired/finished recovered-app restart
join the existing regression gates; proposed coverage is not executed evidence.

Parking has approved Gate A/B; execution is tracked in `tasks/parking-lot.md`.
Attempt/event migration preserves all pre-parking columns and rows, including
exact existing clocks. Repeated park/restore/actual starts, Deferred versus
Discussed history, rollback/concurrency, stable confirmations and all-table
archive/restarted-app proof join the existing gates. Neither gate approval nor
local evidence authorizes the coordinated production cutover.

Manual agenda order has approved Gate A/B; execution is tracked in
`tasks/manual-agenda-order.md`. Exact future-neighbor swaps, frozen physical
slots, retained parked planning positions, role/phase/revision denials, real
lock races and both deferred-constraint/post-write rollback join the gates.
Verify every old migration column, PostgreSQL constraint deferrability, stable
keyboard focus/drafts, one-POST ambiguous responses, measured two-identity
updates and exact full-table archive/restarted-app history. Gate approval and
local results are not release approval.

Meeting summaries have approved Gate A/B; execution is tracked in
`tasks/meeting-summary.md`. Verify strict Closed/joined-facilitator authorization,
coherent generation-time action values, saved names and versioned report parsing.
Real queued duplicate/revocation/review cases, actual adapter conflict signatures,
after-insert rollback and every-original-column migration preservation join the
gates. Browser proof covers permanent confirmation, plain-text rendering, distinct
visible readers below five seconds, retained unused notes, one-POST ambiguous
response, unavailable reads and access clearing. Exact archive comparison now
covers 19 tables with the administration slice; live action continuation and actual recovered-app restart must
not rewrite the captured report. These remain local results until separately
published, scanned, deployed and explicitly accepted.

Session administration has approved Gates A/B; execution is tracked in
`tasks/session-administration.md`. Require current active-participant checks on
every existing write and self-join path, current-facilitator/target/revision
guards, real actor/target revocation and ordered competing-operation barriers.
Transfer/removal/readmission and attributed events must commit atomically,
without changing clocks, contributions, original joins or ballots. Verify
named stale confirmations, retained focused drafts without retained permissions,
sub-five-second multi-identity updates, one-POST lost responses and access clearing.
Preserve every old migration column and saved report, prove transactional DDL
rollback and verify exact 19-table archive/restarted-app continuation. Older
binaries are not safe after removals; local success does not authorize cutover.

| Gate | Required evidence | Command / source |
|---|---|---|
| Spec approval | Testable acceptance criteria and recorded human approval | Manual Gate A |
| Design approval | Boundaries, data model, authorization, and trade-offs approved | Manual Gate B |
| Static checks | Type checks and lint with no warnings | `npm run validate` |
| Unit and component checks | Business rules, validation, and UI behavior | `npm run test:unit` |
| Database integration | Migrations and persistence against an isolated PostgreSQL database | `npm run test:integration` |
| Browser acceptance | Two-session journey and access-denial cases | `npm run test:e2e` |
| Production build | Application compiles for deployment | `npm run build` |
| Security checks | Secret, dependency, and container scan findings reviewed | CI scanner steps |
| Delivery smoke | Hosted health/auth boundaries plus real OAuth and core journey | `npm run smoke:release -- <https-origin>` plus operator acceptance |
| Recovery | Backup restored and contents/journey verified on an isolated target | Operator recovery drill |
| Pilot acceptance | All gates evidenced and explicit owner approval | Release-readiness issue |
| Feedback closure | Owner, decision, test/fix/deployment and retest linked | Pilot-feedback issue |

`npm run gate:merge` aggregates static checks, unit/component tests,
database integration, browser acceptance, and the production build. CI retains
test results and failure evidence. Security findings require explicit triage;
failed checks cannot silently be ignored.

A missing database, browser, or credential is a blocker, not a passing check.
Local synthetic tests are not evidence of a successful deployed journey.
Do not introduce percentage coverage thresholds without an instrumented baseline.
Public deployment additionally requires configured secrets, HTTPS, access
controls, and a demonstrated database backup and restore.
