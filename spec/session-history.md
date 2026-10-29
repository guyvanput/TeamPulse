# Session history: ninth delivery slice

Status: Gate A approved by the owner on 2026-10-28 with the proposed defaults (page size 20, lifecycle filter only, this session's open actions). Gate B design pending.
Date: 2026-10-28.
Source: `docs/prd.md`, Release 1 "Session history".
Dependencies: facilitated sessions, voting, discussion, parking, manual order, meeting summary and session administration (all local-only until published and accepted).

## Gap found

The Release 1 audit shows every other included capability has a slice. Session history is only the home-page list: title, creation date and kind, unbounded, with no lifecycle, role or outcome signal. A team cannot tell which sessions are live, closed or summarized, and a long history is one unpaginated list.

## User outcome

A team member can find a past or current session quickly and see, without opening it, where it stands and what came out of it.

## Proposed product decisions for Gate A

| Decision | Proposed rule |
|---|---|
| Scope of rows | Sessions of teams where the viewer is currently a member. Former membership gives no access. |
| Row content | Title, date, kind, lifecycle (Collecting, Voting, Discussing, Closed, or Action follow-up), facilitator name, active-topic count, and open-action count. |
| Summary signal | Closed facilitated sessions show Summary available or No summary yet. No report content appears in the list. |
| Order | Newest first, stable tie-break by id (unchanged). |
| Size | Page of 20 per team with an explicit Load more. Page boundaries never skip or repeat a row when sessions are added concurrently (keyset pagination). |
| Filter | Lifecycle filter only: All, In progress, Closed. No free-text search, date ranges or cross-team views. |
| Counts | Derived on the server in a single bounded query; no new stored columns and no migration. |
| Removed participants | A removed participant who is still a team member sees the same history rows. Removal limits contribution, not reading. |
| Failure | Failed page loads keep the already-loaded rows and offer Retry. Empty states are explicit per filter. |
| Exclusions | Analytics, trends, exports, public links, search, sorting options, deleting or archiving sessions, and cross-session comparison (all Release 2+). |

## Acceptance criteria

- SH1: a member sees lifecycle, facilitator, topic and open-action counts for every listed session.
- SH2: a non-member and a former member see no rows and cannot infer sessions through counts or errors.
- SH3: pagination returns 20 rows, Load more continues without gaps or duplicates when a session is created between pages.
- SH4: the filter returns only matching lifecycle rows and preserves paging.
- SH5: Summary available appears only for a closed session with a saved report; no report text is exposed.
- SH6: a failed page load preserves loaded rows and Retry recovers.
- SH7: legacy action-only sessions list correctly with no facilitator or topic counts.
- SH8: no write path is added; no schema migration; the existing 19-table recovery drill is unchanged.

## Questions for the owner

1. Is the page size of 20 acceptable?
2. Is the lifecycle filter enough, or should text search be included now?
3. Should open-action count include only this session's actions, or the team's?
   Proposed: this session's actions only.

## Release boundary

Local verification only. Nothing is committed, published or deployed by this document. Gate B must define the query, index needs (if any), and the exact consistency boundary of counts.
