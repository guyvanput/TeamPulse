"use client";

import type { SessionSnapshot } from "@/lib/session-snapshot";
type Save = (command: "move-agenda-topic", input: Record<string, unknown>) => Promise<boolean>;

export function AgendaOrderControls({ data, enabled, save, retainControls = false }: { data: SessionSnapshot; enabled: boolean; save: Save; retainControls?: boolean }) {
  if (data.voting.state !== "FINALIZED") return null;
  const topics = new Map(data.topics.map(item => [item.id, item.title]));
  const future = new Map(data.agendaOrder.future.map(item => [item.topicId, item]));
  const names = (ids: string[]) => ids.map(id => topics.get(id)).join(" -> ");
  const writable = enabled && data.facilitatorView && data.state !== "CLOSED";
  return <section className="card" aria-label="Discussion queue"><h2>Discussion queue</h2>
    <p>Original vote results stay unchanged. Parked topics keep their planned slots but are skipped until restored. Moving the future queue never interrupts a current timebox.</p>
    {(data.facilitatorView || retainControls) && <div aria-label="Agenda order controls">{data.voting.agenda.map(entry => {
      const item = future.get(entry.topicId);
      return <div key={entry.topicId}>
        <p>{topics.get(entry.topicId)}</p>
        <button aria-disabled={!writable || !item?.canMoveEarlier} onClick={() => { if (writable && item?.canMoveEarlier && item.earlierTopicId) void save("move-agenda-topic", {
          topicId: item.topicId, neighborTopicId: item.earlierTopicId, direction: "earlier", version: data.lifecycleVersion
        }); }}>Move {topics.get(entry.topicId)} earlier</button>{" "}
        <button aria-disabled={!writable || !item?.canMoveLater} onClick={() => { if (writable && item?.canMoveLater && item.laterTopicId) void save("move-agenda-topic", {
          topicId: item.topicId, neighborTopicId: item.laterTopicId, direction: "later", version: data.lifecycleVersion
        }); }}>Move {topics.get(entry.topicId)} later</button>
      </div>;
    })}</div>}
    {data.agendaOrder.future.length > 0 ? <ol aria-label="Future discussion queue">{data.agendaOrder.future.map(item =>
      <li key={item.topicId}>{topics.get(item.topicId)} / Plan slot: {item.discussionPosition} / Original vote rank: {item.originalPosition} / Votes: {item.count}{item.parked ? " / Parked" : ""}</li>
    )}</ol> : <p>No future topics.</p>}
    {data.agendaOrder.history.length > 0 ? <ol aria-label="Agenda order history">{data.agendaOrder.history.map(item =>
      <li key={item.version}>Moved {topics.get(item.topicId)} {item.direction === "EARLIER" ? "earlier" : "later"}: {item.createdAt} by {item.actor.name}
        <p>Before: {names(item.beforeQueue)}</p><p>After: {names(item.afterQueue)}</p>
      </li>)}</ol> : <p>No manual agenda changes.</p>}
  </section>;
}
