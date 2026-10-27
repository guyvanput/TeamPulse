# Getting started with TeamPulse

## Prerequisites

- Node.js 24 LTS and npm; Git for version control.
- PostgreSQL 17, through Podman/Compose or the optional local development helper.
- A GitHub account and OAuth application for actual browser sign-in.

On Windows use `npm.cmd` and `npx.cmd` if PowerShell blocks npm's script shim.
This workspace was bootstrapped with a project-local Node runtime under `.tools`.
It is ignored by Git and is not an installation requirement for other machines.
To use that runtime in a new PowerShell window:

```powershell
$env:Path = (Get-ChildItem .tools -Directory -Filter 'node-*-win-x64' |
  Select-Object -First 1 -ExpandProperty FullName) + ';' + $env:Path
```

## Install and configure

```powershell
npm.cmd ci
Copy-Item .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Put the generated value in `AUTH_SECRET` in `.env`. Never commit or share it.
Do not overwrite an existing `.env` when repeating setup.

Choose one database option:

| Option | Start command | Database port |
|---|---|---|
| Podman with a Compose provider installed | `podman compose up -d db` | 5432 |
| Local development helper, in its own terminal | `npm.cmd run db:local` | 55432 |

For the helper, set both database URLs in `.env` to port 55432 and host
`127.0.0.1`. It binds only to loopback and stores data in `.local/postgres`.
It uses documented development-only credentials, never for public deployment.
Stop it with Ctrl+C. It needs no system-wide PostgreSQL installation.

For Compose, set `POSTGRES_PASSWORD`, `DATABASE_URL`, and
`CONTAINER_DATABASE_URL` consistently. The latter uses host `db`; host-based
tools use `localhost`. The default credentials are local-development examples.

## Configure GitHub sign-in

Under GitHub Settings > Developer settings > OAuth Apps, register an application:

- Homepage: `http://localhost:3000`
- Callback: `http://localhost:3000/api/auth/callback/github`

Set `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` in `.env`. Keep the browser URL,
OAuth URLs, and `AUTH_URL` consistent. Use separate OAuth applications for other
origins. The application is not publicly deployable with local HTTP settings.

Find an authorized user's **numeric GitHub account id**, for example:

```powershell
gh api user --jq .id
```

Set `DEMO_GITHUB_IDS` to comma-separated approved ids. The seed creates Demo
Alpha memberships for those accounts and a separate synthetic Demo Beta team.
No email or username matching grants membership. Re-running the seed does not
delete existing sessions or actions.

```powershell
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd run dev
```

Open `http://localhost:3000` and sign in. An unprovisioned account is denied.

## Demonstrate the first slice

1. Create a session called "First conversation".
2. Capture an action, choose its owner, add discussion context and a due date.
3. Return to the workspace and create "Next conversation".
4. Review the previous commitment with a progress note and resulting status.
5. Open the action history to see the source, owner, and review.
6. Refresh or restart the application: the action and review remain in PostgreSQL.

No in-product AI service is needed. Use the linked requirements, design, code,
and test evidence to explain where AI helped and where humans approved.

## Automated checks

Create a separate local database named `teampulse_test` and configure
`TEST_DATABASE_URL`. The helper creates it automatically. For Compose:

```powershell
podman compose exec db createdb -U teampulse teampulse_test
```

Apply the same migrations to that database in a separate shell:

```powershell
$env:DATABASE_URL = 'postgresql://teampulse:local-dev-only@127.0.0.1:55432/teampulse_test'
npm.cmd run db:migrate
npx.cmd playwright install chromium
npm.cmd run gate:merge
```

Adjust credentials/port for your database. Unit tests require no database.
Integration and browser tests refuse missing test URLs and database names that
do not end in `_test`. Remote tests require a separately provisioned Neon
verification database and an explicitly pinned test hostname (see below).

Browser tests create real database session records in the isolated test
database. They do not bypass authentication in application code. This verifies
the authenticated application journey, not the GitHub OAuth exchange.
Real OAuth needs the manual smoke check above.

The production build is also used by browser tests. `npm.cmd run build` packages
the standalone runtime and static assets; `npm.cmd start` serves it on loopback.
Browser test ports 3100 and 3101 must be free.

## Neon personal pilot

The project is linked through the ignored `.neon` context. Postgres is the only
declared service in `neon.ts`; Auth.js/GitHub remains the authentication provider.
The installed Neon CLI can use the locally stored `teampulse` profile:

```powershell
neon.cmd deploy --profile teampulse
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd run build
npm.cmd start
```

`neon deploy` configures backend services and pulls their credentials into `.env`;
it does not deploy this Next.js frontend. Existing GitHub OAuth variables are
preserved. Runtime queries use the pooled `DATABASE_URL`; migrations use
`DATABASE_URL_UNPOOLED`. Keep TLS verification enabled. Use `sslmode=verify-full`
to explicitly preserve certificate/hostname verification with future pg versions.

The existing Prisma/node-postgres driver supports this Node.js application,
including the row-locking review transaction. Vercel deployments attach its pool
to the Vercel lifecycle; no edge-runtime conversion or Neon HTTP driver is needed.

Cloud verification must not target the pilot's application database. Create a
disposable schema-only branch named `teampulse-verification-...` with an expiration
and a separate database named `teampulse_test`. With the global Neon CLI installed
beside the project-local Node runtime, run:

```powershell
npm.cmd run verify:neon -- <verification-branch-id> teampulse
```

This helper verifies the branch is non-default, unprotected, and verification-named,
obtains credentials privately, pins the remote test hostname in the child process,
applies migrations, and runs the full gate. It does not replace `.env` or use the
pilot database for test fixtures. Delete the disposable branch after verification.

To host the website on Vercel, publish the code only when authorized, select the
Next.js preset, and configure database and OAuth secrets privately in Vercel.
Set the deployed HTTPS origin and matching GitHub callback; use a separate OAuth
application for a separate origin. Never import local `TEST_DATABASE_URL` or Neon
CLI API keys as application secrets. Do not copy `.env` to source control.

## Containers

After applying migrations and seeding with host-side tools:

```powershell
podman compose --profile app up --build -d
```

The app and database ports are bound to loopback. Schema migrations and seeding
are explicit operator steps, not automatic runtime changes. The runtime image
runs as a non-root user and has no development seed endpoint.

Before public deployment, choose a license, configure HTTPS and trusted proxy
behavior, rotate example credentials, verify OAuth on the deployment origin,
and demonstrate backup and restore. Never point automated tests at customer data.

## Release and pilot feedback

Use `docs/RELEASE_AND_FEEDBACK.md` after deployment for repeatable hosted smoke,
CI evidence, interactive acceptance, safe recovery/rollback, and structured pilot
feedback. Deployment success is not a substitute for these release gates.
