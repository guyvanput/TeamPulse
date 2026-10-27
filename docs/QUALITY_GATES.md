# TeamPulse quality gates

Status: local and GitHub acceptance checks have passed for the first slice.
The Linux container built in CI, but its vulnerability scan failed.
The current pilot is deployed, not yet release-accepted. See the candidate
evidence and blockers in `docs/RELEASE_AND_FEEDBACK.md`.

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
