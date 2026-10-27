# Agent rules for TeamPulse

- Always add or update automated tests for behavior changes.
- Never bypass authentication, authorization, or policy checks.
- Never implement production changes before spec + design are approved.
- Read `docs/prd.md` and the applicable specification and design before changing behavior.
- Use approved platform libraries and existing application utilities.
- Keep acceptance criteria business-facing and map them to automated tests.
- Enforce team authorization on the server, including reads and mutations.
- Keep secrets and real customer data out of source control, prompts, and reports.
- Distinguish AI contributions, human approvals, and automated evidence.
- Follow `docs/QUALITY_GATES.md`. Do not claim an unimplemented command or an
  unexecuted check has passed.
- Keep unrelated inherited locker-framework documentation out of TeamPulse decisions.
