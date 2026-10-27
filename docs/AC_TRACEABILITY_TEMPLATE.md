# Acceptance criteria traceability

Use this template in each `/spec` item so every acceptance criterion has
automated coverage.

| Spec | Acceptance criterion | Automated test | Suite | Status |
|---|---|---|---|---|
| `<spec-id>` | `AC1` | `path/to/test` | `api/e2e/unit` | `planned/implemented` |
| `<spec-id>` | `AC2` | `path/to/test` | `api/e2e/unit` | `planned/implemented` |
| `<spec-id>` | `AC3` | `path/to/test` | `api/e2e/unit` | `planned/implemented` |

## TeamPulse example

| Spec | Acceptance criterion | Automated test | Suite | Status |
|---|---|---|---|---|
| `action-follow-up` | `AC3: capture an owned action` | `tests/e2e/action-follow-up.spec.ts` | `e2e` | `implemented` |
| `action-follow-up` | `AC5: review an earlier unresolved action` | `tests/e2e/action-follow-up.spec.ts` | `e2e` | `implemented` |
