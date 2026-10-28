# Parking lot: fifth delivery slice

Status: Gate A and Gate B approved by the owner on 2026-10-28.
Date: 2026-10-28.
Source: `docs/prd.md`, Release 1 parking lot for deferred topics.
Dependencies: finalized voting and timed discussion, both implemented and
verified locally but not newly published or accepted.

## User outcome

The facilitator can defer a topic without falsely marking it Discussed.
The team sees a shared parking lot, the reason and attribution, and can return
a deferred topic to the remaining agenda before the session closes.
History explains every defer/restore cycle and retains any earlier timebox.

The owner approved these requirements at Gate A and the design at Gate B before
implementation. See `design/parking-lot.md` and `tasks/parking-lot.md`. This does
not publish or accept this or the preceding slices.

## Approved product decisions

| Decision | Approved rule |
|---|---|
| Availability | Facilitated, nonclosed session after voting is Finalized. No parking during collection or Open voting in this slice. |
| Administrator | Only the current joined facilitator can park or restore. Same-team readers see the lot/history; joining does not grant team membership. |
| Eligible topics | Park a Not discussed topic or the current running/paused/expired discussion. Already Discussed topics cannot be parked or restarted. |
| Meaning | Parked means deferred, not Discussed, removed, resolved or voted against. Keep topic content and original final vote rank/count unchanged. |
| Reason | Optional plain-text reason, trimmed and at most 4,000 characters, retained with facilitator/time attribution. |
| Current timer | Confirm parking to stop the current timebox and retain its exact remaining time, allocation and Deferred outcome. No next topic starts automatically. |
| Restoration | Confirm restore to return the topic to eligible agenda order. It does not interrupt a current topic or start a timer. Its next explicit start gets a fresh five minutes; prior timeboxes/history remain intact. |
| Order | Start the lowest original-ranked eligible topic, excluding parked and Discussed topics. Restoration can put an earlier-ranked topic ahead of other waiting topics, never ahead of the current discussion. |
| Repeated cycles | Repeated park/restore cycles are allowed for a topic not yet Discussed. Preserve each cycle and actual started timebox, not only the latest reason. |
| Closure | A parked topic has no current timer. Closing with parked/unstarted topics is allowed; preserve their distinct outcomes and history. Closed sessions cannot restore. |
| Explicit exclusions | Parking before finalization, manual reorder, parking Discussed topics, automatic carry-over to another session, reminders, summaries, AI and participant-admin controls. |

These are significant approved choices, especially restoration's fresh timebox,
the finalization-only boundary and preserving every earlier attempt.

## Permissions and lifecycle

- Every read and command checks authenticated identity and current team
  membership on the server. Check membership again when a queued command commits.
  Resolve the actor from authentication, never a submitted identity or role.
- A joined participant cannot park another person's or their own topic, restore,
  alter reasons or grant themselves facilitator permission. The facilitator may
  defer any eligible topic, regardless of its author.
- Reject foreign/nonexistent/removed/non-agenda topic IDs without changes.
  Legacy, pre-finalized and Closed sessions reject park/restore commands.
- A topic is exactly one of waiting Not discussed, current, Parked or Discussed.
  It cannot be current and Parked, receive two current timers or be silently
  counted as Discussed when parked.
- Parking a waiting topic creates no fictional start, elapsed time or discussion
  attempt. Parking the current topic ends only that current attempt, at confirmed
  server time, with its remaining time clamped to zero after expiry.
- A paused topic's retained remaining time does not decrease while parked.
  A running topic's old deadline must not keep consuming time after parking.
  Restoring never resumes that old clock; a new explicit start creates the fresh
  timebox, retaining earlier allocation/remaining/outcome history.
- Finishing a current discussion still makes it permanently Discussed in this
  slice. It cannot then be parked/restored as a way to restart.
- The final agenda retains every originally ranked topic, including parked ones,
  with clear progress labels. A parking-lot view is not a rewrite of vote results.
- If all remaining topics are parked, show No eligible topic to start and the
  parking lot, not All topics discussed. The facilitator may restore or close.
- A current discussion still blocks close. Finish it or explicitly park it first;
  neither Close nor Restore performs that operation as a hidden side effect.
- Action capture/reviews, topic/ballot freezes and late joining retain their
  approved behavior. No action or follow-up session is created automatically.

## Confirmation, concurrency and failures

- Parking requires confirmation explaining deferral; for a current topic, warn
  that its clock stops and restoration grants a fresh timebox, not a resumption.
  Cancel changes nothing and retains the reason draft.
- Restoration requires confirmation of original-rank eligibility and the fresh
  five-minute timebox on the next explicit start.
- A stale confirmation or repeated/retried command cannot park a newer attempt,
  multiply history records, restore a Discussed topic, add time or skip a rank.
  Return an explicit conflict and reconcile; no automatic replay.
- Park versus finish/extend/start/close, restore versus start/close and simultaneous
  park/restore operations must preserve one coherent authorized result.
  A lost response after commit requires a fresh snapshot, not another blind move.
- Partial failure cannot leave a stopped timer with no deferral record, a parked
  current topic, missing old timebox history or partially restored eligibility.
- Keep optional reason drafts through pending/error/remote changes. Render
  reasons as text, not HTML. Invalid/oversized reasons fail visibly without writes.
