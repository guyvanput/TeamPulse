# Timed topic discussion: fourth delivery slice

Status: Gate A and Gate B approved by the owner on 2026-10-28.
Date: 2026-10-28.
Source: `docs/prd.md`, Release 1 session timer management.
Dependencies: facilitated sessions and the approved voting/final-agenda behavior.
Voting is locally implemented and verified, not published or accepted.

## User outcome and boundary

After finalizing voting, a facilitator runs a timed discussion of each topic in
the saved priority order. Everyone can see the current topic and countdown.
The facilitator pauses, resumes, extends or explicitly finishes that discussion,
then starts the next topic. Existing action capture and later follow-up remain
available.

The owner selected "Approve Gate A" after reviewing this document and its meeting
rules on 2026-10-28. This does not declare the voting slice released or the full
Lean Coffee MVP complete.
No new production behavior starts before both Gate A and Gate B are approved.

## Approved product decisions

| Decision | Approved rule |
|---|---|
| Starting point | Facilitated, nonclosed session with Finalized voting and a saved agenda. Only the current joined facilitator can administer discussion. |
| Topic order | Start the first not-yet-discussed topic in saved rank order. One current topic per session; starting another requires finishing the current one. |
| Initial timebox | Five minutes for each topic. No custom duration setting in this slice. |
| Pause/resume | Pause preserves the confirmed remaining time; resume continues that time rather than granting another five minutes. |
| Extension | Add two minutes per explicit facilitator command. Repeated extensions are allowed; no participant continuation vote or business cap on the number of extensions. |
| Expiry | Display zero and Time expired. Do not advance, finish the topic, close the session or start a new countdown automatically. |
| After expiry | Facilitator can extend to two minutes from the confirmed extension time, or finish the topic. No negative countdown or hidden carry-over of elapsed overtime. |
| Completion | Confirm Finish topic to mark it Discussed and stop its timer. Starting the next topic is a separate explicit action. Finished topics cannot restart in this slice. |
| Closure | Finish any current discussion before closing. Closing with remaining unstarted topics is allowed; they remain Not discussed, never silently completed. |
| Explicit exclusions | Parking/defer/skip, manual reorder, custom durations, participant continuation voting, audible alarms, notifications, automatic actions, meeting summaries and facilitator transfer. |

Gate A approved the fixed five-minute/two-minute policy, single ordered pass,
expiry and closure behavior.
Parking lots and manual agenda reordering remain separate requirements; there is
no hidden skip operation masquerading as finishing a discussion.

## Permissions and retained boundaries

- Every read and command checks authenticated identity and current team
  membership on the server, including queued commands after revocation.
- Same-team readers may see current discussion, countdown and retained outcomes
  without joining. Joining does not grant team membership.
- Joined participants can read and use existing authorized action/review
  capabilities, but cannot start, pause, resume, extend or finish discussion.
- Only the recorded, currently joined facilitator administers the timer. Forged
  identities, cross-team/session/topic IDs and stale role assumptions fail
  explicitly without changing protected data.
- Revocation stops access and commands, not history. Restoring membership does
  not reset discussion progress or time. No additional facilitator or transfer
  operation is introduced.
- Legacy sessions, pre-voting sessions and Open voting have no usable discussion
  controls. Closed sessions are read-only.
- Topic content, vote counts and saved priority ranks stay frozen. Discussion
  progress is separate from voting results and does not recalculate them.

## Discussion and timer rules

1. Before discussion starts, all saved agenda topics are Not discussed.
   Starting discussion chooses the first such topic in rank order and begins its
   five-minute timebox. It never silently finalizes voting.
2. With a current topic, display its title, rank, discussion state and timer.
   The other agenda topics retain their own Not discussed or Discussed labels.
   The final vote-based agenda remains readable and unchanged.
3. While running, countdown is based on server-confirmed time, not the number
   of browser ticks, open tabs or connected participants. At the deadline the
   authoritative remaining time is zero even if no browser was connected.
4. Pause before expiry preserves remaining time without rounding up to a fresh
   minute. Resume is valid only for a paused topic with positive remaining time.
   Pause/resume after expiry fails visibly with extend-or-finish guidance.
5. Extending a running countdown adds two minutes to its current deadline.
   Extending a paused countdown adds two minutes but leaves it paused.
   Extending an expired countdown starts a two-minute countdown from the
   successful extension time. A finished topic cannot be extended.
6. Finishing is allowed while running, paused or expired, with confirmation that
   the topic will be marked Discussed and cannot restart in this slice.
   It stops the timer and preserves the topic's outcome. It does not claim that
   an action was created, the topic resolved or participants agreed.
7. With no remaining topic, show All agenda topics discussed and no Start next
   control. Do not restart the first topic, reopen voting or close automatically.
8. While a current topic exists, Close session fails with finish-discussion
   guidance, including after expiry. Finishing and closing remain separate
   confirmed operations. With no current topic, accepted closure behavior stays
   available even if some topics are still Not discussed.
9. Keep per-topic start/finish time, facilitator attribution, total allocated time
   including extensions, and discussion outcome in protected session history.
   A per-second history or full audit trail of every pause is not required.
10. Reload, a second device, browser suspension, application restart and backup
    recovery preserve progress. Running time continues during downtime; paused
    remaining time does not. Expired time stays at zero until extend or finish.

## Concurrency, uncertainty and failures

- Two simultaneous start commands must not create two current topics. Duplicate
  or stale finish/extension/resume requests cannot move to another topic,
  add time twice or undo a newer change. Report conflicts, not false success.
  The exact revision/retry protocol belongs in Gate B.
