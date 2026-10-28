import { z } from "zod";

export class AgendaOrderError extends Error {}

export function planAgendaMove<T extends { topicId: string; discussionPosition: number }>(
  future: readonly T[], topicId: string, neighborTopicId: string, direction: string
) {
  if (direction !== "earlier" && direction !== "later") throw new AgendaOrderError("Invalid agenda direction.");
  const index = future.findIndex(item => item.topicId === topicId);
  const neighborIndex = index + (direction === "earlier" ? -1 : 1);
  if (index < 0 || !future[neighborIndex] || future[neighborIndex].topicId !== neighborTopicId) {
    throw new AgendaOrderError("The future queue or neighbor changed. Refresh and reconcile before moving.");
  }
  const beforeQueue = future.map(item => item.topicId);
  const afterQueue = [...beforeQueue];
  [afterQueue[index], afterQueue[neighborIndex]] = [afterQueue[neighborIndex], afterQueue[index]];
  return { topic: future[index], neighbor: future[neighborIndex], beforeQueue, afterQueue };
}

const vector = z.array(z.string().min(1).max(100)).min(2).refine(ids => new Set(ids).size === ids.length);
export function validateOrderHistory(before: unknown, after: unknown, topicId: string, neighborTopicId: string, direction: "EARLIER" | "LATER") {
  const old = vector.safeParse(before), next = vector.safeParse(after);
  const message = "Stored agenda order history is inconsistent. Ask the operator to investigate.";
  if (!old.success || !next.success) throw new Error(message);
  try {
    const planned = planAgendaMove(old.data.map((id, i) => ({ topicId: id, discussionPosition: i + 1 })),
      topicId, neighborTopicId, direction === "EARLIER" ? "earlier" : "later");
    if (JSON.stringify(planned.afterQueue) !== JSON.stringify(next.data)) throw new Error(message);
    return { beforeQueue: old.data, afterQueue: next.data };
  } catch (error) {
    if (error instanceof AgendaOrderError) throw new Error(message);
    throw error;
  }
}
