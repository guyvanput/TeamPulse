import { z } from "zod";
import { collectionState } from "./rules";

const person = z.object({ id: z.string(), name: z.string() });
const action = z.object({
  id: z.string(), title: z.string(), context: z.string(), owner: z.string(),
  dueDate: z.string().nullable(), status: z.enum(["OPEN", "IN_PROGRESS", "DONE"]),
  source: z.string(), reviewed: z.boolean()
});
export const snapshotSchema = z.object({
  id: z.string(), title: z.string(), state: collectionState, lifecycleVersion: z.number().int(),
  facilitator: person, viewerId: z.string(), joined: z.boolean(), facilitatorView: z.boolean(),
  participants: z.array(person.extend({ joinedAt: z.string() })), members: z.array(person),
  topics: z.array(z.object({
    id: z.string(), title: z.string(), description: z.string(), author: person,
    createdAt: z.string(), updatedAt: z.string(), version: z.number().int(),
    removedAt: z.string().nullable(), removedBy: person.nullable()
  })),
  actions: z.array(action), priorActions: z.array(action),
  reviews: z.array(z.object({ id: z.string(), actionId: z.string(), title: z.string(), note: z.string(), actor: z.string(), status: z.enum(["OPEN", "IN_PROGRESS", "DONE"]) }))
});
export type SessionSnapshot = z.infer<typeof snapshotSchema>;
