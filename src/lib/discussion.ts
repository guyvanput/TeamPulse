export type DiscussionClock = {
  state: "RUNNING" | "PAUSED" | "FINISHED";
  deadlineAt: Date | null;
  remainingMs: number | null;
  allocatedMs: number;
};
export type DiscussionOperation = "pause" | "resume" | "extend" | "finish";
export class DiscussionError extends Error {}

function instant(now: Date, milliseconds: number) {
  const value = now.getTime() + milliseconds;
  if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) {
    throw new DiscussionError("The timer date limit is exhausted. Ask the operator to investigate.");
  }
  return new Date(value);
}

export function beginDiscussion(now: Date): DiscussionClock {
  return { state: "RUNNING", deadlineAt: instant(now, 300000), remainingMs: null, allocatedMs: 300000 };
}

export function discussionTiming(clock: DiscussionClock, now: Date): {
  state: DiscussionClock["state"] | "EXPIRED"; remainingMs: number;
} {
  if (!Number.isFinite(now.getTime())) throw new DiscussionError("Invalid timer sample.");
  if (clock.state === "RUNNING") {
    if (!clock.deadlineAt || !Number.isFinite(clock.deadlineAt.getTime())) throw new DiscussionError("Invalid stored timer deadline.");
    const remainingMs = Math.max(0, clock.deadlineAt.getTime() - now.getTime());
    return { state: remainingMs > 0 ? "RUNNING" : "EXPIRED", remainingMs };
  }
  if (clock.remainingMs === null || !Number.isInteger(clock.remainingMs) || clock.remainingMs < 0) {
    throw new DiscussionError("Invalid stored timer duration.");
  }
  return { state: clock.state, remainingMs: clock.remainingMs };
}

export function changeDiscussionTiming(clock: DiscussionClock, command: DiscussionOperation, now: Date): DiscussionClock {
  if (clock.state === "FINISHED") throw new DiscussionError("This topic is finished and cannot restart.");
  const timing = discussionTiming(clock, now);
  if (command === "finish") return { ...clock, state: "FINISHED", deadlineAt: null, remainingMs: timing.remainingMs };
  if ((command === "pause" || command === "resume") && timing.state === "EXPIRED") {
    throw new DiscussionError("Time expired. Extend or finish this topic.");
  }
  if (command === "pause") {
    if (clock.state !== "RUNNING") throw new DiscussionError("Only a running timer can be paused.");
    return { ...clock, state: "PAUSED", deadlineAt: null, remainingMs: timing.remainingMs };
  }
  if (command === "resume") {
    if (clock.state !== "PAUSED") throw new DiscussionError("Only a paused timer can resume.");
    return { ...clock, state: "RUNNING", deadlineAt: instant(now, timing.remainingMs), remainingMs: null };
  }
  if (clock.allocatedMs > 2147483647 - 120000) {
    throw new DiscussionError("The allocated timer limit is exhausted. Ask the operator to investigate.");
  }
  const allocatedMs = clock.allocatedMs + 120000;
  if (clock.state === "PAUSED") return { ...clock, remainingMs: timing.remainingMs + 120000, allocatedMs };
  return { ...clock, deadlineAt: instant(now, timing.remainingMs + 120000), allocatedMs };
}
