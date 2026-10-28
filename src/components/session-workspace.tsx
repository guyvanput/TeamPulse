"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { sessionCommand } from "@/app/actions";
import { snapshotSchema, type SessionSnapshot } from "@/lib/session-snapshot";
import { statusLabels } from "@/lib/rules";
import { DiscussionControls, type TimerAnchor } from "./discussion-controls";
import { ParkingControls } from "./parking-controls";
import { AgendaOrderControls } from "./agenda-order-controls";
import { MeetingSummary } from "./meeting-summary";
import { SessionAdministration } from "./session-administration";

type Topic = SessionSnapshot["topics"][number];
type Action = SessionSnapshot["priorActions"][number];
type Command = Parameters<typeof sessionCommand>[0];
type Save = (command: Command, input: Record<string, unknown>) => Promise<boolean>;

export function SessionWorkspace({ initial }: { initial: SessionSnapshot }) {
  const [confirmed, setConfirmed] = useState<{ data: SessionSnapshot; clock: TimerAnchor | null } | null>({ data: initial, clock: null });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [available, setAvailable] = useState(true);
  const [lastSuccess, setLastSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const denied = useRef(false);
  const mutating = useRef(false);
  const invalidate = useCallback(() => {
    generation.current++;
    request.current?.abort();
    request.current = null;
  }, []);
  const clearAccess = useCallback(() => {
    denied.current = true;
    request.current?.abort();
    setConfirmed(null);
    setAvailable(false);
    setError("Sign in again or ask the operator to check your team access.");
    setNotice("");
  }, []);

  const refresh = useCallback(async (force = false) => {
    if (denied.current || mutating.current || (!force && request.current)) return;
    if (document.visibilityState === "hidden" || !navigator.onLine) { setAvailable(false); return; }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const current = ++generation.current;
    const timer = setTimeout(() => controller.abort(), 2000);
    const started = performance.now();
    try {
      const response = await fetch(`/api/sessions/${initial.id}/snapshot`, { cache: "no-store", signal: controller.signal });
      if (current !== generation.current) return;
      if (response.status === 401 || response.status === 404) { clearAccess(); return; }
      if (!response.ok) throw new Error("Updates unavailable.");
      const next = snapshotSchema.parse(await response.json());
      if (current !== generation.current) return;
      const receivedAt = performance.now();
      setConfirmed({ data: next, clock: { receivedAt, transitMs: (receivedAt - started) / 2 } });
      setAvailable(true);
      setLastSuccess(new Date().toLocaleTimeString());
    } catch {
      if (current === generation.current && !denied.current) setAvailable(false);
    } finally {
      clearTimeout(timer);
      if (current === generation.current) request.current = null;
    }
  }, [initial.id, clearAccess]);

  useEffect(() => {
    const update = () => {
      if (document.visibilityState === "hidden" || !navigator.onLine) { invalidate(); setAvailable(false); return; }
      void refresh(true);
    };
    const offline = () => {
      invalidate();
      setAvailable(false);
    };
    const timer = setInterval(() => { void refresh(); }, 2000);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("online", update);
    window.addEventListener("offline", offline);
    update();
    return () => {
      clearInterval(timer);
      invalidate();
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", offline);
    };
  }, [refresh, invalidate]);

  const save: Save = async (command, input) => {
    if (mutating.current || !available || denied.current) return false;
    mutating.current = true;
    generation.current++;
    request.current?.abort();
    request.current = null;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await sessionCommand(command, { ...input, sessionId: initial.id });
      if (result.denied) { clearAccess(); return false; }
      if (result.error) { setError(result.error); return false; }
      setNotice(result.success ?? "");
      return true;
    } catch {
      setError("Save could not be confirmed. Refresh and check before retrying; your draft is retained.");
      setAvailable(false);
      return false;
    } finally {
      mutating.current = false;
      setAvailable(false);
      await refresh(true);
      setBusy(false);
    }
  };

  const data = confirmed?.data;
  if (!data) return <section className="card"><h1>Session access unavailable</h1><p role="alert">{error}</p><Link href="/signin">Sign in</Link></section>;
  const canWrite = available && !busy && data.joined && data.state !== "CLOSED";
  return <FacilitatedContent data={data} save={save} canWrite={canWrite} available={available}
    pending={busy} error={error} notice={notice} lastSuccess={lastSuccess} anchor={confirmed.clock} refresh={() => { void refresh(true); }} />;
}

