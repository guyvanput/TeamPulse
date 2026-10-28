"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { sessionCommand } from "@/app/actions";
import { snapshotSchema, type SessionSnapshot } from "@/lib/session-snapshot";
import { statusLabels } from "@/lib/rules";

type Topic = SessionSnapshot["topics"][number];
type Action = SessionSnapshot["priorActions"][number];
type Command = Parameters<typeof sessionCommand>[0];
type Save = (command: Command, input: Record<string, unknown>) => Promise<boolean>;

export function SessionWorkspace({ initial }: { initial: SessionSnapshot }) {
  const [data, setData] = useState<SessionSnapshot | null>(initial);
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
    setData(null);
    setAvailable(false);
    setError("Sign in again or ask the operator to check your team access.");
    setNotice("");
  }, []);

  const refresh = useCallback(async (force = false) => {
    if (denied.current || mutating.current || (!force && request.current)) return;
    if (document.visibilityState === "hidden" || !navigator.onLine) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const current = ++generation.current;
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetch(`/api/sessions/${initial.id}/snapshot`, { cache: "no-store", signal: controller.signal });
      if (current !== generation.current) return;
      if (response.status === 401 || response.status === 404) { clearAccess(); return; }
      if (!response.ok) throw new Error("Updates unavailable.");
      const next = snapshotSchema.parse(await response.json());
      if (current !== generation.current) return;
      setData(next);
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
    const update = () => { void refresh(true); };
    const offline = () => {
      invalidate();
      setAvailable(false);
    };
    const timer = setInterval(() => { void refresh(); }, 2000);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("online", update);
    window.addEventListener("offline", offline);
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
      setBusy(false);
      void refresh(true);
    }
  };

  if (!data) return <section className="card"><h1>Session access unavailable</h1><p role="alert">{error}</p><Link href="/signin">Sign in</Link></section>;
  const canWrite = available && !busy && data.joined && data.state !== "CLOSED";
  return <FacilitatedContent data={data} save={save} canWrite={canWrite} available={available}
    error={error} notice={notice} lastSuccess={lastSuccess} refresh={() => { void refresh(true); }} />;
}

function FacilitatedContent({ data, save, canWrite, available, error, notice, lastSuccess, refresh }: {
  data: SessionSnapshot; save: Save; canWrite: boolean; available: boolean; error: string;
  notice: string; lastSuccess: string; refresh: () => void;
}) {
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, { action: Action; note: string; status: string }>>({});
  const [confirmation, setConfirmation] = useState(false);
  const collecting = canWrite && data.state === "COLLECTING";
  const reviewItems = new Map(data.priorActions.filter(item => !item.reviewed).map(item => [item.id, item]));
  for (const [id, draft] of Object.entries(reviewDrafts)) if (draft.note && !reviewItems.has(id)) reviewItems.set(id, draft.action);
  return <>
    <Link href="/">Back to workspace</Link><p className="eyebrow">FACILITATED SESSION</p>
    <h1>{data.title}</h1>
    <p role="status">Collection: {data.state === "COLLECTING" ? "Collecting" : data.state === "PAUSED" ? "Collection paused" : "Closed"}</p>
    <p>Facilitator: {data.facilitator.name}</p>
    <div aria-live="polite">{error && <p className="error" role="alert">{error}</p>}{notice && <p className="success">{notice}</p>}</div>
    {!available && <p className="error" role="alert">Updates unavailable. Displaying last confirmed state{lastSuccess && ` (${lastSuccess})`}. Writes are disabled. <button onClick={refresh}>Retry updates</button></p>}
    {data.state === "CLOSED" && <p>This session is read-only. Unresolved actions can be reviewed in a later session.</p>}
    {!data.joined && data.state !== "CLOSED" && <button disabled={!available} onClick={() => { void save("join", {}); }}>Join session</button>}
    <section className="card"><h2>Participants</h2><ul>{data.participants.map(item => <li key={item.id}>{item.name}</li>)}</ul></section>
    {data.facilitatorView && data.state !== "CLOSED" && <section className="card"><h2>Facilitation</h2>
      <button disabled={!canWrite} onClick={() => { void save("state", { state: data.state === "COLLECTING" ? "PAUSED" : "COLLECTING", version: data.lifecycleVersion }); }}>
        {data.state === "COLLECTING" ? "Pause collection" : "Resume collection"}</button>{" "}
      <button disabled={!canWrite} onClick={() => setConfirmation(true)}>Close session</button>
      {confirmation && <div role="group" aria-label="Confirm session closure"><p>Close permanently? Topics and this session&apos;s actions/reviews become read-only.</p>
        <button disabled={!canWrite} onClick={async () => { if (await save("state", { state: "CLOSED", version: data.lifecycleVersion })) setConfirmation(false); }}>Confirm close</button>
        <button onClick={() => setConfirmation(false)}>Cancel close</button></div>}
    </section>}
    <section className="card"><h2>Discussion topics</h2>
      <TopicDraft canWrite={collecting} save={save} />
      {data.topics.map(item => <TopicCard key={item.id} topic={item} canWrite={!item.removedAt && collecting && (data.facilitatorView || item.author.id === data.viewerId)} save={save} history={Boolean(item.removedAt)} />)}
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
          <form onSubmit={async event => { event.preventDefault(); if (await save("review", { actionId: item.id, note: draft.note, status: draft.status })) setReviewDrafts(previous => {
            if (previous[item.id]?.note !== draft.note || previous[item.id]?.status !== draft.status) return previous;
            const next = { ...previous }; delete next[item.id]; return next;
          }); }}>
            <label>Progress note<textarea required maxLength={4000} value={draft.note} onChange={event => setReviewDrafts(previous => ({ ...previous, [item.id]: { ...draft, note: event.target.value } }))} /></label>
            <label>Resulting status<select value={draft.status} onChange={event => setReviewDrafts(previous => ({ ...previous, [item.id]: { ...draft, status: event.target.value } }))}><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="DONE">Done</option></select></label>
            <button disabled={!enabled}>Record review</button>
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
    if (await save("topic", { title, description })) {
      setTitle(current => current === title ? "" : current);
      setDescription(current => current === description ? "" : current);
    }
  }}>
    <label>Topic title<input required maxLength={160} value={title} onChange={event => setTitle(event.target.value)} /></label>
    <label>Topic description (optional)<textarea maxLength={4000} value={description} onChange={event => setDescription(event.target.value)} /></label>
    <button disabled={!canWrite}>Submit topic</button>
  </form>;
}

