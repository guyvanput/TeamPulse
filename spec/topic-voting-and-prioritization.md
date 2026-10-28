# Topic voting and automatic prioritization: third delivery slice

Status: Gate A and Gate B approved by the owner on 2026-10-28.
Date: 2026-10-28.
Source: `docs/prd.md`, Release 1 topic voting and automatic prioritization.
Baseline: accepted facilitated topic collection at `d22256b`, recorded in
[readiness issue #2](https://github.com/guyvanput/TeamPulse/issues/2).

## User outcome

After collecting topics, the facilitator opens voting. Joined team members
choose the topics they want to discuss. The facilitator ends voting and obtains
a deterministic, persisted agenda ordered by votes. This is prioritization,
not discussion execution or completion of the Lean Coffee MVP.

The owner selected "Approve Gate A" on 2026-10-28 after reviewing this document
and its focused decision checklist. The rules below are the approved requirements.
Gate A does not approve the technical design or authorize implementation before
Gate B. Gate B is now recorded in `design/topic-voting-and-prioritization.md`;
implementation and verification are in `tasks/topic-voting-and-prioritization.md`.

## Approved product decisions

| Decision | Approved rule |
|---|---|
| Vote budget | Three votes per joined person per session; using every vote is optional. |
| Distribution | At most one vote per person per topic; voting for one's own topic is allowed. |
| Participants | Facilitator votes on the same terms; same-team readers must join first. Joining remains allowed while voting is open. |
| Voting lifecycle | One round: Not started -> Open -> Finalized. No restart, reset or second round in this slice. |
| Collection boundary | Start voting only from Collection paused with at least one active topic. Freeze topics while voting is Open and after it is Finalized. |
| Visibility | Same-team readers see aggregate counts and live provisional order; a viewer sees their own selections/budget, not other people's ballots. |
| Completion | Facilitator may finish before everyone votes, even if nobody votes. Explicit confirmation warns that voting cannot reopen. |
| Ranking | Vote count descending, then topic creation time ascending, then stable topic identity ascending. Include zero-vote topics. |
| Session closure | During Open voting, finish voting before closing. Closing before voting starts remains available. Finalized agenda is retained after closure. |
| Scope limits | No configurable budgets, multiple rounds, ballot secrecy guarantee, manual reordering, timers or discussion-status workflow. |

These significant product choices were accepted at Gate A.
In particular, one round and permanent topic freeze are intentional limits,
not a claim that the full Lean Coffee facilitation workflow is finished.

## Eligibility and permissions

- Every read and mutation checks the authenticated identity and current team
  membership on the server. Team membership is not granted by joining.
- A same-team reader can view topics, voting state, counts and agenda without
  joining. They cannot vote or administer voting.
- A joined participant can add/remove only their own votes while voting is Open.
  The facilitator has the same budget, plus voting lifecycle controls.
- Only the recorded facilitator can start or finalize voting. A participant
  cannot submit another person's identity or use a retained role after membership
  removal. No facilitator transfer or additional facilitator is introduced.
- Joining during Open voting is explicit, creates one roster entry, and gives
  the newly joined person the same three-vote maximum. Joining after Finalized
  remains allowed while the session is not Closed, but grants no ballot changes.
- Retained votes remain counted if a voter loses current team membership. They
  represent contributions made while authorized; revocation blocks future access
  and changes, not historical erasure. Restoring the same user's membership
  restores access to their existing selections, never a new three-vote budget.
- Voter identity stays in protected persistence for integrity/history, but is not
  exposed as another person's ballot in pages or snapshot responses. This is
  not secret-ballot voting: small counts and live changes can reveal preferences
  by inference. No anonymity or election-grade privacy is promised.

## Lifecycle and collection interaction

Collection state and voting state are distinct. Existing Collecting,
Collection paused and Closed labels remain; display voting state separately.

| Collection / voting state | Allowed controls and contributions |
|---|---|
| Collecting / Not started | Existing topic, join and action behavior; pause or close as before. Start voting is unavailable. |
| Paused / Not started | Join and capture/review actions; resume collection, start voting, or close. Start needs at least one nonremoved topic. |
| Paused / Open | Join, vote/unvote and capture/review actions; facilitator can finalize. No topic changes, collection resume or session close. |
| Paused / Finalized | Read final agenda, join and capture/review actions; facilitator can close. No ballots, topic changes, collection resume or new voting round. |
| Closed | All through-session mutations rejected; recorded topics, voting state, totals and any final agenda remain readable. |

- Start requires confirmation explaining the topic freeze and one-round limit.
  It does not silently pause Collecting or discard an unsaved topic draft.
- All nonremoved topics at the successful start are eligible; removed history
  stays visible separately and can never receive votes or an agenda position.
- A start request with no eligible topics fails visibly and leaves Not started.
- The server checks authorization and state when saving. An edit/remove versus
  start race cannot change the voting topic set after the start has committed.
  Starting from paused collection requires reconciliation of any older draft.
- Finalize requires confirmation explaining that later votes cannot be added.
  There is no timer, automatic finish, quorum, attendance requirement or
  requirement that participants spend all votes.
- A vote racing finalization either commits first and contributes to the final
  result, or is rejected as closed voting with no partial changes. The final
  agenda and Finalized state become visible together.
- Duplicate/stale lifecycle requests must not create another round, reopen
  voting, overwrite a later state or silently change the final agenda. Report
  conflicts visibly; do not present a stale operation as a new successful change.
- A close attempt during Open voting fails visibly with "finish voting first"
  guidance. Finishing voting is a separate, confirmed operation, not a hidden
  side effect of Close.

## Ballots and budget

- Every eligible person can select zero to three distinct active topics.
  With one or two eligible topics, the remaining votes stay unused; there is no
  requirement to distribute all three or permission to stack votes on one topic.
- Selecting an unselected topic spends one vote. Removing one's selection
  returns one vote immediately after server confirmation.
- At the budget limit, an additional selection fails visibly without changing
  votes or totals. Explain how to remove a selection to choose another topic.
- Different people can vote for the same topic. The total is the count of valid
  stored selections, not a client-supplied count or participant roster length.
- Repeated submissions/retries must not create duplicate votes or spend another
  vote. Stale commands must not undo newer selections or use an old budget to
  exceed the cap. The exact command/version protocol belongs in Gate B.
- Concurrent selections for different topics at the last available budget slot
  must not exceed three. Concurrent changes by different voters must not lose
  contributions. No optimistic "saved" count is shown before confirmation.
- Wrong-team, wrong-session, nonexistent and removed topic identifiers fail
  without altering the ballot. Legacy sessions reject voting commands.
- Capture/review actions remain available through an authorized joined person's
  nonclosed facilitated session, including during Open and Finalized voting.
  Source-session closure and later follow-up keep the accepted behavior.

## Provisional and final agenda

- During Open voting show live totals and a clearly labeled provisional agenda.
  Its ordering is not final and may change with each confirmed selection.
- Order topics by votes descending; break ties by original creation time
  ascending, then stable topic ID ascending. Editing a topic before voting
  starts does not change its creation time or tie-break position.
- Finalization records the complete ordered agenda with one-based contiguous
  positions and final counts. Include every eligible topic exactly once,
  including zero-vote topics; exclude removed topics.
- With no votes, use the same creation-time/identity tie-breaker, not random order,
  a blank agenda, or an unexplained failure.
- Finalized ranks/counts survive reload, application restart and backup recovery.
  Membership changes and joins cannot recalculate or silently reorder that result.
- Preserve topic title, description and author in the retained session. Full
  edit history, export and generated meeting summary are not in this slice.
- Final priority is a proposed discussion order only. It does not mark topics
  discussed, start timers, create actions, park topics or complete the meeting.

## Shared updates, drafts and failures

- Retain the five-second saved-change visibility requirement for active visible
  online pages under normal connectivity. Extend it to voting state, own ballot/
  remaining budget, aggregate counts and provisional/final agenda.
- Background agenda reordering must preserve topic/action/review drafts and
  keyboard focus. A topic that moves position retains stable identity. A draft
  blocked by voting's topic freeze remains visible with an explanation.
- Show pending/success/conflict/failure states accessibly. Failed or ambiguous
  saves retain confirmed counts and require current-state reconciliation before
  retry; do not silently replay a possibly committed toggle.
- Continue explicit stale/offline states, disabled writes until a fresh authorized
  snapshot, retry, and protected-content/draft clearing on access loss.
- Use keyboard-operable controls with topic-specific accessible names, selected
  state and remaining budget. Announce lifecycle/budget/error changes without
  background focus theft or a screen-reader announcement for every poll.

## Compatibility, verification and release boundaries

- Existing facilitated sessions initialize voting as Not started with no votes
  or agenda, retaining current collection/closure, roster, topics and actions.
  Do not auto-start voting or reopen an already Closed session.
- Existing legacy sessions remain action-follow-up sessions with no fabricated
  voting workflow or facilitator.
- Migration must preserve every existing column/row, topic/removal attribution,
  versions, session roles, action status and review history.
- Preserve AC1-AC10, TC1-TC12 and active BugMagnet regressions. Add focused
  requirements-mapped tests and extend migration/restart/recovery evidence.
- The previous TC6 resume/close behavior is deliberately narrowed only once
  voting starts. Existing Not started sessions retain accepted behavior.
- Keep strict CI/scans and actual hosted distinct-user verification. Synthetic
  fixtures and test auth sessions stay isolated, never bypass production OAuth.
- Production rollout needs backup, migration compatibility and verified deployment
  evidence. Older binaries do not enforce voting locks; Gate B must define safe
  rollback/roll-forward before publication. Green CI alone is not acceptance.

## Acceptance criteria and harness

The test paths below are implemented. Actual execution results and remaining
hosted/release checks are recorded in `tasks/topic-voting-and-prioritization.md`;
neither this mapping nor Gate A/B approval is evidence that a check passed.

| ID | Testable criterion | Planned test path / suite |
|---|---|---|
| VP1 | Only a current joined facilitator starts voting from paused, nonclosed collection with at least one active topic; invalid starts change nothing. Start confirmation explains permanent topic freeze. | `tests/integration/voting.test.ts`; `tests/e2e/voting.spec.ts` |
| VP2 | A current joined member, including facilitator and a late joiner, may select up to three distinct topics, including their own; unselect returns budget. Same-team readers must join first. | `tests/unit/voting.test.ts`; `tests/integration/voting.test.ts`; `tests/e2e/voting.spec.ts` |
| VP3 | Duplicate/retried/stale commands cannot double-count, exceed budget or overwrite newer selections. Wrong-session/removed topics and forged identities cannot grant access. | `tests/integration/voting.test.ts` |
| VP4 | Concurrent last-slot selections, different-voter updates, start/topic writes and vote/finalize preserve budget, exact counts and committed topic set with explicit conflicts. | Coordinated PostgreSQL cases in `tests/integration/voting.test.ts` |
| VP5 | Only the facilitator can finalize, with confirmation; zero/partial voting is allowed. Open blocks close/resume; Finalized blocks ballots/topic writes/resume/restart; Closed blocks all mutations. Action follow-up stays available as specified. | `tests/unit/voting.test.ts`; `tests/integration/voting.test.ts`; `tests/e2e/voting.spec.ts` |
| VP6 | Provisional and final agenda order is count descending, creation time ascending, ID ascending; identical titles, equal timestamps and all-zero totals are deterministic. Every eligible topic has one contiguous final rank. | `tests/unit/voting.test.ts`; `tests/integration/voting.test.ts` |
| VP7 | Views/snapshots expose totals and only the viewer's selections, not other voters' ballots. Revoked membership blocks access/changes without erasing counts; rejoining cannot reset budget. | `tests/integration/voting.test.ts`; `tests/e2e/voting.spec.ts` |
| VP8 | Two real distinct-user contexts see confirmed vote/count/state/agenda changes within five seconds on visible online pages, without manual refresh; draft/focus identity survives ordering changes. | Measured `tests/e2e/voting.spec.ts`, plus separate hosted observation |
| VP9 | Offline, failed/ambiguous saves, stale controls and expiry show explicit accessible states without false success, lost drafts, automatic replay or protected content retention. | Failure-injection `tests/e2e/voting.spec.ts` |
| VP10 | Migration preserves every original column/row and initializes only Not started; Closed/legacy sessions stay unchanged. Reload/restart and isolated archive recovery preserve ballots, counts and final ranks. | `tests/integration/voting-migration.test.ts`; restart browser check; `scripts/verify-recovery.ts` |
| VP11 | Voting, remaining budget, confirmations and final agenda are labeled and keyboard usable; live reorder does not steal focus or reset drafts. | Accessible-role/keyboard checks in `tests/e2e/voting.spec.ts` |
| VP12 | Accepted action creation/reviews, topic collection before voting, legacy behavior, team/auth boundaries and strict delivery gates remain passing. | Existing AC/TC suites plus `npm run gate:merge`, CI/scans and hosted release evidence |

## Gate A review

Verify the decisions table, lifecycle matrix, late-join/revocation/privacy rules
and ranking example against how you want the team to work:

- Alice chooses A, B and C; a fourth selection is rejected. Unselecting B frees
  one vote. Alice cannot give A a second vote; Bob can also choose A.
- Counts A=2, B=1, C=1, D=0 produce A first, B/C by original creation time then
  ID, and D last. With all zero, the entire agenda uses that stable tie order.
- Starting from paused collection freezes topics; ending the one voting round
  freezes its final agenda. No reopening/reset is promised in this slice.
- A late joiner can vote during Open. A revoked member cannot change votes, but
  previously cast votes remain counted. Other members do not see named ballots.

Gate A is approved. Technical design and production implementation follow only
after their respective approvals.
