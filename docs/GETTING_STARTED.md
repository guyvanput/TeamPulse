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

If this checkout's ignored `.env` already targets the accepted hosted pilot,
leave it intact and override both `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in
the local shell for unreleased development/testing. Do not run pending migrations
against the pilot merely to start the newer local application. Production
migration and rollout require their separate authorization and release evidence.

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

## Facilitated topic collection (second slice)

The local second-slice implementation requires the additive facilitated-topics
migration. Existing sessions remain action-follow-up sessions; no facilitator
is invented and no existing action/review is converted.

1. Use "Collect discussion topics" to create a facilitated session. Its creator
   is the facilitator and first participant.
2. Other provisioned same-team members open its URL and select "Join session".
   They can read before joining, but must join before contributing.
3. Submit topics. Authors can edit/remove their own topics; the facilitator can
   manage all topics. Confirmed removals remain in session history.
4. Before voting starts, the facilitator pauses/resumes collection or permanently closes the session.
   Closed sessions are read-only; unresolved actions remain reviewable later.
5. On visible online pages, saved changes are refreshed automatically. Offline
   or failed updates are explicitly marked stale and disable writes until retry
   succeeds. Unsaved drafts survive shared updates, not page reloads or loss of
   authorization.

The accepted second slice does not include voting, timers, parking lots, or
summaries. The third-slice voting implementation is described below; it is not
yet published. The five-second shared
update target is for normal small-team connectivity, not an availability SLA.
Do not roll back to the first-slice binary while facilitated sessions are writable:
it does not enforce the new lifecycle rules. Production migration and publication
remain separate operator decisions; see `design/facilitated-topic-collection.md`.

## Voting and automatic prioritization (third slice, not yet released)

Gate A and Gate B are approved in `spec/topic-voting-and-prioritization.md` and
`design/topic-voting-and-prioritization.md`. Apply the additive
`20261028090000_topic_voting` migration to the intended development/test database.
Existing sessions keep their original history and start with no voting round.

1. Collect at least one active topic, then pause collection.
2. The facilitator selects "Start voting" and confirms the permanent topic freeze.
   This is the only voting round; collection cannot resume afterward.
3. Joined members, including late joiners and the facilitator, can select up to
   three distinct topics, including their own. "Remove my vote" refunds one vote.
   Other people's named ballots are not displayed; aggregate totals are live,
   so this is not a secret ballot.
4. The provisional agenda sorts by total votes, original creation time, then
   stable topic ID. Interactive topic cards keep their original order so live
   priority changes do not move a focused voting control or discard a draft.
5. The facilitator selects "Finish voting" and confirms. Unused votes and zero
   votes are allowed. Finalization stores every active topic's rank/count, including
   zero-vote topics. The round cannot reopen.
6. Capture/review actions while the session is nonclosed, then close when ready.
   Open voting must be finalized, and any current discussion finished or explicitly
   parked, before closure. Final agenda/history remain
   readable; unresolved actions can still be followed up in later sessions.

Unsaved drafts are in-memory only, retained while voting locks topic changes,
and cleared on reload or access loss. A stale ballot from another tab produces
an explicit conflict: refresh/reconcile rather than repeatedly replaying it.
Saved contributions remain counted after membership revocation; restoration of
the same user's access does not reset their budget.

Before any production migration, verify the encrypted backup and rehearse on an
isolated production-copy branch. After voting is used, do not roll back to the
pre-voting application; prefer a forward fix or an explicitly approved maintenance
plan. Local acceptance is not CI, hosted OAuth/latency evidence or pilot acceptance.
The voting task document records which steps have actually run.

## Timed topic discussion (fourth slice, not yet released)

Gate A/B are approved in `spec/timed-topic-discussion.md` and
`design/timed-topic-discussion.md`. Apply the additive
`20261028100000_timed_topic_discussion` migration after voting, only to the
intended development/test target. Existing sessions receive no invented progress.

1. Finalize voting. The facilitator selects "Start next topic" to begin the first
   remaining topic in saved priority order with five minutes.
2. "Pause timer" preserves exact remaining time; "Resume timer" continues it.
   "Extend by two minutes" adds time, staying paused if paused.
3. Expiry shows zero without advancing. Extend an expired discussion for a fresh
   two minutes, or select "Finish topic" and confirm permanent Discussed status.
4. Start the next topic separately. There is no skip, park, custom duration,
   manual reorder or restart operation in this slice.
5. Finish any current discussion before closing, including an expired one.
   Early closure leaves unstarted topics Not discussed. Capture/review actions
   through the existing nonclosed joined-member workflow.

Timer controls await initial synchronization. The displayed countdown is an
estimate anchored to a server sample and monotonic elapsed time, not the device
wall clock. The database decides actual expiry and authorizes every command.
Offline/stale state stops claiming current time and disables writes; reconnect
and reconcile before retrying an ambiguous command. No automatic replay.
Running time continues across app downtime; paused time does not. Vote results
and saved priority ranks stay unchanged.

After discussion is used, do not roll back to the older voting binary: it lacks
the current-discussion close guard. Prefer roll-forward; backup, isolated
production-copy rehearsal and separate rollout authorization remain required.
See `tasks/timed-topic-discussion.md` for actual results and pending release work.

## Parking lot (fifth slice, not yet released)

Gate A/B are approved in `spec/parking-lot.md` and `design/parking-lot.md`.
Apply `20261028110000_parking_lot` after timed discussion, only to the intended
development/test target. The migration preserves original columns/rows and expands
the discussion key to numbered attempts; existing started discussions become
attempt 1, with no fabricated parking history.

1. After voting is finalized, the facilitator may park a waiting or current
   topic with an optional reason. Confirming current parking stops its timer
   as Deferred, not Discussed, retaining exact remaining time and attribution.
2. No next topic starts automatically. Parked topics keep their vote rank/count
   and are skipped by the next explicit start.
3. Confirm Restore to return a topic to original-rank eligibility unless the
   facilitator explicitly changed its saved planning position (sixth slice below). It does not
   interrupt another current topic or start/resume a timer. Its next explicit
   start gets a fresh five minutes, with every earlier attempt retained.
4. Repeat cycles are allowed until Discussed. Parking a waiting topic never
   invents a timebox. Permanent Discussed topics cannot restart.
5. All remaining topics parked is not All discussed. Restore or close when ready;
   current discussions must still be finished or explicitly parked before close.
   Closed history keeps distinct parked, unstarted and Discussed outcomes,
   reasons, people/times, every park/restore cycle and Deferred timeboxes.

Cancellation and uncertain saves retain reason drafts. Confirmations capture
their original revision; cancel/review after remote changes, never blindly replay.
The history is protected by current team membership, including for nonjoined
readers; only the joined facilitator administers it.

Do not run older binaries against the expanded parking schema. Production needs
separately approved backup/rehearsal and a coordinated write-maintenance/cutover
plan; roll forward, never drop repeat-attempt history to restore the old key.
See `tasks/parking-lot.md` for actual verification and pending release evidence.

## Manual agenda order (sixth slice, not yet released)

Gate A/B are approved in `spec/manual-agenda-order.md` and
`design/manual-agenda-order.md`. Apply `20261028120000_manual_agenda_order` after
parking only to the intended development/test database. It preserves all old
rows/columns and initializes saved planning positions from original vote ranks,
without fabricated move history.

1. After voting is finalized, the joined facilitator uses topic-specific Move
   earlier / Move later buttons. Keyboard activation works without a drag gesture
   or modal confirmation. Boundaries/current/Discussed topics are unavailable.
2. The read-only Discussion queue changes; original Final agenda vote results
   and all current clocks stay unchanged. Current/Discussed physical slots
   remain fixed; adjacent future neighbors can be separated by those slots.
3. Parked topics keep visible planned positions but are skipped. Restore returns
   eligibility at the saved planning slot, not necessarily original vote rank.
   Restoring never starts/interrupts a timer; next explicit starts remain fresh
   five-minute timeboxes with old attempts retained.
4. Every successful move retains actor/time and before/after future order.
   Reverse moves do not erase history; closed sessions retain it read-only.
5. Busy/offline/hidden/unsynchronized controls cannot mutate. A stale neighbor
   conflicts; an uncertain save reconciles without replay. Unsaved action/review/
   reason drafts survive updates, not reloads or lost authorization. Move controls
   stay in original-topic order to preserve keyboard focus.

This required column changes voting finalization even before the first move:
do not mix pre-order and current binaries. Production requires a separately
approved encrypted backup, rehearsal of all four unpublished migrations from
the accepted schema, and coordinated write drain/migrate/matching-binary cutover.
Do not drop positions/history for ordinary rollback; roll forward. See
`tasks/manual-agenda-order.md` for actual local and still-pending release evidence.

## Meeting summary (seventh slice, not yet released)

Gate A/B are approved in `spec/meeting-summary.md` and `design/meeting-summary.md`.
Apply `20261028130000_meeting_summary` after manual order only to the intended
development/test database. Old sessions receive no fabricated report.

1. Close the facilitated session. Existing topics, votes, order, timers, actions
   and reviews remain read-only.
2. The current joined facilitator may enter an optional plain-text wrap-up,
   at most 4,000 characters, then select Generate summary.
3. Review the captured note and permanent-creation warning. Confirm to save one
   non-AI report; cancel keeps the draft. There is no edit/regenerate operation.
4. Current team members, including nonjoined readers, can revisit the report
   through protected session history and its summary anchor. Unprioritized
   meetings say Voting: Not held, without fictional ranks or discussion.
5. Action details are captured at generation, not meeting close. Current-action
   links may show later progress, but cannot rewrite this saved report.
6. Another tab's winning report is shown explicitly. A differing local wrap-up
   remains labelled not included until dismissed. Offline/hidden/invalid updates
   disable generation; uncertain saves reconcile by reading, never replaying.
   Reload or access loss clears local drafts.

There is no AI, export, public link or automatic report. See
`tasks/meeting-summary.md` for actual evidence. Before production, separately
authorize encrypted backup, isolated production-copy rehearsal of all five
unpublished migrations, coordinated drain/migrate/matching-binary cutover and
the hosted OAuth/two-identity acceptance journey. Local success does not authorize
any of those operations.

## Session administration (eighth slice, not yet released)

Gates A/B are approved in `spec/session-participant-and-role-management.md` and
`design/session-participant-and-role-management.md`. Apply
`20261028140000_session_administration` after meeting summary only to the
intended development/test database. Existing joins start active; no historical
events are invented.

The current active joined facilitator can transfer immediately to another active
joined team member, remove another participant from contributing, or explicitly
readmit a removed participant. Review the named target and captured revision,
then confirm. Optional removal reasons are plain text, at most 4,000 characters.
These operations are available during voting/discussion but never alter clocks
or contributions. The previous facilitator remains an ordinary participant.
Closed and legacy sessions cannot be administered.

Removal does not revoke same-team reading. A removed user cannot self-rejoin;
readmission restores their original join, selected votes and used budget.
Historical joining is not evidence of attendance or current permission.
Previously displayed facilitator controls/drafts remain mounted but lose current
permission after handover. Stale confirmations require cancellation and review;
uncertain responses are read back, never automatically replayed.

See `tasks/session-administration.md` for execution evidence. Pre-administration
binaries ignore removal markers: do not run mixed versions or roll back to those
binaries after removals. Production requires separately authorized encrypted
backup, rehearsal of all six unpublished migrations from the accepted schema,
coordinated write drain/migrate/matching-binary cutover and hosted acceptance.

## Automated checks

Create a separate local database named `teampulse_test` and configure
`TEST_DATABASE_URL`. The helper creates it automatically. For Compose:

```powershell
podman compose exec db createdb -U teampulse teampulse_test
```

Apply the same migrations to that database in a separate shell:

```powershell
$env:DATABASE_URL = 'postgresql://teampulse:local-dev-only@127.0.0.1:55432/teampulse_test'
$env:DATABASE_URL_UNPOOLED = $env:DATABASE_URL
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