function TopicCard({ topic, canWrite, save, history = false }: { topic: Topic; canWrite: boolean; save: Save; history?: boolean }) {
  const [draft, setDraft] = useState<{ title: string; description: string; version: number } | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  if (history && !draft) return null;
  return <article className="action">
    {!history && <><h3>{topic.title}</h3><p className="context">{topic.description}</p><p>By {topic.author.name} / {topic.createdAt} / Updated: {topic.updatedAt}</p></>}
    {!draft && !history && <button disabled={!canWrite} onClick={() => setDraft({ title: topic.title, description: topic.description, version: topic.version })}>Edit topic</button>}
    {draft && <form onSubmit={async event => {
      event.preventDefault();
      if (await save("edit", { ...draft, topicId: topic.id })) setDraft(current => current?.title === draft.title && current?.description === draft.description ? null : current);
    }}>
      {(topic.version !== draft.version || topic.removedAt) && <p role="status">Topic changed or was removed. Draft retained; cancel and reopen to reconcile.</p>}
      <label>Edit topic title<input required maxLength={160} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
      <label>Edit topic description<textarea maxLength={4000} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
      <button disabled={!canWrite || topic.version !== draft.version}>Save topic</button><button type="button" onClick={() => setDraft(null)}>Cancel edit</button>
    </form>}
    {!history && <button disabled={!canWrite} onClick={() => setRemoving(topic.version)}>Remove topic</button>}
    {removing !== null && <div role="group" aria-label="Confirm topic removal"><p>Remove this topic from collection? Its last saved content remains in history.</p>
      <button disabled={!canWrite || removing !== topic.version} onClick={async () => { if (await save("remove", { topicId: topic.id, version: removing })) setRemoving(null); }}>Confirm remove</button>
      <button onClick={() => setRemoving(null)}>Cancel removal</button></div>}
  </article>;
}

function ActionDraft({ members, canWrite, save }: { members: SessionSnapshot["members"]; canWrite: boolean; save: Save }) {
  const [draft, setDraft] = useState({ title: "", context: "", ownerId: "", dueDate: "" });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await save("action", draft)) setDraft(current => JSON.stringify(current) === JSON.stringify(draft)
      ? { title: "", context: "", ownerId: "", dueDate: "" } : current);
  };
  return <form onSubmit={submit}>
    <label>Action title<input required maxLength={160} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
    <label>Discussion context<textarea maxLength={4000} value={draft.context} onChange={event => setDraft({ ...draft, context: event.target.value })} /></label>
    <label>Owner<select required value={draft.ownerId} onChange={event => setDraft({ ...draft, ownerId: event.target.value })}><option value="" disabled>Select a team member</option>{members.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label>Due date (optional)<input type="date" value={draft.dueDate} onChange={event => setDraft({ ...draft, dueDate: event.target.value })} /></label>
    <button disabled={!canWrite}>Capture action</button>
  </form>;
}
