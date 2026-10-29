"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  historyPageSchema, lifecycleLabels, type HistoryFilter, type HistoryPage, type HistoryRow
} from "@/lib/session-history";

export type HistoryRequest = { filter: HistoryFilter; cursor: string | null };
export type HistoryLoader = (teamId: string, request: HistoryRequest) => Promise<HistoryPage>;

const filters: { value: HistoryFilter; label: string }[] = [
  { value: "ALL", label: "All" }, { value: "IN_PROGRESS", label: "In progress" }, { value: "CLOSED", label: "Closed" }
];
const emptyText: Record<HistoryFilter, string> = {
  ALL: "No sessions yet. Start your first one.", IN_PROGRESS: "No sessions in progress.", CLOSED: "No closed sessions yet."
};

export const fetchHistory: HistoryLoader = async (teamId, request) => {
  const query = new URLSearchParams({ filter: request.filter });
  if (request.cursor) query.set("cursor", request.cursor);
  const response = await fetch(`/api/teams/${encodeURIComponent(teamId)}/history?${query}`, { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) throw new Error("History unavailable.");
  return historyPageSchema.parse(await response.json());
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function Details({ row }: { row: HistoryRow }) {
  const parts = [row.createdAt.slice(0, 10), lifecycleLabels[row.lifecycle]];
  if (row.facilitatorName !== null) parts.push(`Facilitator: ${row.facilitatorName}`);
  if (row.topicCount !== null) parts.push(plural(row.topicCount, "topic"));
  parts.push(plural(row.openActionCount, "open action"));
  if (row.summaryAvailable !== null) parts.push(row.summaryAvailable ? "Summary available" : "No summary yet");
  return <small>{parts.join(" / ")}</small>;
}

export function SessionHistory({ teamId, initial, load = fetchHistory }: { teamId: string; initial: HistoryPage; load?: HistoryLoader }) {
  const [applied, setApplied] = useState(initial);
  const [busy, setBusy] = useState<HistoryRequest | null>(null);
  const [failed, setFailed] = useState<HistoryRequest | null>(null);
  const token = useRef(0);
  const appliedRef = useRef(applied);
  useEffect(() => { appliedRef.current = applied; }, [applied]);
  const focusId = useRef<string | null>(null);
  const links = useRef(new Map<string, HTMLAnchorElement>());

  useEffect(() => () => { token.current += 1; }, []);
  useEffect(() => {
    const id = focusId.current;
    if (id) { focusId.current = null; links.current.get(id)?.focus(); }
  }, [applied]);

  async function run(request: HistoryRequest) {
    const mine = ++token.current;
    setBusy(request);
    setFailed(null);
    try {
      const next = await load(teamId, request);
      const checked = historyPageSchema.parse(next);
      if (checked.filter !== request.filter) throw new Error("Unexpected history filter.");
      if (mine !== token.current) return;
      const current = appliedRef.current;
      if (request.cursor === null) { setApplied(checked); return; }
      const known = new Set(current.rows.map((row) => row.id));
      const added = checked.rows.filter((row) => !known.has(row.id));
      focusId.current = added[0]?.id ?? null;
      setApplied({ filter: checked.filter, rows: [...current.rows, ...added], nextCursor: checked.nextCursor });
    } catch {
      if (mine === token.current) setFailed(request);
    } finally {
      if (mine === token.current) setBusy(null);
    }
  }

  return <div className="history">
    <fieldset className="history-filter">
      <legend>Filter sessions</legend>
      {filters.map(({ value, label }) => <label key={value}>
        <input type="radio" name={`history-filter-${teamId}`} checked={applied.filter === value}
          onChange={() => { if (value !== applied.filter || busy) void run({ filter: value, cursor: null }); }} /> {label}
      </label>)}
    </fieldset>
    <p className="muted" role="status">{busy ? "Loading sessions…" : "Counts are as of the last load."}</p>
    {failed && <div role="alert" className="error">
      {failed.cursor === null && failed.filter !== applied.filter
        ? "Could not load that filter. Showing the previous list."
        : "Could not load more sessions. Your loaded sessions are still shown."}{" "}
      <button type="button" onClick={() => void run(failed)}>Retry</button>
    </div>}
    {applied.rows.length ? <ul className="session-list">
      {applied.rows.map((row) => <li key={row.id}>
        <Link href={`/sessions/${row.id}`} ref={(node) => { if (node) links.current.set(row.id, node); else links.current.delete(row.id); }}>{row.title}</Link>
        <Details row={row} />
      </li>)}
    </ul> : <p>{emptyText[applied.filter]}</p>}
    {applied.nextCursor && <button type="button" aria-disabled={busy ? "true" : undefined}
      onClick={() => { if (!busy && applied.nextCursor) void run({ filter: applied.filter, cursor: applied.nextCursor }); }}>
      Load more sessions
    </button>}
  </div>;
}
