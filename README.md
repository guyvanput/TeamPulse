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
GitHub Actions and the container build require their own successful execution;
configuration files alone are not verification. Real GitHub OAuth requires an
operator-created OAuth application.
Auth.js currently uses its v5 beta, pinned in the dependency manifest.

The personal pilot's PostgreSQL is now hosted on Neon. Its ignored `.env` uses a
pooled runtime URL and direct migration URL. Cloud-backed browser and integration
verification passed on a separate disposable branch; the temporary branch was
deleted afterward. Neon backend setup does not publish the Next.js website:
Vercel deployment and interactive GitHub sign-in still require separate evidence.

Only TeamPulse-specific documents and the reusable rules/templates are included.
Inherited locker-framework manuals, office runbooks, review notes, and defect
reports are excluded from version control.

## License

TeamPulse is available under the [MIT License](LICENSE), selected by the project
owner. Third-party dependencies and hosted services retain their own licenses
and terms; model licenses must be reviewed separately.
