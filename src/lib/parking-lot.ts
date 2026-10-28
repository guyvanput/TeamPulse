export type Attempt = {
  topicId: string; attemptNumber: number; state: "RUNNING" | "PAUSED" | "FINISHED";
  outcome: "DISCUSSED" | "DEFERRED" | null;
};
export type ParkingEvent = {
  topicId: string; version: number; kind: "PARK" | "RESTORE"; attemptNumber: number | null;
};
export class ParkingError extends Error {}

function history(condition: boolean) {
  if (!condition) throw new Error("Stored parking/discussion history is inconsistent. Ask the operator to investigate.");
}

export function nextAttemptNumber(attempts: readonly { attemptNumber: number }[]) {
  const last = attempts.reduce((max, item) => Math.max(max, item.attemptNumber), 0);
  if (last >= 2147483647) throw new ParkingError("The discussion attempt number is exhausted. Ask the operator to investigate.");
  return last + 1;
}

export function parkingProgress<A extends { topicId: string; position: number; discussionPosition: number }, T extends Attempt, E extends ParkingEvent>(
  agenda: readonly A[], attempts: readonly T[], events: readonly E[]
) {
  for (const key of ["position", "discussionPosition"] as const) {
    history(agenda.map(item => item[key]).sort((a, b) => a - b).every((value, index) => Number.isInteger(value) && value === index + 1));
  }
  const ids = new Set(agenda.map(item => item.topicId));
  history(ids.size === agenda.length && attempts.every(item => ids.has(item.topicId)) && events.every(item => ids.has(item.topicId)));
  history(new Set(events.map(item => item.version)).size === events.length);
  const entries = [...agenda].sort((a, b) => a.position - b.position).map(entry => {
    const timeboxes = attempts.filter(item => item.topicId === entry.topicId).sort((a, b) => a.attemptNumber - b.attemptNumber);
    const moves = events.filter(item => item.topicId === entry.topicId).sort((a, b) => a.version - b.version);
    const linked = new Set<number>();
    moves.forEach((move, index) => {
      history(Number.isInteger(move.version) && move.version > 0 && move.kind === (index % 2 === 0 ? "PARK" : "RESTORE"));
      if (move.attemptNumber !== null) {
        history(move.kind === "PARK" && !linked.has(move.attemptNumber) &&
          timeboxes.some(item => item.attemptNumber === move.attemptNumber && item.outcome === "DEFERRED"));
        linked.add(move.attemptNumber);
      }
    });
    timeboxes.forEach((item, index) => {
      history(item.attemptNumber === index + 1 && (item.state === "FINISHED" ? item.outcome !== null : item.outcome === null));
      history(index === timeboxes.length - 1 || item.outcome === "DEFERRED");
      history(item.outcome !== "DEFERRED" || linked.has(item.attemptNumber));
    });
    const latest = timeboxes.at(-1);
    const current = latest && latest.state !== "FINISHED" ? latest : null;
    const parked = moves.at(-1)?.kind === "PARK";
    const discussed = latest?.outcome === "DISCUSSED";
    history(!(parked && (current !== null || discussed === true)));
    const state = discussed ? "FINISHED" as const : parked ? "PARKED" as const : current ? current.state : "NOT_STARTED" as const;
    return { ...entry, state, current, attempts: timeboxes, events: moves };
  });
  const current = entries.flatMap(item => item.current ? [item.current] : []);
  history(current.length <= 1);
  const future = entries.filter(item => item.current === null && item.state !== "FINISHED").sort((a, b) => a.discussionPosition - b.discussionPosition);
  return {
    entries, future, current: current[0] ?? null,
    nextTopicId: future.find(item => item.state === "NOT_STARTED")?.topicId ?? null,
    allDiscussed: entries.length > 0 && entries.every(item => item.state === "FINISHED")
  };
}
