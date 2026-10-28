# TeamPulse

Turn discussions into owned improvements, then bring those commitments back
into the next session.

TeamPulse is an AI-assisted SDLC reference application, not a commercial SaaS
launch. The accepted slices cover authenticated team sessions, owned actions,
cross-session follow-up, review history and facilitated topic collection.

## Delivery trail

- [PRD](docs/prd.md)
- [Approved acceptance criteria](spec/action-follow-up.md)
- [Approved design](design/action-follow-up.md)
- [Delivery tasks](tasks/action-follow-up.md)
- [Accepted topic collection](spec/facilitated-topic-collection.md)
- [Approved voting specification](spec/topic-voting-and-prioritization.md)
- [Approved voting design](design/topic-voting-and-prioritization.md)
- [Voting implementation and evidence](tasks/topic-voting-and-prioritization.md)
- [Approved timed-discussion specification](spec/timed-topic-discussion.md)
- [Approved timed-discussion design](design/timed-topic-discussion.md)
- [Timed-discussion implementation and evidence](tasks/timed-topic-discussion.md)
- [Approved parking-lot specification](spec/parking-lot.md)
- [Approved parking-lot design](design/parking-lot.md)
- [Parking-lot implementation and evidence](tasks/parking-lot.md)
- [Approved manual-agenda-order specification](spec/manual-agenda-order.md)
- [Approved manual-agenda-order design](design/manual-agenda-order.md)
- [Manual-agenda-order implementation and evidence](tasks/manual-agenda-order.md)
- [Approved meeting-summary requirements](spec/meeting-summary.md)
- [Approved meeting-summary design](design/meeting-summary.md)
- [Meeting-summary implementation and evidence](tasks/meeting-summary.md)
- [Approved session role/participant requirements](spec/session-participant-and-role-management.md)
- [Approved session administration design](design/session-participant-and-role-management.md)
- [Session administration implementation and evidence](tasks/session-administration.md)
- [Quality gates](docs/QUALITY_GATES.md)
- [Local setup](docs/GETTING_STARTED.md)
- [Release evidence and feedback loop](docs/RELEASE_AND_FEEDBACK.md)

## Stack

Next.js/React/TypeScript, PostgreSQL/Prisma, Auth.js with GitHub OAuth,
Vitest, Playwright, and GitHub Actions. Podman-compatible containers are provided.
An optional embedded PostgreSQL development tool supports machines without a
container runtime; it is not the production database packaging.

Voting/prioritization, timed discussion and parking/restoration with retained
attempt history have local verification but are not yet released. The approved
manual agenda-order slice is implemented and verified locally, separating original vote results from the future
discussion plan, including saved parked positions and attributed change history;
its evidence is in `tasks/manual-agenda-order.md`.
The approved meeting-summary slice now stores one permanent non-AI report after
closure, with optional facilitator wrap-up and action values captured at
generation. Local implementation/evidence is in `tasks/meeting-summary.md`;
it is not released. Participant/role administration has approved Gates A/B;
local implementation/evidence is tracked in `tasks/session-administration.md`.
It retains original joins and ballots through removal/readmission and records
explicit single-facilitator handovers without changing clocks. Application AI calls, invitations and public
signup are not included.
AI assists development; automated evidence and human decisions remain separate.

## Status and constraints

The source is maintained in [guyvanput/TeamPulse](https://github.com/guyvanput/TeamPulse).
The accepted facilitated-topic release at `d22256b` passed GitHub Actions,
strict scans and the hosted two-user journey; final evidence and explicit owner
acceptance are in [readiness issue #2](https://github.com/guyvanput/TeamPulse/issues/2).
Real GitHub OAuth requires an operator-created OAuth application and interactive
verification.
Auth.js currently uses its v5 beta, pinned in the dependency manifest.

The personal pilot's PostgreSQL is now hosted on Neon. Its ignored `.env` uses a
pooled runtime URL and direct migration URL. Cloud-backed browser and integration
verification passed on a separate disposable branch; the temporary branch was
deleted afterward. The [personal pilot](https://teampulse-sandy-nu.vercel.app)
is deployed on Vercel. Real GitHub admission/denial, the hosted action journey,
sign-out, Neon snapshot recovery, and an independent archive/recovered-app drill
have evidence recorded in the release runbook. The operator approved seven-day
encrypted local backups in addition to the current six-hour Neon restore window.
Those are historical accepted-release results, not evidence for the uncommitted
voting, timed-discussion, parking, manual-order, meeting-summary or session-administration implementation. New CI/scans, deployment and hosted
acceptance remain required for those slices.

Run `npm run smoke:release -- https://teampulse-sandy-nu.vercel.app` for read-only
health and signed-out boundary checks. The release/health workflow and issue forms
in `.github` connect deployment evidence to operator acceptance and feedback
triage once published; a smoke result alone does not approve a release.

Only TeamPulse-specific documents and the reusable rules/templates are included.
Inherited locker-framework manuals, office runbooks, review notes, and defect
reports are excluded from version control.

## AI-assisted testing

The project includes a reusable [BugMagnet Copilot skill](.github/skills/bugmagnet/SKILL.md),
adapted from [Gojko Adzic's BugMagnet AI Assistant](https://github.com/gojko/bugmagnet-ai-assistant).
Ask Copilot: `Use BugMagnet on src/lib/rules.ts` (or another implementation file).
If a running session has not discovered the new skill, start a new session or
explicitly ask it to read the linked skill file.

The workflow analyzes existing tests and edge-case gaps, then asks for approval
before adding tests. It does not fix production code or run destructive tests
against the live pilot. Installing the skill does not execute an assessment.

## License

TeamPulse is available under the [MIT License](LICENSE), selected by the project
owner. Third-party dependencies and hosted services retain their own licenses
and terms; model licenses must be reviewed separately.
