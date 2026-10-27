# Action follow-up delivery tasks

Status: local first slice implemented after Gate A and Gate B approval.

- [x] Update PRD with the SDLC demonstration objective and first slice.
- [x] Prepare proposed acceptance criteria and design.
- [x] Obtain Gate A and Gate B approval and record any revised rules.
- [x] Initialize Git locally and configure the user-provided GitHub remote.
- [x] Select the MIT license with the project owner before initial publication.
- [x] Scaffold Next.js/TypeScript and establish dependency lockfile, ignore rules,
  environment template, and static checks.
- [x] Add PostgreSQL container configuration, Prisma migrations, and demo seed.
- [x] Implement Auth.js/GitHub OAuth and server-side team authorization.
- [ ] Configure real OAuth credentials and verify an operator-provisioned login.
- [x] Add rule, component, and integration tests mapped to acceptance criteria.
- [x] Implement session creation, owned action capture, review, and history.
- [x] Add browser acceptance, negative authorization, and persistence checks.
- [x] Wire quality commands and CI configuration with PostgreSQL and scanners.
- [ ] Execute Linux container build/scans and GitHub Actions after publication
  is authorized. No container runtime is installed on the current machine.
- [x] Document local startup, OAuth provisioning, test execution, and the
  two-session demonstration; replace inherited onboarding guidance deliberately.
- [x] Package the standalone application and demonstrate restart persistence.
- [ ] Demonstrate backup and restore before public deployment.

No task completion above implies a server is left running or a commit was pushed.
Current setup instructions are in `docs/GETTING_STARTED.md`.

## Neon personal-pilot setup (2026-10-27)

- [x] Install Neon CLI and the requested Neon/Postgres agent skills.
- [x] Authenticate through the user-provided local `teampulse` API-key profile.
- [x] Deploy the existing Postgres-only policy and pull private environment values.
- [x] Wire pooled runtime queries, direct migrations, and Vercel pool lifecycle.
- [x] Apply migrations and provision configured demo memberships on the pilot.
- [x] Verify the production build, 25 unit/component tests, 12 integration tests,
  and 6 browser tests against a separate Neon verification database.
- [x] Verify the pilot-connected app: health 200, sign-in 200, GitHub provider present.
- [x] Delete the disposable verification branch and stop the temporary app server.
- [ ] Complete an actual interactive GitHub sign-in on the pilot.
- [ ] Publish/deploy the Next.js application to Vercel after authorization.

Verification used database sessions only on an isolated schema-only branch, not
on the pilot. CLI browser authorization and automatic agent detection initially
failed; the API-key profile and explicit skill-agent selection resolved those
setup blockers. Initial publication was authorized by the user on 2026-10-27. Unrelated inherited
documents, local credentials, installed skills, and generated artifacts are
excluded from the initial commit.
