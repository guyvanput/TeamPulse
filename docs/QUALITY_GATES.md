# TeamPulse quality gates

Status: the first slice was accepted on 2026-10-27 after passing CI, strict scans,
hosted checks and recovery; its final evidence is in
[readiness issue #1](https://github.com/guyvanput/TeamPulse/issues/1).
Facilitated topic collection is a separate release candidate. Its approved
specification/design, local execution and rollout evidence are in
`tasks/facilitated-topic-collection.md`; publication/deployment does not waive
its remaining hosted checks or explicit candidate acceptance.

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
