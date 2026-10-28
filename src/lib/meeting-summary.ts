import { z } from "zod";
import { parkingProgress, type Attempt, type ParkingEvent } from "./parking-lot";
import type { CollectionState } from "./rules";

const person = z.object({ id: z.string().min(1), name: z.string() }).strict();
const status = z.enum(["OPEN", "IN_PROGRESS", "DONE"]);
const session = z.object({ id: z.string().min(1), title: z.string() }).strict();
const action = z.object({
  id: z.string().min(1), title: z.string(), context: z.string(), owner: person,
  dueDate: z.iso.date().nullable(), status, source: session, createdHere: z.boolean(),
  reviews: z.array(z.object({
    id: z.string().min(1), actor: person, createdAt: z.iso.datetime(), note: z.string(), resultingStatus: status
  }).strict())
}).strict();
export const summaryContentSchema = z.object({
  session: session.extend({ facilitator: person }),
  participants: z.array(person.extend({ joinedAt: z.iso.datetime() })),
  votingState: z.enum(["NOT_STARTED", "FINALIZED"]),
  topics: z.array(z.object({
    id: z.string().min(1), title: z.string(), description: z.string(),
    originalPosition: z.number().int().positive().nullable(), discussionPosition: z.number().int().positive().nullable(),
    voteCount: z.number().int().nonnegative().nullable(),
    outcome: z.enum(["DISCUSSED", "DEFERRED", "NOT_DISCUSSED"]), reason: z.string().max(4000).nullable()
  }).strict()),
  actions: z.array(action)
}).strict().superRefine((content, ctx) => {
  const valid = new Set(content.topics.map(item => item.id)).size === content.topics.length &&
    new Set(content.participants.map(item => item.id)).size === content.participants.length &&
    new Set(content.actions.map(item => item.id)).size === content.actions.length &&
    content.actions.every(item => item.createdHere === (item.source.id === content.session.id) && (item.createdHere || item.reviews.length > 0)) &&
    content.topics.every(item => item.outcome === "DEFERRED" ? item.reason !== null : item.reason === null);
  const planning = content.votingState === "NOT_STARTED"
    ? content.topics.every(item => item.originalPosition === null && item.discussionPosition === null && item.voteCount === null && item.outcome === "NOT_DISCUSSED")
    : ["originalPosition", "discussionPosition"].every(key => {
      const positions = content.topics.map(item => key === "originalPosition" ? item.originalPosition : item.discussionPosition);
      return positions.every(value => value !== null) && positions.map(Number).sort((a, b) => a - b).every((value, i) => value === i + 1);
    }) && content.topics.every(item => item.voteCount !== null);
  if (!valid || !planning) ctx.addIssue({ code: "custom", message: "Stored meeting summary is inconsistent. Ask the operator to investigate." });
});
export const summaryReportSchema = z.object({
  formatVersion: z.literal(1), generatedAt: z.iso.datetime(), generatedBy: person,
  note: z.string().max(4000).refine(value => value === value.trim()), content: summaryContentSchema
}).strict();
export type SummaryReport = z.infer<typeof summaryReportSchema>;
export type SummarySource = {
  session: { id: string; title: string; facilitator: z.infer<typeof person>; state: CollectionState; votingState: "NOT_STARTED" | "OPEN" | "FINALIZED" };
  participants: z.infer<typeof summaryContentSchema>["participants"];
  topics: { id: string; title: string; description: string; removedAt: string | null }[];
  agenda: { topicId: string; position: number; discussionPosition: number; voteCount: number }[];
  attempts: readonly Attempt[];
  events: readonly (ParkingEvent & { reason: string })[];
  actions: z.infer<typeof action>[];
};
export function buildSummaryContent(source: SummarySource) {
  if (source.session.state !== "CLOSED" || source.session.votingState === "OPEN") throw new Error("Meeting summary requires a consistent closed source.");
  const active = source.topics.filter(item => item.removedAt === null);
  const progress = parkingProgress(source.agenda, source.attempts, source.events);
  if (progress.current) throw new Error("A closed source cannot have a current discussion.");
  if (source.session.votingState === "NOT_STARTED" && source.agenda.length) throw new Error("Unprioritized source has a stored agenda.");
  const byId = new Map(active.map(item => [item.id, item]));
  if (source.session.votingState === "FINALIZED" &&
    (source.agenda.length !== active.length || !source.agenda.every(item => byId.has(item.topicId)))) {
    throw new Error("Stored agenda does not match the closed source topics.");
  }
  const topics = source.session.votingState === "FINALIZED" ? progress.entries.map(entry => {
    const topic = byId.get(entry.topicId)!;
    return {
      id: topic.id, title: topic.title, description: topic.description,
      originalPosition: entry.position, discussionPosition: entry.discussionPosition, voteCount: entry.voteCount,
      outcome: entry.state === "FINISHED" ? "DISCUSSED" : entry.state === "PARKED" ? "DEFERRED" : "NOT_DISCUSSED",
      reason: entry.state === "PARKED" ? entry.events.at(-1)!.reason : null
    };
  }) : active.map(topic => ({
    id: topic.id, title: topic.title, description: topic.description, originalPosition: null,
    discussionPosition: null, voteCount: null, outcome: "NOT_DISCUSSED", reason: null
  }));
  return summaryContentSchema.parse({
    session: { id: source.session.id, title: source.session.title, facilitator: source.session.facilitator },
    participants: source.participants, votingState: source.session.votingState, topics, actions: source.actions
  });
}