- Offline/stale reads disable mutations until a fresh authorized snapshot;
  access loss clears protected content and drafts. Revocation does not erase
  historical reasons/attribution, and restoring membership cannot reset progress.

## Shared experience and accessibility

- Two distinct visible online contexts see confirmed parking/restoration, current
  topic/timer changes, lot and eligibility within five seconds under normal
  connectivity, without manual refresh.
- Keep interactive topic cards and unsaved action/review/reason drafts stable.
  Moving a topic into or out of a separate read-only lot does not steal focus.
- Provide topic-specific keyboard controls, clear Parked/Not discussed/Discussed
  labels and accessible confirmation/error/state announcements.
- Show parked title/description, original rank/count, optional reason, actor/time
  and retained defer/restore history. Nonjoined same-team readers can read this
  protected history but have no administrative controls.
- Closed-session history retains parked versus unstarted versus Discussed outcomes
  and earlier Deferred timeboxes. No export or meeting summary in this slice.

## Compatibility, verification and delivery

The timing slice deliberately supported one ordered pass with no skip/parking.
This approved slice intentionally changes only the following when parking is used:
eligible next-topic selection excludes parked topics; parking is an explicit
alternative to finishing a current topic before close; restored not-yet-Discussed
topics may start a new timebox with retained previous-attempt history.
Unparked sessions keep their existing behavior. Discussed remains irreversible.

- Preserve every original row/column and existing running/paused/expired/finished
  timing/history through migration. No fabricated prior parking/restore history.
- Gate B must define coherent progress/attempt persistence, immutable historical
  timeboxes, scoped authorization, revisions/atomicity, snapshots and safe rollback.
  No table, transport or worker is prescribed by this requirements document.
- Preserve AC/TC/VP/TD and active BugMagnet regressions; explicitly test the intended
  parking-specific eligibility/closure changes rather than deleting old coverage.
- Extend isolated migration comparison, database races, distinct-user browser
  failures and actual archive/recovered-app restart proof.
- Keep strict CI/scans and real hosted acceptance. New commit/push, production
  migration/deployment and human pilot acceptance remain separate permissions.
  Synthetic tests do not prove deployed OAuth, timing or release readiness.

## Acceptance criteria and implemented harness

The harness paths below are implemented. Actual execution results and remaining
delivery gates are recorded in `tasks/parking-lot.md`, not inferred from approval.

| ID | Testable criterion | Planned evidence |
|---|---|---|
| PL1 | Only a current joined facilitator parks/restores eligible finalized nonclosed topics; foreign/anonymous/participant/legacy/phase and malformed inputs change nothing. | `tests/integration/parking-lot.test.ts`; unit validation and browser denial. |
| PL2 | Parking preserves reason/actor/time and original content/rank/count, never marks Discussed; waiting topics get no fictional timebox. | Unit/integration history and migration comparisons. |
| PL3 | Parking running/paused/expired discussion stops its clock atomically, records exact remaining/allocation and Deferred outcome; no automatic advance. | Deterministic timing and actual PostgreSQL transitions. |
| PL4 | Restore never interrupts/starts a timer; next start respects original eligible rank and creates fresh five minutes with earlier attempts/cycles retained. Discussed cannot restore. | Unit/integration repeated-cycle and browser journeys. |
| PL5 | All-parked is distinct from All discussed; closing preserves parked/unstarted/discussed outcomes and blocks later writes. Actions/reviews remain available while nonclosed. | Integration lifecycle and existing TD/AC regression suites. |
| PL6 | Coordinated park/finish/extend/start/close, restore/start/close and revocation races preserve one current topic, exact history and revisions; injected failure rolls back every related write. | PostgreSQL blocker/barrier/failure injection, stale-tab and lost-response checks. |
| PL7 | Distinct visible users observe park/restore/timer/eligibility within five seconds without reload; keyboard, draft/focus and accessible state work. | Measured `tests/e2e/parking-lot.spec.ts` plus separate hosted observation. |
| PL8 | Offline/conflicts/ambiguous saves retain drafts without automatic replay; access loss clears protected content. | Browser failure injection and authorization assertions. |
| PL9 | Migration and exact archive recovery preserve old data and park/restore/attempt history, including after an actual app-process restart. | Migration comparison and extended recovery script. |
| PL10 | Existing unparked behavior, all active regressions, strict CI/scans and explicit release/acceptance boundaries remain enforced. | Full local aggregate and separate release-readiness evidence. |

## Gate A review

- Park waiting topic B: it remains in final vote results and enters the lot with
  its reason, but the next eligible start skips it. No timer for B is invented.
- Park current A at 3:20: its attempt ends Deferred with 3:20 retained. Nobody
  starts automatically. Restoring A does not resume it; its next explicit start
  grants a new 5:00, with the old attempt still visible.
- Restore an earlier-ranked topic while C is current: C continues. The restored
  topic may become next by original rank after C finishes or is parked.
- All remaining topics parked is not All discussed. Close retains those deferred
  outcomes; there is no automatic new-session copy or restoring after closure.

The owner selected "Approve Gate A" on 2026-10-28 after reviewing these rules
and examples. The approved technical design is in `design/parking-lot.md`.
The owner subsequently approved Gate B on the same date. Execution and evidence
are tracked in `tasks/parking-lot.md`; approvals are not passing test evidence.
