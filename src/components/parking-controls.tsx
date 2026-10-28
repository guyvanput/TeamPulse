"use client";

import { useState } from "react";
import type { SessionSnapshot } from "@/lib/session-snapshot";

type Save = (command: "park-topic" | "restore-topic", input: Record<string, unknown>) => Promise<boolean>;
type Confirmation = { topicId: string; version: number; command: "park-topic" | "restore-topic"; reason: string; attemptNumber: number | null };

export function ParkingControls({ data, enabled, save, retainControls = false }: { data: SessionSnapshot; enabled: boolean; save: Save; retainControls?: boolean }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  if (data.voting.state !== "FINALIZED") return null;
  const topics = new Map(data.topics.map(item => [item.id, item]));
  const ranks = new Map(data.voting.agenda.map(item => [item.topicId, item]));
  const parked = data.parking.entries.filter(item => item.parked);
  const stale = confirmation !== null && confirmation.version !== data.lifecycleVersion;
  const allowed = (topicId: string, command: Confirmation["command"]) => enabled && data.facilitatorView && data.state !== "CLOSED" &&
    Boolean(data.parking.entries.find(item => item.topicId === topicId)?.[command === "park-topic" ? "canPark" : "canRestore"]);
  const choose = (topicId: string, command: Confirmation["command"]) => { if (allowed(topicId, command)) setConfirmation({
    topicId, command, version: data.lifecycleVersion, reason: drafts[topicId] ?? "",
    attemptNumber: data.discussion.current?.topicId === topicId ? data.discussion.current.attemptNumber : null
  }); };
  return <section className="card" aria-label="Parking lot"><h2>Parking lot</h2>
    <p>Parked means Deferred, not Discussed. Restore returns eligibility at the saved planning slot (original vote rank unless manually reordered); the next explicit start gets a fresh five minutes.</p>
    {(data.facilitatorView || retainControls) && <div aria-label="Parking controls">
      {data.parking.entries.map(item => <div key={item.topicId}>
        <h3>{topics.get(item.topicId)?.title}</h3>
        <label>Parking reason for {topics.get(item.topicId)?.title}
          <textarea maxLength={4000} value={drafts[item.topicId] ?? ""}
            readOnly={!enabled || !data.facilitatorView}
            onChange={event => setDrafts(previous => ({ ...previous, [item.topicId]: event.target.value }))} />
        </label>
        <button aria-disabled={!allowed(item.topicId, "park-topic")} onClick={() => choose(item.topicId, "park-topic")}>Park {topics.get(item.topicId)?.title}</button>{" "}
        <button aria-disabled={!allowed(item.topicId, "restore-topic")} onClick={() => choose(item.topicId, "restore-topic")}>Restore {topics.get(item.topicId)?.title}</button>
      </div>)}
    </div>}
    {confirmation && <div role="group" aria-label="Confirm parking change">
      <p>{confirmation.command === "park-topic"
        ? confirmation.attemptNumber !== null
          ? "Stop this current timebox and defer the topic? Its exact remaining time stays in history. Restore does not resume it; the next explicit start gets a fresh five minutes."
          : "Defer this waiting topic? It stays in the final vote results but is skipped until restored. No timebox starts."
        : "Restore this topic at its saved planning slot? No current discussion is interrupted and no timer starts. Its next explicit start gets a fresh five minutes."}</p>
      <p>Topic: {topics.get(confirmation.topicId)?.title}</p>
      {confirmation.command === "park-topic" && <p>Reason: {confirmation.reason || "No reason provided"}</p>}
      <button aria-disabled={stale || !allowed(confirmation.topicId, confirmation.command)} onClick={async () => {
        if (stale || !allowed(confirmation.topicId, confirmation.command)) return;
        const input = { topicId: confirmation.topicId, version: confirmation.version,
          ...(confirmation.command === "park-topic" ? { reason: confirmation.reason } : {}) };
        if (await save(confirmation.command, input)) {
          if (confirmation.command === "park-topic") setDrafts(previous => previous[confirmation.topicId] === confirmation.reason ? { ...previous, [confirmation.topicId]: "" } : previous);
          setConfirmation(null);
        }
      }}>{confirmation.command === "park-topic" ? "Confirm park topic" : "Confirm restore topic"}</button>
      <button onClick={() => setConfirmation(null)}>Cancel parking change</button>
      {stale && <p role="status">Session changed. Cancel and review the current parking state.</p>}
    </div>}
    {parked.length === 0 ? <p>No parked topics.</p> : <ul aria-label="Parked topics">{parked.map(item => {
      const event = item.events.at(-1)!;
      const topic = topics.get(item.topicId);
      const rank = ranks.get(item.topicId);
      return <li key={item.topicId}><h3>{topic?.title}</h3><p>{topic?.description}</p>
        <p>Original rank: {rank?.position} / Votes: {rank?.count} / Parked</p>
        <p>{event.reason || "No reason provided"}</p><p>Parked: {event.createdAt} by {event.actor.name}</p>
      </li>;
    })}</ul>}
    <div aria-label="Parking history">{data.parking.entries.filter(item => item.events.length > 0).map(item =>
      <div key={item.topicId}><h3>Parking history: {topics.get(item.topicId)?.title}</h3>
        <ol aria-label={`Parking history for ${topics.get(item.topicId)?.title}`}>{item.events.map(event =>
          <li key={event.version}>{event.kind === "PARK" ? "Parked" : "Restored"}: {event.createdAt} by {event.actor.name}
            {event.reason && <span> / Reason: {event.reason}</span>}
            {event.attemptNumber !== null && <span> / Deferred attempt: {event.attemptNumber}</span>}
          </li>)}</ol>
      </div>)}</div>
  </section>;
}
