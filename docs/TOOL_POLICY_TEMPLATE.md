# Tool policy flow

Request -> Policy Check -> Authorization -> Execution -> Audit Evidence

## Minimum checks

1. **Policy check:** is the requested action allowed for this environment?
2. **Authorization:** does the actor/token have tenant-scoped permission?
3. **Execution controls:** non-destructive by default; explicit intent for destructive actions.
4. **Audit evidence:** keep command/test/report artifacts for traceability.