function FacilitatedContent({ data, save, canWrite, available, pending, error, notice, lastSuccess, refresh, anchor }: {
  data: SessionSnapshot; save: Save; canWrite: boolean; available: boolean; pending: boolean; error: string;
  notice: string; lastSuccess: string; refresh: () => void;
  anchor: TimerAnchor | null;
}) {
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, { action: Action; note: string; status: string }>>({});
  const [confirmation, setConfirmation] = useState<number | null>(null);
  const [votingConfirmation, setVotingConfirmation] = useState<{ command: "start-voting" | "finalize-voting"; version: number } | null>(null);
  const [retainedFacilitation, setRetainedFacilitation] = useState(data.facilitatorView && data.state !== "CLOSED");
  if (data.facilitatorView && data.state !== "CLOSED" && !retainedFacilitation) setRetainedFacilitation(true);
  const canFacilitate = canWrite && data.facilitatorView;
  const collecting = canWrite && data.state === "COLLECTING" && data.voting.state === "NOT_STARTED";
  const selectedIds = new Set(data.voting.selectedTopicIds);
  const counts = new Map(data.voting.counts.map(item => [item.topicId, item.count]));
  const topicsById = new Map(data.topics.map(item => [item.id, item]));
  const reviewItems = new Map(data.priorActions.filter(item => !item.reviewed).map(item => [item.id, item]));
  for (const [id, draft] of Object.entries(reviewDrafts)) if (draft.note && !reviewItems.has(id)) reviewItems.set(id, draft.action);
  return <>
    <Link href="/">Back to workspace</Link><p className="eyebrow">FACILITATED SESSION</p>
    <h1>{data.title}</h1>
    <p role="status">Collection: {data.state === "COLLECTING" ? "Collecting" : data.state === "PAUSED" ? "Collection paused" : "Closed"}</p>
    <p>Facilitator: {data.facilitator.name}</p>
    <p role="status">Voting: {data.voting.state === "NOT_STARTED" ? "Not started" : data.voting.state === "OPEN" ? "Open" : "Finalized"}</p>
    <div aria-live="polite">{pending && <p role="status">Saving change and refreshing confirmed state...</p>}{error && !pending && <p className="error" role="alert">{error}</p>}{notice && !pending && <p className="success">{notice}</p>}</div>
    {!available && !pending && <p className="error" role="alert">Updates unavailable. Displaying last confirmed state{lastSuccess && ` (${lastSuccess})`}. Writes are disabled. <button onClick={refresh}>Retry updates</button></p>}
    {data.state === "CLOSED" && <p>This session is read-only. Unresolved actions can be reviewed in a later session.</p>}
    {data.administration.canJoin && <button disabled={!available || pending} onClick={() => { if (available && !pending && data.administration.canJoin) void save("join", {}); }}>Join session</button>}
    <section className="card"><h2>Participants</h2><ul>{data.participants.map(item => <li key={item.id}>{item.name}</li>)}</ul></section>
    <SessionAdministration data={data} enabled={available && !pending && Boolean(anchor)} save={save} />
    <MeetingSummary data={data} enabled={available && !pending && Boolean(anchor)} save={save} />
    {retainedFacilitation && <section className="card"><h2>Facilitation</h2>
      {data.voting.state === "NOT_STARTED" && <button aria-disabled={!canFacilitate || (data.state === "PAUSED" && !data.voting.canResume)} onClick={() => { if (canFacilitate && (data.state === "COLLECTING" || data.voting.canResume)) void save("state", { state: data.state === "COLLECTING" ? "PAUSED" : "COLLECTING", version: data.lifecycleVersion }); }}>
        {data.state === "COLLECTING" ? "Pause collection" : "Resume collection"}</button>}{" "}
      {data.voting.state === "NOT_STARTED" && <><button aria-disabled={!canFacilitate || !data.voting.canStart} onClick={() => { if (canFacilitate && data.voting.canStart) setVotingConfirmation({ command: "start-voting", version: data.lifecycleVersion }); }}>Start voting</button>
        <p>Pause collection with at least one active topic to start the single voting round.</p></>}
      {data.voting.state === "OPEN" && <><button aria-disabled={!canFacilitate || !data.voting.canFinalize} onClick={() => { if (canFacilitate && data.voting.canFinalize) setVotingConfirmation({ command: "finalize-voting", version: data.lifecycleVersion }); }}>Finish voting</button>
        <p>Finish voting first, then close the session. Collection cannot resume.</p></>}
      {data.voting.state === "FINALIZED" && <p>Voting is final. Topics and agenda are locked; collection cannot resume.</p>}
      {votingConfirmation && <div role="group" aria-label="Confirm voting change">
        <p>{votingConfirmation.command === "start-voting"
          ? "Start the only voting round? Topics will be permanently frozen. Unsaved topic drafts are retained but cannot be saved."
          : "Finish voting permanently? Unused votes are allowed, including no votes. Voting cannot reopen; the final agenda will be saved."}</p>
        <button aria-disabled={!canFacilitate || votingConfirmation.version !== data.lifecycleVersion || !(votingConfirmation.command === "start-voting" ? data.voting.canStart : data.voting.canFinalize)} onClick={async () => {
          if (!canFacilitate || votingConfirmation.version !== data.lifecycleVersion || !(votingConfirmation.command === "start-voting" ? data.voting.canStart : data.voting.canFinalize)) return;
          if (await save(votingConfirmation.command, { version: votingConfirmation.version })) setVotingConfirmation(null);
        }}>{votingConfirmation.command === "start-voting" ? "Confirm start voting" : "Confirm finish voting"}</button>
        <button onClick={() => setVotingConfirmation(null)}>Cancel voting change</button>
        {votingConfirmation.version !== data.lifecycleVersion && <p role="status">Session changed. Cancel and review its current state before confirming.</p>}
      </div>}
      <button aria-disabled={!canFacilitate || !data.voting.canClose} onClick={() => { if (canFacilitate && data.voting.canClose) setConfirmation(data.lifecycleVersion); }}>Close session</button>
      {confirmation !== null && <div role="group" aria-label="Confirm session closure"><p>Close permanently? Topics and this session&apos;s actions/reviews become read-only.</p>
        <button aria-disabled={!canFacilitate || !data.voting.canClose || confirmation !== data.lifecycleVersion} onClick={async () => { if (canFacilitate && data.voting.canClose && confirmation === data.lifecycleVersion && await save("state", { state: "CLOSED", version: confirmation })) setConfirmation(null); }}>Confirm close</button>
        <button onClick={() => setConfirmation(null)}>Cancel close</button>
        {confirmation !== data.lifecycleVersion && <p role="status">Session changed. Cancel and review its current state before closing.</p>}</div>}
    </section>}
    <section className="card" aria-label="Topic voting"><h2>Topic voting</h2>
      <p>Three votes per person, at most one per topic. Your own topics are eligible. Totals are shared; other people&apos;s ballots are not displayed. This is not a secret ballot.</p>
      {data.administration.viewerState !== "NOT_JOINED" ? <p role="status">Votes remaining: {data.voting.remaining} of {data.voting.budget}{data.administration.viewerState === "REMOVED" && " / Read-only until readmission"}</p>
        : <p>{data.voting.state === "OPEN" ? "Join this session to select topics." : data.state === "CLOSED"
          ? "This session is closed; joining and voting are unavailable." : "Join to contribute actions. Voting is not open."}</p>}
      {data.voting.remaining === 0 && data.voting.state === "OPEN" && <p>All three votes are used. Remove a selection before choosing another topic.</p>}
      {data.voting.state !== "NOT_STARTED" && <><h3>{data.voting.state === "FINALIZED" ? "Final agenda" : "Provisional agenda"}</h3>
        <ol aria-label={data.voting.state === "FINALIZED" ? "Final agenda" : "Provisional agenda"}>
          {data.voting.agenda.map(item => <li key={item.topicId}>{topicsById.get(item.topicId)?.title} / Votes: {item.count}</li>)}
        </ol></>}
    </section>
    <DiscussionControls data={data} anchor={anchor} available={available} enabled={canWrite} save={save} retainControls={retainedFacilitation} />
    <AgendaOrderControls data={data} enabled={canWrite && Boolean(anchor)} save={save} retainControls={retainedFacilitation} />
    <ParkingControls data={data} enabled={canWrite && Boolean(anchor)} save={save} retainControls={retainedFacilitation} />
    <section className="card"><h2>Discussion topics</h2>
      <TopicDraft canWrite={collecting} save={save} />
      {data.voting.state !== "NOT_STARTED" && <p>Draft retained; topics are locked for voting. Unsaved topic content cannot be submitted.</p>}
      {data.topics.map(item => <TopicCard key={item.id} topic={item} canWrite={!item.removedAt && collecting && (data.facilitatorView || item.author.id === data.viewerId)} save={save} history={Boolean(item.removedAt)}
        vote={{ count: counts.get(item.id) ?? 0, selected: selectedIds.has(item.id),
          enabled: canWrite && data.voting.canVote && (selectedIds.has(item.id) || (data.voting.remaining ?? 0) > 0),
          version: data.voting.ballotVersion }} />)}
      {!data.topics.some(item => !item.removedAt) && <p>No topics submitted yet.</p>}
    </section>
    <section className="card"><h2>Removed topic history</h2>
      {data.topics.filter(item => item.removedAt).map(item => <article key={item.id}>
        <h3>{item.title}</h3><p className="context">{item.description}</p><p>By {item.author.name}; removed by {item.removedBy?.name} at {item.removedAt}</p>
      </article>)}
    </section>
    <section className="card"><h2>Previous commitments</h2>
      {!data.priorActions.length && <p>No unresolved actions from earlier sessions.</p>}
      {[...reviewItems.values()].map(item => {
        const draft = reviewDrafts[item.id] ?? { action: item, note: "", status: "IN_PROGRESS" };
        const current = data.priorActions.find(action => action.id === item.id);
        const enabled = canWrite && Boolean(current && !current.reviewed);
        return <article className="action" key={item.id}><h3><Link href={`/actions/${item.id}`}>{item.title}</Link></h3>
          <p>Owner: {item.owner} / {statusLabels[item.status]} / From: {item.source}</p><p className="context">{item.context}</p>
          {item.dueDate && <p>Due: {item.dueDate}</p>}
          {!enabled && draft.note && <p role="status">Draft retained. This commitment is no longer reviewable here; reconcile the current history before continuing.</p>}
          <form onSubmit={async event => { event.preventDefault(); if (!enabled) return; if (await save("review", { actionId: item.id, note: draft.note, status: draft.status })) setReviewDrafts(previous => {
            if (previous[item.id]?.note !== draft.note || previous[item.id]?.status !== draft.status) return previous;
            const next = { ...previous }; delete next[item.id]; return next;
          }); }}>
            <label>Progress note<textarea required maxLength={4000} value={draft.note} onChange={event => setReviewDrafts(previous => ({ ...previous, [item.id]: { ...draft, note: event.target.value } }))} /></label>
            <label>Resulting status<select value={draft.status} onChange={event => setReviewDrafts(previous => ({ ...previous, [item.id]: { ...draft, status: event.target.value } }))}><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="DONE">Done</option></select></label>
            <button aria-disabled={!enabled}>Record review</button>
          </form>
        </article>;
      })}
    </section>
    <section className="card"><h2>Capture an improvement</h2><ActionDraft members={data.members} canWrite={canWrite} save={save} /></section>
    <section className="card"><h2>Actions from this session</h2>{data.actions.map(item => <article key={item.id}>
      <h3><Link href={`/actions/${item.id}`}>{item.title}</Link></h3><p>{statusLabels[item.status]} / Owner: {item.owner}</p>{item.dueDate && <p>Due: {item.dueDate}</p>}
    </article>)}</section>
    <section className="card"><h2>Reviews recorded here</h2>{data.reviews.map(item => <article key={item.id}>
      <h3><Link href={`/actions/${item.actionId}`}>{item.title}</Link></h3><p className="context">{item.note}</p><p>{statusLabels[item.status]} / Reviewed by {item.actor}</p>
    </article>)}</section>
  </>;
}

