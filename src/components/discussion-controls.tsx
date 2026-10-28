"use client";

import { useEffect, useState } from "react";
import type { SessionSnapshot } from "@/lib/session-snapshot";
import type { DiscussionOperation } from "@/lib/discussion";

export type TimerAnchor = { receivedAt: number; transitMs: number };
type DiscussionCommand = `${"start" | DiscussionOperation}-discussion`;
type Save = (command: DiscussionCommand, input: Record<string, unknown>) => Promise<boolean>;

export function DiscussionControls({ data, anchor, available, enabled, save, retainControls = false }: {
  data: SessionSnapshot; anchor: TimerAnchor | null; available: boolean; enabled: boolean; save: Save; retainControls?: boolean;
}) {
  const [confirmation, setConfirmation] = useState<{ topicId: string; version: number } | null>(null);
  const { discussion } = data;
  const current = discussion.current;
  const title = (id: string) => data.topics.find(topic => topic.id === id)?.title;
  const writable = enabled && data.facilitatorView && data.state !== "CLOSED" && Boolean(anchor);
  const input = { topicId: current?.topicId, version: data.lifecycleVersion };
  if (data.voting.state !== "FINALIZED") return null;
  return <section className="card" aria-label="Timed discussion"><h2>Timed discussion</h2>
    <p>Five minutes per topic; each extension adds two minutes. Expiry never advances the agenda.</p>
    {current ? <>
      <h3>Current: {title(current.topicId)}</h3>
      <p role="status" key={`${current.topicId}:${current.attemptNumber}:${current.deadlineAt}`}>Discussion: {current.state === "RUNNING" ? "Running" : current.state === "PAUSED" ? "Paused" : "Time expired"}</p>
      <Countdown key={`${current.topicId}:${current.attemptNumber}`} current={current} anchor={anchor} available={available} />
      {(data.facilitatorView && data.state !== "CLOSED" || retainControls) && <>
        <button aria-disabled={!writable || !discussion.canPause} onClick={() => { if (writable && discussion.canPause) void save("pause-discussion", input); }}>Pause timer</button>{" "}
        <button aria-disabled={!writable || !discussion.canResume} onClick={() => { if (writable && discussion.canResume) void save("resume-discussion", input); }}>Resume timer</button>{" "}
        <button aria-disabled={!writable || !discussion.canExtend} onClick={() => { if (writable && discussion.canExtend) void save("extend-discussion", input); }}>Extend by two minutes</button>{" "}
        <button aria-disabled={!writable || !discussion.canFinish} onClick={() => { if (writable && discussion.canFinish) setConfirmation({ topicId: current.topicId, version: data.lifecycleVersion }); }}>Finish topic</button>
        <p>Finish or park the current discussion before closing, even after time expires.</p>
      </>}
    </> : discussion.nextTopicId ? <>
      <p>Next: {title(discussion.nextTopicId)}</p>
      {(data.facilitatorView && data.state !== "CLOSED" || retainControls) && <button aria-disabled={!writable || !discussion.canStart}
        onClick={() => { if (writable && discussion.canStart) void save("start-discussion", { topicId: discussion.nextTopicId, version: data.lifecycleVersion }); }}>Start next topic</button>}
    </> : <p role="status">{discussion.allDiscussed ? "All agenda topics discussed." : "No eligible topic to start. Restore a parked topic or close the session."}</p>}
    {!anchor && <p role="status">Synchronizing timer...</p>}
    {confirmation && <div role="group" aria-label="Confirm topic completion">
      <p>Mark this topic Discussed permanently? It cannot restart in this slice. No next topic starts automatically.</p>
      <button aria-disabled={!writable || !discussion.canFinish || confirmation.version !== data.lifecycleVersion || confirmation.topicId !== current?.topicId}
        onClick={async () => { if (writable && discussion.canFinish && confirmation.version === data.lifecycleVersion && confirmation.topicId === current?.topicId && await save("finish-discussion", confirmation)) setConfirmation(null); }}>Confirm finish topic</button>
      <button onClick={() => setConfirmation(null)}>Cancel finish topic</button>
      {(confirmation.version !== data.lifecycleVersion || confirmation.topicId !== current?.topicId) && <p role="status">Discussion changed. Cancel and review the current state.</p>}
    </div>}
    <ol aria-label="Discussion progress">{discussion.entries.map(item => <li key={item.topicId}>
      {title(item.topicId)} / {item.state === "FINISHED" ? "Discussed" : item.state === "PARKED" ? "Parked" : item.state === "NOT_STARTED" ? "Not discussed" : "Current"}
      {item.attempts.map(attempt => <p key={attempt.attemptNumber}>
        Attempt {attempt.attemptNumber}: {attempt.outcome === "DISCUSSED" ? "Discussed" : attempt.outcome === "DEFERRED" ? "Deferred" : "Current"}
        {" / "}Started: {attempt.startedAt} by {attempt.startedBy.name}
        {" / "}Allocated: {attempt.allocatedMs / 60000} minutes
        {attempt.finishedAt && <span> / Ended: {attempt.finishedAt} by {attempt.finishedBy?.name} / Remaining: {format(attempt.remainingMs)}</span>}
      </p>)}
    </li>)}</ol>
  </section>;
}

function Countdown({ current, anchor, available }: {
  current: NonNullable<SessionSnapshot["discussion"]["current"]>; anchor: TimerAnchor | null; available: boolean;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!anchor || !available || current.state !== "RUNNING") return;
    const timer = setInterval(() => setTick(performance.now()), 250);
    return () => clearInterval(timer);
  }, [anchor, available, current.state]);
  if (!anchor) return <p>Countdown awaiting synchronization.</p>;
  if (!available) return <p>Timer stale. Last confirmed remaining: {format(current.remainingMs)}. Reconnect to synchronize.</p>;
  const elapsed = current.state === "RUNNING" ? Math.max(0, tick - anchor.receivedAt + anchor.transitMs) : 0;
  return <p>Time remaining (estimate): <span role="timer" aria-label="Time remaining" aria-live="off">{format(Math.max(0, current.remainingMs - elapsed))}</span></p>;
}

function format(milliseconds: number) {
  const seconds = Math.ceil(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
