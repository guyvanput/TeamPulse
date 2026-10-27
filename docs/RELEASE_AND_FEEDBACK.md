# Pilot release and feedback loop

The loop is: approved acceptance criteria -> implementation -> CI -> deployment
evidence -> human pilot acceptance -> observed feedback -> triage -> regression
test or approved next-slice requirements -> verified release.

An online deployment is not an accepted release. Failed or missing evidence
keeps release readiness blocked; neither the smoke command nor a green Vercel
status can waive the gates in `docs/QUALITY_GATES.md`.

## Current candidate: 2026-10-27

Live gate decisions and operator evidence are tracked in
[the initial pilot readiness issue](https://github.com/guyvanput/TeamPulse/issues/1).

| Evidence | Observed state |
|---|---|
| Source | `d9d8415dcd9b47641fa9da1e2662baec4c41985b` (before the remediation changes below) |
| Production origin | https://teampulse-sandy-nu.vercel.app |
| Vercel deployment | `dpl_ARwoWZDJmDodByBmPSVhc6etuJyP`, Ready, production |
| Deployment/source link | The Vercel status on the source commit links deployment `ARwoWZDJmDodByBmPSVhc6etuJyP`, matching the alias inspection during hosted acceptance. |
| CI | [Run 40460592727](https://github.com/guyvanput/TeamPulse/actions/runs/40460592727): acceptance passed; container vulnerability scan failed. Overall CI is **failed**. |
| Container scan | Trivy reported 57 high/critical OS findings and five high findings in bundled npm packages. These are scanner findings, not individually confirmed exploitability assessments. Triage/remediation and a passing rerun remain required; do not suppress the gate to obtain green CI. |
| Hosted smoke | On 2026-10-27, health, sign-in page, provider URLs, and three signed-out route boundaries passed. |
| Interactive OAuth and hosted user journey | Passed with user-completed real OAuth and agent-controlled hosted capture -> In progress -> Done, both notes/context retained after reload. Sign-out and direct saved-action access denial passed. The user separately confirmed unprovisioned OAuth denial; a side-by-side screenshot showed `error=AccessDenied` and the provisioned workspace. |
| Recovery drill | Neon snapshot recovery passed. Independent PostgreSQL custom archive recovery subsequently matched all ten public tables on an empty isolated local target; its recovered app completed the action and retained both notes after reload. Restore/comparison took 1 second; full successful drill took 14 seconds. All drill databases/app processes were removed. |
| Backup policy | User approved six-hour Neon recovery plus operator-run encrypted local archives before releases and on each day of pilot use, with seven-day retention. First production archive passed DPAPI decrypt/checksum and `pg_restore --list` verification; no production restore was performed. |
| Acceptance decision | **Blocked** on the container scan and explicit owner acceptance; hosted admission/journey and archive-recovery evidence are now complete. |

This table describes the published candidate, not any subsequent uncommitted
changes. Update it or a release-readiness issue when a new candidate is deployed.

### Release-loop publication evidence

The owner authorized commit/push of the release-loop changes and BugMagnet skill.
Commit `140442ca2d1d6d08b4eb13738f3581dab4faeef6` published the workflow and
issue forms. The workflow is active. Its
[first execution](https://github.com/guyvanput/TeamPulse/actions/runs/40460270090)
passed hosted smoke and correctly refused release evidence for the original
candidate because its CI failed.

For `140442c`,
[CI run 40460255789](https://github.com/guyvanput/TeamPulse/actions/runs/40460255789)
passed acceptance and again failed the container scan with the same reported
counts. Vercel deployment `dpl_A7Nx3Lin83wpqTS9yY3rmTbuweQc` was Ready on the
production alias, and the Vercel status on `140442c` linked that same deployment.
The deployment has advanced, but release acceptance remains **blocked**.
The readiness issue holds later candidate updates and human decisions.

### BugMagnet admission testing

On 2026-10-27 the user selected `src/auth.ts`, confirmed the project documents
as context, and approved the core and advanced test phases. The tests-only
assessment added `tests/unit/auth.test.ts`: nine core and seven advanced cases.
All 16 passed, with no skipped cases or discovered bugs. Production auth code
was not changed.

Cases cover provisioned identity lookup, missing/other providers, unknown IDs
without email-based admission, zero/multiple memberships, membership removal,
database failure, database session identity, exact string boundaries, and a
valid sign-in after a transient lookup failure. Database and Auth.js boundaries
are mocked; these results are callback tests, not real OAuth or measured
percentage coverage. The separate hosted observations above provide live evidence.

### Container remediation

The user approved replacing the final image with
`gcr.io/distroless/nodejs24-debian13:nonroot`, built on Node 24 Debian 13.
It preserves the standalone server and non-root execution while removing unused
OS utilities, shells, package managers, and npm's bundled dependencies from
the shipped runtime. The scanner still fails on HIGH/CRITICAL findings; no
ignore file, suppression, or severity waiver was introduced.

CI now checks the runtime UID and actual container sign-in-page startup before
scanning. The startup check deliberately uses an unreachable dummy database:
it verifies runtime compatibility, not database health. Container build and
scanner results for this remediation must be recorded after execution.

## Repeatable automated evidence

From the project root:

```powershell
npm.cmd run smoke:release -- https://teampulse-sandy-nu.vercel.app
```

The command makes GET requests only. It fails on unhealthy database responses,
missing sign-in/provider configuration, incorrect callback origin, or exposed
signed-out routes. It never writes fixtures into the pilot, creates auth
sessions, or follows redirects to conceal a login/protection/error page.

After publication, `.github/workflows/pilot-check.yml` adds:

- A daily check at 07:00 UTC, with JSON evidence retained for 30 days.
- A manual release-evidence check with the full deployed commit SHA. It requires
  the latest main-branch push CI run for that SHA to pass, including scans, plus
  a successful Vercel commit status. It also runs the hosted smoke.

In GitHub Actions, enable notifications for failed runs. Guy Van Put is the
initial pilot operator and feedback triage owner. A failed daily run requires
operator investigation; this is a daily smoke, not continuous monitoring or an
availability SLA.

Before running the manual check, use `vercel inspect` on the production origin
and compare its deployment ID with the Vercel status attached to the candidate
commit. Record both links in a **Release readiness** issue. A historical Vercel
success status alone does not establish what the alias serves now.

These workflows are checks, not deployment or promotion automation. The existing
Vercel Git integration can deploy before CI finishes; such a deployment remains
an unaccepted candidate until every required gate and human check is complete.
Do not invite external pilot users while readiness is blocked.

## Human acceptance on the deployed origin

Use synthetic pilot data only. Do not send passwords, OAuth codes, session
cookies, or database URLs as evidence.

1. Verify the OAuth app callback is exactly
   `https://teampulse-sandy-nu.vercel.app/api/auth/callback/github`.
2. Sign in through GitHub as a provisioned account. Record success, date, and
   public deployment URL, not credentials.
3. Create a clearly named pilot session. Capture an action with an owner,
   context, and due date.
4. Create a later session; confirm the unresolved action appears. Review it as
   In progress with a note.
5. Create another later session; complete the action with another note.
   Confirm it disappears from unresolved follow-up but its source and review
   history persist after refresh.
6. Sign out; verify protected routes return to sign-in. Separately verify an
   unprovisioned GitHub identity is denied if one is available; otherwise
   explicitly leave that deployed check pending.
7. Record results against AC1-AC10, the deployed SHA, and the CI/smoke evidence.
   Any failure becomes a feedback issue with a reproducible example.

Production has no deletion feature in this slice. These operator-created
synthetic sessions remain in the pilot; automated acceptance fixtures must
continue to use isolated test databases.

## Recovery and rollback

The Neon project reported `history_retention_seconds: 21600` on 2026-10-27:
a six-hour point-in-time restore window, not unlimited history or an independent
backup. Confirm that window and backup retention again before each acceptance.

An actual snapshot recovery drill on 2026-10-27:

- Created an expiring schema-only source branch with no pilot data.
- Inserted one synthetic user, team, membership, action and review, plus two
  sessions. The action had original context, an owner, a due date, and In progress
  status.
- Created snapshot `snap-patient-cherry-banvrspb`, then changed the source action
  to Done and deleted its review.
- Restored to a separate preview branch without finalization. Exact full-row
  comparison against the pre-change snapshot passed for all six business tables.
  Restore and comparison took 5 seconds; the full drill took 13 seconds.
- Deleted the restored branch `br-nameless-bar-ba4g0znl`, snapshot, and source
  branch `br-shiny-hall-baomq7mz`. Only production remained afterward; no
  production rows or computes were changed.

The first attempt created a preview successfully but misread the CLI restore
response shape. That attempt's preview, snapshot, and source were also deleted
before the successful rerun. No failure was counted as passing evidence.

To repeat with Neon CLI, explicitly name an expiring
`teampulse-recovery-...` schema-only branch of production, populate only synthetic
rows there, and run `neon snapshots create --branch <isolated-source-id>`.
After changing those synthetic rows, run
`neon snapshots restore <snapshot-id> --name <isolated-restored-name>`.
The restore command's response is not a bare branch: identify the newly named
preview through `neon branches list` before querying or deleting it. Never use
`--finalize` or target production for a drill. Compare the restored rows exactly
with the snapshot's expected rows, and delete only the identified drill resources.
Use explicit profile and project arguments for every command.

This proves Neon snapshot recovery of business data, not an independent backup
or a fully recovered application. For an independent archive and isolated-app
recovery drill:

For a recovery drill, use a temporary Neon branch with synthetic data or a local
isolated PostgreSQL database, never overwrite the pilot:

1. With PostgreSQL 17 client tools, create a custom-format `pg_dump` archive from
   the source over a verified TLS connection. Supply passwords through a private
   password file/environment, not command-line arguments or logs.
2. Store the archive outside version control with restrictive access. Treat it
   as sensitive: auth tables can contain tokens. Keep it out of CI artifacts.
3. Restore using `pg_restore --exit-on-error --no-owner --no-acl` to a **new,
   empty isolated database**. Do not use `--clean` against the pilot.
4. Compare sessions, owners, actions, statuses, and review notes with the
   source snapshot, then run the two-session journey on the isolated app.
5. Record archive timestamp/checksum, source snapshot, target isolation,
   recovery duration, and expected versus actual data. Confirm the intended
   retention policy and delete only identified disposable targets/private
   archives when they are no longer needed.

### Independent archive and recovered-app evidence

The missing PostgreSQL tools were resolved with EDB's PostgreSQL 17.11 Windows
binary archive, checked against its published SHA-256 before extraction into the
ignored `.tools/pgsql` directory. No system-wide database installation was added.

Run the repeatable drill after `npm run build`, with a running local PostgreSQL
test server and Playwright Chromium installed:

```powershell
# TEST_DATABASE_URL must be an explicitly configured local *_test database.
$env:PG_BIN = (Resolve-Path .tools\pgsql\bin).Path
npm.cmd run verify:recovery
```

The script first applies the existing test-database guard and additionally
refuses all remote hosts. It creates two randomly named, empty local `_test`
databases, migrates/populates the source with synthetic records, creates a
custom-format archive, changes the source, then restores the archive to the
other empty target. It compares all ten public tables, including migrations
and empty auth tables, against the pre-change snapshot.

It then starts the real standalone app on loopback port 3102 with only the
restored database, creates a test-only database session there, verifies the
original history, and completes the restored action in a new session through
Playwright. Both old/new notes survive reload. It closes the browser/app and
drops only its two named drill databases before reporting success.

On 2026-10-27 the successful drill restored/compared in 1 second; the entire
backup, recovery, and application-continuation check took 14 seconds. The
archive SHA-256 was
`ed6e2a9de67bbdb1905e1b30440d3f7513e536e6f1757ff6598a7da064ed4cc6`.
Synthetic archive/evidence are stored under ignored `.local/recovery`; no
production data or OAuth credentials are used. CI runs the same drill and
retains only the sanitized evidence JSON, never database archives.

The initial drill attempt recovered the rows but failed its last browser
assertion because a reload raced navigation to the history page. The harness
now waits for the expected action URL before reload. The corrected rerun passed;
the failed attempt is not counted as successful application evidence.

### Approved operator backup policy

The user explicitly approved this personal-pilot policy on 2026-10-27:

- Keep Neon's currently configured six-hour restore window; recheck it before
  relying on point-in-time recovery.
- Run an independent encrypted archive **before each release and on every day
  the pilot is used**. This is an operator task, not a scheduled service.
- Retain archives for seven days. The backup command removes only its own
  checksum-verified expired archive/metadata pairs after a new successful backup.
- Store them in ignored `.local/backups`, protected with Windows DPAPI
  CurrentUser encryption and a current-user-only Windows directory ACL.
  Keep the Windows profile recovery available. These archives are not off-site
  protection and cannot be decrypted by another account or machine.

With the project's private `.env` configured and PostgreSQL 17 client tools:

```powershell
$env:PG_BIN = (Resolve-Path .tools\pgsql\bin).Path
$env:PILOT_BACKUP_HOST = '<approved direct Neon hostname, without credentials>'
npm.cmd run backup:pilot
```

The script requires `DATABASE_URL_UNPOOLED` and an exact operator-pinned hostname,
reads only database `teampulse`, and verifies TLS certificates/hostnames using
Node's trusted public CA roots. Passwords are child-process environment values,
not command-line arguments. The custom-format dump stays in memory until
encrypted; the script decrypts the saved file, compares SHA-256, and checks
`pg_restore --list` without restoring anything to production.

The first production backup on 2026-10-27 passed, with 20,998 encrypted bytes and
encrypted-file SHA-256
`9b164bc9ff94884a32fa32ad26554efe1d425e27c3db1f2820b015a6c52dbb65`.
Do not upload these archives or decrypted output to GitHub/CI, or log auth tables.
An actual incident restore still requires operator approval, a safe isolated
target first, and the same exact-data/app checks; the pilot was not overwritten
for this evidence.

For recovery, the original Windows user can decrypt an archive with
`System.Security.Cryptography.ProtectedData.Unprotect` using `CurrentUser`,
then provide the bytes to PostgreSQL 17 `pg_restore` on an approved isolated
target. Keep plaintext out of logs and source control. The operator should seek
a separate off-site recovery arrangement before professional/customer use.

For an application incident, inspect Vercel logs first and select a known-good
deployment with recorded CI and acceptance evidence. Obtain operator approval
before promotion/rollback. This pilot currently has no independently accepted
previous release. Application rollback does not roll back database migrations;
verify schema compatibility before directing traffic to older code. Do not
replay destructive migrations or restore the live database without a separately
approved recovery plan.

## Feedback -> next delivery

Use [Pilot feedback](https://github.com/guyvanput/TeamPulse/issues/new?template=pilot-feedback.yml)
for defects, usability friction, and ideas; use
[Release readiness](https://github.com/guyvanput/TeamPulse/issues/new?template=release-readiness.yml)
to track a candidate's evidence and sign-off. Templates become available after
the files are published to the default branch.

The operator reviews feedback after each pilot session and before selecting the
next slice. Every item gets an owner, impact/priority, and a reasoned decision:
fix now, next slice, defer, or reject. Release-blocking defects are handled before
new features. Security-sensitive details must go privately to the owner rather
than into public issues.

For an approved fix, link the acceptance criterion, minimal reproduction,
regression test, fix PR, and deployed commit. Changed behavior requires spec
and design approval before implementation; do not redefine a failing test's
expected result merely to match a bug. BugMagnet can assist gap analysis, but
its skipped bug reproductions remain unresolved findings.

Close feedback only after a retest on the target deployment is recorded and the
reporter confirms the outcome, or the owner explicitly records why reporter
confirmation cannot be obtained. A defer/reject decision also needs a reason.
Human pilot acceptance must be explicit, not inferred from AI output or a
healthy endpoint.