function TopicDraft({ canWrite, save }: { canWrite: boolean; save: Save }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  return <form onSubmit={async event => {
    event.preventDefault();
    if (!canWrite) return;
    if (await save("topic", { title, description })) {
      setTitle(current => current === title ? "" : current);
      setDescription(current => current === description ? "" : current);
    }
  }}>
    <label>Topic title<input required maxLength={160} value={title} onChange={event => setTitle(event.target.value)} /></label>
    <label>Topic description (optional)<textarea maxLength={4000} value={description} onChange={event => setDescription(event.target.value)} /></label>
    <button aria-disabled={!canWrite}>Submit topic</button>
  </form>;
}

function TopicCard({ topic, canWrite, save, history = false, vote }: {
  topic: Topic; canWrite: boolean; save: Save; history?: boolean;
  vote: { count: number; selected: boolean; enabled: boolean; version: number | null };
}) {
  const [draft, setDraft] = useState<{ title: string; description: string; version: number } | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  if (history && !draft) return null;
  return <article className="action">
    {!history && <><h3>{topic.title}</h3><p className="context">{topic.description}</p><p>By {topic.author.name} / {topic.createdAt} / Updated: {topic.updatedAt}</p>
      <p>Votes: {vote.count}</p><button aria-pressed={vote.selected} aria-label={`Vote for ${topic.title}`} aria-disabled={!vote.enabled}
        onClick={() => { if (vote.enabled) void save("vote", { topicId: topic.id, selected: !vote.selected, version: vote.version }); }}>
        {vote.selected ? "Remove my vote" : "Select topic"}</button></>}
    {!draft && !history && <button aria-disabled={!canWrite} onClick={() => { if (canWrite) setDraft({ title: topic.title, description: topic.description, version: topic.version }); }}>Edit topic</button>}
    {draft && <form onSubmit={async event => {
      event.preventDefault();
      if (!canWrite || topic.version !== draft.version) return;
      if (await save("edit", { ...draft, topicId: topic.id })) setDraft(current => current?.title === draft.title && current?.description === draft.description ? null : current);
    }}>
      {(topic.version !== draft.version || topic.removedAt) && <p role="status">Topic changed or was removed. Draft retained; cancel and reopen to reconcile.</p>}
      <label>Edit topic title<input required maxLength={160} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
      <label>Edit topic description<textarea maxLength={4000} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
      <button aria-disabled={!canWrite || topic.version !== draft.version}>Save topic</button><button type="button" onClick={() => setDraft(null)}>Cancel edit</button>
    </form>}
    {!history && <button aria-disabled={!canWrite} onClick={() => { if (canWrite) setRemoving(topic.version); }}>Remove topic</button>}
    {removing !== null && <div role="group" aria-label="Confirm topic removal"><p>Remove this topic from collection? Its last saved content remains in history.</p>
      <button aria-disabled={!canWrite || removing !== topic.version} onClick={async () => { if (canWrite && removing === topic.version && await save("remove", { topicId: topic.id, version: removing })) setRemoving(null); }}>Confirm remove</button>
      <button onClick={() => setRemoving(null)}>Cancel removal</button></div>}
  </article>;
}

function ActionDraft({ members, canWrite, save }: { members: SessionSnapshot["members"]; canWrite: boolean; save: Save }) {
  const [draft, setDraft] = useState({ title: "", context: "", ownerId: "", dueDate: "" });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canWrite) return;
    if (await save("action", draft)) setDraft(current => JSON.stringify(current) === JSON.stringify(draft)
      ? { title: "", context: "", ownerId: "", dueDate: "" } : current);
  };
  return <form onSubmit={submit}>
    <label>Action title<input required maxLength={160} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
    <label>Discussion context<textarea maxLength={4000} value={draft.context} onChange={event => setDraft({ ...draft, context: event.target.value })} /></label>
    <label>Owner<select required value={draft.ownerId} onChange={event => setDraft({ ...draft, ownerId: event.target.value })}><option value="" disabled>Select a team member</option>{members.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label>Due date (optional)<input type="date" value={draft.dueDate} onChange={event => setDraft({ ...draft, dueDate: event.target.value })} /></label>
    <button aria-disabled={!canWrite}>Capture action</button>
  </form>;
}
