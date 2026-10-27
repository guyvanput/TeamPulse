# TeamPulse

Turn discussions into owned improvements, then bring those commitments back
into the next session.

TeamPulse is an AI-assisted SDLC reference application, not a commercial SaaS
launch. The first slice covers authenticated team sessions, owned actions,
cross-session follow-up, and review history.

## Delivery trail

- [PRD](docs/prd.md)
- [Approved acceptance criteria](spec/action-follow-up.md)
- [Approved design](design/action-follow-up.md)
- [Delivery tasks](tasks/action-follow-up.md)
- [Quality gates](docs/QUALITY_GATES.md)
- [Local setup](docs/GETTING_STARTED.md)
- [Release evidence and feedback loop](docs/RELEASE_AND_FEEDBACK.md)

## Stack

Next.js/React/TypeScript, PostgreSQL/Prisma, Auth.js with GitHub OAuth,
Vitest, Playwright, and GitHub Actions. Podman-compatible containers are provided.
An optional embedded PostgreSQL development tool supports machines without a
container runtime; it is not the production database packaging.

Application AI calls, Lean Coffee voting/timers, invitations, and public signup
are not included. AI assists development; automated evidence and human decisions
remain separate.

## Status and constraints

The source is maintained in [guyvanput/TeamPulse](https://github.com/guyvanput/TeamPulse).
GitHub Actions acceptance and the Linux container build passed for the initial
commit, but its container scan failed; overall CI is not green.
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
Container scan remediation and explicit owner acceptance remain release gates.

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