For an independent archive/recovered-app drill, install PostgreSQL 17
`pg_dump`/`pg_restore`, set `PG_BIN` to their directory, and run
`npm.cmd run verify:recovery` after building. Keep the local test database server
running and port 3102 free. This command refuses remote databases, uses only
randomly named local `_test` databases and synthetic records, and removes its
databases/app process afterward. See the release runbook for measured evidence.
It compares every public table, continues restored Open voting, verifies stored
Finalized ranks/counts, and restarts the isolated application process to check
that neither ballots, final agenda nor running/paused/expired/finished discussion
deadlines, remaining time or history relies on server memory. Repeated parking/
restoration, manually saved full planning positions, original vote ranks,
current/Discussed frozen slots and attributed/reverse order-change history are
also compared and verified after an actual recovered-app restart.
The exact 19-table comparison includes immutable summaries and administration
events. Transferred/removed permissions, repeated removal/readmission history,
original joins and used ballots survive restoration. The new facilitator
explicitly readmits a participant without changing running clocks. A restored live
action is completed afterward; captured report contents, attribution and time
must remain identical before and after the app-process restart.

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
`vercel.json` pins functions to Frankfurt (`fra1`), alongside the existing
`aws-eu-central-1` database. Verify the deployed function region and actual
authenticated snapshot latency; the default Washington placement exceeded the
two-second polling timeout during hosted verification. Do not mask deployment
latency by relaxing the approved timeout or caching authenticated snapshots.
Set the deployed HTTPS origin and matching GitHub callback; use a separate OAuth
application for a separate origin. Never import local `TEST_DATABASE_URL` or Neon
CLI API keys as application secrets. Do not copy `.env` to source control.

## Containers

The final image uses the non-root Node 24 Debian 13 distroless runtime; it has
no shell, npm, or package manager. Build tooling stays in the build stage.
Use application health endpoints and host-side logs for operation rather than
assuming an interactive shell exists inside the container.

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

The approved personal-pilot backup policy is operator-run: use
`npm.cmd run backup:pilot` before releases and on each day of pilot use, retaining
encrypted archives for seven days alongside Neon's current six-hour restore
window. This Windows-only command requires PostgreSQL 17 tools, the private direct
`DATABASE_URL_UNPOOLED`, and an explicit `PILOT_BACKUP_HOST`. It verifies TLS and
encrypts archives for the current Windows user before writing to `.local/backups`.
Keep Windows profile recovery available; this is not off-site disaster recovery.
Never commit/upload backup files. Full instructions and limitations are in the
release runbook.
