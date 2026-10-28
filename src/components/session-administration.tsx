"use client";

import { useState } from "react";
import type { SessionSnapshot } from "@/lib/session-snapshot";

type Command = "transfer-facilitator" | "remove-participant" | "readmit-participant";
type Confirmation = { command: Command; targetId: string; name: string; version: number; reason: string };
type Save = (command: Command, input: Record<string, unknown>) => Promise<boolean>;

export function SessionAdministration({ data, enabled, save }: {
  data: Pick<SessionSnapshot, "administration" | "facilitator" | "lifecycleVersion">; enabled: boolean; save: Save;
}) {
  const { administration } = data;
  const [shown, setShown] = useState(administration.canAdminister);
  if (administration.canAdminister && !shown) setShown(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const allowed = (command: Command, targetId: string) => {
    const target = administration.entries.find(entry => entry.id === targetId);
    return enabled && administration.canAdminister && Boolean(target && (command === "transfer-facilitator"
      ? target.canTransfer : command === "remove-participant" ? target.canRemove : target.canReadmit));
  };
  const choose = (command: Command, targetId: string, name: string) => {
    if (allowed(command, targetId)) setConfirmation({ command, targetId, name, version: data.lifecycleVersion, reason: drafts[targetId] ?? "" });
  };
  const fresh = confirmation !== null && confirmation.version === data.lifecycleVersion && allowed(confirmation.command, confirmation.targetId);
  return <section className="card" aria-label="Session administration"><h2>Session administration</h2>
    <p>Current facilitator: {data.facilitator.name}. Removal changes contribution rights, not team-wide read access.</p>
    {administration.viewerState === "REMOVED" && <p role="status">Your participation is suspended. Your drafts and previous votes remain; ask the current facilitator to readmit you. Same-team reading remains available.</p>}
    {shown && !administration.canAdminister && <p role="status">Facilitator controls and drafts retained read-only. You no longer have permission to administer this session.</p>}
    <ul aria-label="Joined participant history">{administration.entries.map(entry => <li key={entry.id}>
      <h3>{entry.name}</h3>
      <p>Joined: {entry.joinedAt} / {!entry.inTeam ? "No longer a team member" : entry.removedAt ? "Removed" : entry.id === data.facilitator.id ? "Facilitator" : "Active participant"}{entry.removedAt && ` / Removed: ${entry.removedAt}`}</p>
      {shown && <div>
        <label>Removal reason for {entry.name}<textarea maxLength={4000} value={drafts[entry.id] ?? ""}
          readOnly={!allowed("remove-participant", entry.id)}
          onChange={event => setDrafts(previous => ({ ...previous, [entry.id]: event.target.value }))} /></label>
        <button aria-disabled={!allowed("transfer-facilitator", entry.id)}
          onClick={() => choose("transfer-facilitator", entry.id, entry.name)}>Transfer facilitation to {entry.name}</button>{" "}
        <button aria-disabled={!allowed("remove-participant", entry.id)}
          onClick={() => choose("remove-participant", entry.id, entry.name)}>Remove {entry.name}</button>{" "}
        <button aria-disabled={!allowed("readmit-participant", entry.id)}
          onClick={() => choose("readmit-participant", entry.id, entry.name)}>Readmit {entry.name}</button>
      </div>}
    </li>)}</ul>
    {confirmation && <div role="group" aria-label="Confirm administration change">
      <p>{confirmation.command === "transfer-facilitator" ? `Transfer facilitation to ${confirmation.name} immediately? You become a participant and lose facilitator powers; no target acceptance is required.`
        : confirmation.command === "remove-participant" ? `Remove ${confirmation.name} from contributing? Their same-team read access and all previous contributions and votes remain. Only explicit facilitator readmission restores participation.`
          : `Readmit ${confirmation.name}? Restore participation with their original join history and used voting budget, without resetting votes.`}</p>
      {confirmation.command === "remove-participant" && <p>Reason: {confirmation.reason || "No reason provided"}</p>}
      <button aria-disabled={!fresh} onClick={async () => {
        if (!fresh) return;
        if (await save(confirmation.command, { targetId: confirmation.targetId, version: confirmation.version,
          ...(confirmation.command === "remove-participant" ? { reason: confirmation.reason } : {}) })) {
          if (confirmation.command === "remove-participant") setDrafts(previous => previous[confirmation.targetId] === confirmation.reason
            ? { ...previous, [confirmation.targetId]: "" } : previous);
          setConfirmation(null);
        }
      }}>{confirmation.command === "transfer-facilitator" ? `Confirm transfer to ${confirmation.name}`
          : confirmation.command === "remove-participant" ? `Confirm remove ${confirmation.name}` : `Confirm readmit ${confirmation.name}`}</button>
      <button onClick={() => setConfirmation(null)}>Cancel administration change</button>
      {!fresh && <p role="status">Session or permissions changed, or updates unavailable. Cancel and review the current participant state before confirming.</p>}
    </div>}
    {administration.history.length ? <ol aria-label="Administration history">{administration.history.map(event => <li key={event.version}>
      {event.kind === "TRANSFER" ? "Transferred facilitation" : event.kind === "REMOVE" ? "Removed participant" : "Readmitted participant"}: {event.actor.name} to {event.target.name} / {event.createdAt}
      {event.reason && <span> / Reason: {event.reason}</span>}
    </li>)}</ol> : <p>No administration changes.</p>}
  </section>;
}
