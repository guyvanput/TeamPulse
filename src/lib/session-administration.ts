import { z } from "zod";
import type { CollectionState } from "./rules";

const person = z.object({ id: z.string().min(1), name: z.string() }).strict();
const event = z.object({
  version: z.number().int().positive(), kind: z.enum(["TRANSFER", "REMOVE", "READMIT"]),
  actor: person, target: person, createdAt: z.iso.datetime(), reason: z.string().max(4000).refine(value => value === value.trim())
}).strict();
const participant = person.extend({ joinedAt: z.iso.datetime(), removedAt: z.iso.datetime().nullable() });
export const administrationSchema = z.object({
  viewerState: z.enum(["NOT_JOINED", "ACTIVE", "REMOVED"]), joinedAt: z.iso.datetime().nullable(),
  removedAt: z.iso.datetime().nullable(), canJoin: z.boolean(), canAdminister: z.boolean(),
  entries: z.array(participant.extend({
    inTeam: z.boolean(), canTransfer: z.boolean(), canRemove: z.boolean(), canReadmit: z.boolean()
  }).strict()), history: z.array(event)
}).strict().superRefine((view, ctx) => {
  const ids = new Set(view.entries.map(item => item.id));
  const valid = ids.size === view.entries.length &&
    (view.viewerState === "NOT_JOINED" ? view.joinedAt === null && view.removedAt === null
      : view.joinedAt !== null && (view.viewerState === "REMOVED") === (view.removedAt !== null)) &&
    (!view.canJoin || view.viewerState === "NOT_JOINED") &&
    (!view.canAdminister || view.viewerState === "ACTIVE") &&
    view.entries.every(item =>
      (!item.canTransfer && !item.canRemove || item.inTeam && item.removedAt === null && view.canAdminister) &&
      (!item.canReadmit || item.inTeam && item.removedAt !== null && view.canAdminister)) &&
    view.history.every((item, index) => ids.has(item.actor.id) && ids.has(item.target.id) &&
      item.actor.id !== item.target.id && (item.kind === "REMOVE" || item.reason === "") &&
      (index === 0 || item.version > view.history[index - 1].version));
  if (!valid) ctx.addIssue({ code: "custom", message: "Stored session administration is inconsistent. Ask the operator to investigate." });
});
export function administrationView(source: {
  viewerId: string; facilitatorId: string; state: CollectionState;
  participants: readonly z.infer<typeof participant>[]; memberIds: ReadonlySet<string>; history: z.infer<typeof event>[];
}) {
  if (!source.memberIds.has(source.viewerId)) throw new Error("Administration viewer is not an authorized team member.");
  const viewer = source.participants.find(item => item.id === source.viewerId);
  const canAdminister = source.state !== "CLOSED" && source.facilitatorId === source.viewerId && Boolean(viewer && viewer.removedAt === null);
  return administrationSchema.parse({
    viewerState: viewer ? viewer.removedAt === null ? "ACTIVE" : "REMOVED" : "NOT_JOINED",
    joinedAt: viewer?.joinedAt ?? null, removedAt: viewer?.removedAt ?? null, canAdminister,
    canJoin: !viewer && source.state !== "CLOSED",
    entries: source.participants.map(item => {
      const inTeam = source.memberIds.has(item.id);
      const eligible = canAdminister && inTeam && item.id !== source.viewerId;
      return { ...item, inTeam, canTransfer: eligible && item.removedAt === null,
        canRemove: eligible && item.removedAt === null, canReadmit: eligible && item.removedAt !== null };
    }),
    history: source.history
  });
}