- Operations validate the current discussion, membership and session state when
  committing. Pause versus extension, finish versus extension, and close versus
  start races preserve one coherent authorized result, with no partial state.
- A response lost after commit must be reconciled before another command.
  Never automatically replay an ambiguous extension or advance command.
- Invalid identifiers/commands and representational limits fail visibly without
  partial progress. The server, not a client-provided remaining value or deadline,
  controls elapsed time and expiry.
- Wrong device wall-clock time cannot authorize extra time or finish a topic.
  Gate B must define countdown synchronization and how stale timing is labeled.
- Offline/unavailable reads clearly label the last confirmed state and disable
  writes until a fresh authorized snapshot. Do not present an unconfirmed local
  countdown as current shared truth. Retain unsaved topic/action/review drafts;
  clear protected content and drafts on access loss.

## Shared experience and accessibility

- Two visible online user contexts see confirmed current-topic, pause/resume,
  extension and completion changes within five seconds under normal connectivity,
  without manual refresh. Joining mid-discussion shows current state, not a new
  five-minute timer.
- A visible healthy countdown updates locally at least once per second and stops
  at zero. Browser throttling or returning from a hidden tab reconciles elapsed
  time rather than replaying missed ticks. No server write per tick is required.
- Use keyboard-operable, clearly named controls and labeled Running, Paused,
  Time expired and Discussed states. Make current topic and time readable without
  relying on color.
- Announce meaningful state changes and expiry accessibly, not every second.
  Reconciliation does not steal focus or reset action/review drafts.
- No sound, browser notification, background delivery guarantee or meeting
  attendance/speaking analytics is introduced.

## Compatibility, verification and delivery

- Additive persistence initializes existing sessions with no fabricated
  discussion history. Preserve all original columns/rows, ballots, stored ranks,
  topic/removal attribution, participant roles and action/review history.
- Existing AC/TC/VP and active BugMagnet regressions remain required. The only
  intended change to approved closure is the current-discussion guard above.
- Extend isolated migration comparison, deterministic clock/time arithmetic,
  coordinated database race, distinct-user browser and recovered-app restart
  evidence. Tests must verify exact remaining/deadline behavior, not merely that
  some timer text appears.
- Keep strict CI/scans and distinct-user hosted acceptance. Fixtures are not real
  OAuth or deployed latency evidence. No synthetic auth in production.
- Gate B must cover server-authoritative timing, atomic transitions, revisions,
  compatible snapshots, restart/recovery and safe rollout/rollback. This document
  does not prescribe tables, API protocols or a background-job service.
- Commit, push, production migration/deployment and human pilot acceptance remain
  separate permissions/evidence boundaries; Gate A/B do not waive them.

## Approved acceptance criteria and harness

The test paths below are implemented; actual execution and pending hosted/release
evidence are recorded in `tasks/timed-topic-discussion.md`. The acceptance mapping
and Gate A/B approvals do not themselves prove release readiness.

| ID | Testable criterion | Harness |
|---|---|---|
| TD1 | Only a current joined facilitator starts from a nonclosed finalized agenda; selects the first remaining topic, grants exactly five minutes and permits only one current discussion. | `tests/integration/discussion.test.ts`; browser start/denial checks. |
| TD2 | Server-authoritative countdown, exact pause/resume and running/paused/expired two-minute extension follow the rules above, including wrong device clock and elapsed downtime. | Deterministic `tests/unit/discussion.test.ts`; database transitions and browser countdown. |
| TD3 | Expiry displays zero without implicit progress or closure; confirmed finish records Discussed, never auto-starts, and completed topics cannot restart. | Unit/integration boundaries and `tests/e2e/discussion.spec.ts`. |
| TD4 | Concurrent/stale/repeated start, pause, extend, finish and close cannot double-add time, produce two current topics, skip ranks or commit partial state. | Coordinated PostgreSQL race/revocation cases and lost-response browser reconciliation. |
| TD5 | Current discussion blocks closure; no-current closure preserves unstarted topics as Not discussed. Voting ranks/counts and existing actions/reviews remain intact. | Integration lifecycle/history checks and existing AC/TC/VP suites. |
| TD6 | Two distinct visible user contexts observe each confirmed transition within five seconds without reload; late joining, drafts/focus and keyboard controls work. | Measured browser journey, followed by separate hosted acceptance. |
| TD7 | Offline/stale/failed commands retain drafts and disable writes until reconciliation; access loss clears protected content; participant/foreign/anonymous commands cannot administer discussion. | Integration authorization and browser failure-injection tests. |
| TD8 | Migration preserves existing data; running/paused/finished state and history survive reload, actual application restart and an independent archive restore. | Migration comparison and extended `scripts/verify-recovery.ts`. |
| TD9 | Existing regression suites, strict build/scans and release/recovery boundaries remain enforced; unexecuted release checks stay pending. | Local aggregate gate, CI and release-readiness evidence. |

## Gate A review

Verify these examples against the intended meeting:

- The first ranked topic starts with 5:00. Pause at 3:20 and resume later: it
  continues from 3:20. Extend while paused: it stays paused at 5:20.
- A running topic expires while everyone is disconnected. Rejoining shows 0:00
  and Time expired, still on that topic. Extend grants a fresh 2:00; it does not
  count time from a deadline already in the past.
- Confirm Finish topic to mark it Discussed. The next topic remains stopped
  until Start next topic. After every topic is discussed there is no restart.
- To close early, finish the current topic, then close; remaining topics stay
  Not discussed. Parking, skipping and manual order changes are not yet provided.

Gate A is approved. The approved technical design is in
`design/timed-topic-discussion.md`; Gate B was approved on 2026-10-28.
Implementation and verification are tracked in `tasks/timed-topic-discussion.md`.
