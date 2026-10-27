# TeamPulse exploratory testing

Explore a narrow business risk with synthetic data. Manual observations help
discover defects but do not replace the acceptance checks in `QUALITY_GATES.md`.

## Prepare

Choose a charter, expected rule, team identity, and time box. Use a local
demonstration environment with disposable data, not a customer's account.
Record prerequisites and the cleanup owner before changing data.

## First-slice charters

- Capture: blank and boundary-length titles, international text, optional dates,
  invalid calendar dates, and discussion-context rendering.
- Ownership: only same-team members can own actions; altered form identifiers
  cannot grant access to another team.
- Continuity: old unresolved actions appear in later sessions, while current,
  future, completed, and foreign-team actions do not.
- Reviews: blank notes, duplicate submissions, concurrent reviews, and visible
  failure when a database operation fails.
- Persistence: refresh and application restart preserve source context and history.
- Accessibility: keyboard navigation, input labels, focus visibility, and error
  announcements at narrow and wide viewport sizes.

## Classify and reproduce

Distinguish an application defect, a test defect, a setup/data blocker, and an
unresolved expectation. Confirm the expected behavior against the approved
specification, not the existing UI. Reduce a finding to a deterministic sequence.

Record the requirement, minimal synthetic steps, expected and actual behavior,
environment/time, sanitized evidence, and regression-test path or blocker.
Do not attach cookies, OAuth credentials, database URLs, or real customer content.

## Automate

Add a focused failing regression for confirmed behavior changes, implement the
fix, and run the applicable quality gates. Do not weaken an assertion to match a
defect, silently skip unavailable setup, or present synthetic evidence as a live
OAuth or deployment check.
