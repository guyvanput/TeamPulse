---
name: bugmagnet
description: Use when asked to run BugMagnet or perform systematic test coverage and edge-case analysis on a TeamPulse implementation file. Follows the BugMagnet AI Assistant workflow with approval between phases and tests-only implementation.
---

# BugMagnet for TeamPulse

Read [the complete upstream workflow](references/bugmagnet.md) before starting.
Follow its phases and edge-case checklist, pausing for user input between phases.
If no implementation file was specified, ask the user to select one before
beginning.

## Project conventions

- Read `docs/AGENT_RULES.md`, `docs/QUALITY_GATES.md`, `docs/prd.md`, and the
  applicable files in `spec/` and `design/`.
- Use the existing Vitest and Playwright suites and package scripts. Do not
  install coverage tooling unless requested; report unavailable coverage
  measurements honestly.
- Ask for additional requirements/context at the end of Phase 1 and approval
  of the proposed test gaps at the end of Phase 2.
- Add tests only. Do not change production implementation or redefine approved
  behavior to make tests pass. Report ambiguous behavior for a user decision.
- For a confirmed bug, preserve a minimal reproduction and clearly report any
  skipped test as an unresolved bug, not passing coverage.
- Never run destructive tests against the live Neon pilot database or hosted
  production application. Follow the repository's isolated test-database guards.
- Keep secrets and real customer data out of test fixtures and reports.
- Report results in the conversation unless the user requests a report file.

## Source and license

Adapted for Copilot from
[gojko/bugmagnet-ai-assistant](https://github.com/gojko/bugmagnet-ai-assistant).
The bundled `references/bugmagnet.md` is an unmodified copy of
`commands/bugmagnet.md` at commit
`c5abc94ccef810370fe641d54f2fd40fbd1c173c`.
The upstream workflow is MIT licensed, copyright (c) 2025 Gojko Adzic;
see [LICENSE.md](LICENSE.md).
