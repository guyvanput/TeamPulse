import { z } from "zod";

const title = z.string().trim().min(1, "A title is required.").max(160, "Use at most 160 characters.");
const id = z.string().min(1, "An identifier is required.").max(100);
const date = z.string().refine((value) => {
  if (value === "") return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (value.startsWith("0000-")) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Enter a valid calendar date (YYYY-MM-DD).");

export const sessionInput = z.object({ teamId: id, title });
export const collectionState = z.enum(["COLLECTING", "PAUSED", "CLOSED"]);
export type CollectionState = z.infer<typeof collectionState>;
const version = z.union([z.number(), z.string().trim().min(1)])
  .pipe(z.coerce.number<string | number>().int().nonnegative());
export const joinInput = z.object({ sessionId: id });
export const topicInput = joinInput.extend({
  title: title.refine(value => value.length <= 160, "Use at most 160 characters."),
  description: z.string().trim().refine(value => value.length <= 4000, "Use at most 4000 characters.")
});
export const topicChangeInput = topicInput.extend({ topicId: id, version });
export const topicRemoveInput = joinInput.extend({ topicId: id, version });
export const discussionInput = topicRemoveInput;
export const discussionOperation = z.enum(["start", "pause", "resume", "extend", "finish"]);
export const restoreInput = topicRemoveInput.strict();
export const parkInput = restoreInput.extend({ reason: z.string().trim().max(4000, "Use at most 4000 characters.").default("") }).strict();
export const parkingOperation = z.enum(["park", "restore"]);
export const moveAgendaInput = restoreInput.extend({ neighborTopicId: id, direction: z.enum(["earlier", "later"]) }).strict();
export const lifecycleInput = joinInput.extend({ state: collectionState, version });
export const votingLifecycleInput = joinInput.extend({ version });
export const generateSummaryInput = votingLifecycleInput.extend({ note: z.string().trim().max(4000, "Use at most 4000 characters.").default("") }).strict();
export const administrationInput = votingLifecycleInput.extend({ targetId: id }).strict();
export const removalInput = administrationInput.extend({ reason: z.string().trim().max(4000, "Use at most 4000 characters.").default("") }).strict();
export const administrationOperation = z.enum(["transfer", "remove", "readmit"]);
export const voteInput = topicRemoveInput.extend({ selected: z.boolean() });
export const votingState = z.enum(["NOT_STARTED", "OPEN", "FINALIZED"]);
export function canTransitionCollection(from: CollectionState, to: CollectionState) {
  return from !== "CLOSED" && from !== to;
}
export const actionInput = z.object({
  sessionId: id,
  title,
  context: z.string().trim().max(4000, "Use at most 4000 characters."),
  ownerId: id,
  dueDate: date
});
export const reviewInput = z.object({
  sessionId: id,
  actionId: id,
  note: z.string().trim().min(1, "A progress note is required.").max(4000, "Use at most 4000 characters."),
  status: z.enum(["OPEN", "IN_PROGRESS", "DONE"], { error: "Choose a valid status." })
});

export const statusLabels = { OPEN: "Open", IN_PROGRESS: "In progress", DONE: "Done" } as const;

export function isEarlier(source: { createdAt: Date; id: string }, target: { createdAt: Date; id: string }) {
  return source.createdAt < target.createdAt ||
    (source.createdAt.getTime() === target.createdAt.getTime() && source.id < target.id);
}
