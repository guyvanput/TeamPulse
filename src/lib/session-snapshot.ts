import { z } from "zod";
import { collectionState, votingState } from "./rules";
import { summaryReportSchema } from "./meeting-summary";
import { administrationSchema } from "./session-administration";

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
  voting: z.object({
    state: votingState, startedAt: z.string().nullable(), finalizedAt: z.string().nullable(),
    budget: z.literal(3), ballotVersion: z.number().int().nonnegative().nullable(),
    selectedTopicIds: z.array(z.string()), remaining: z.number().int().min(0).max(3).nullable(),
    counts: z.array(z.object({ topicId: z.string(), count: z.number().int().nonnegative() })),
    agenda: z.array(z.object({ topicId: z.string(), position: z.number().int().positive(), count: z.number().int().nonnegative() })),
    canStart: z.boolean(), canVote: z.boolean(), canFinalize: z.boolean(), canResume: z.boolean(), canClose: z.boolean()
  }),
  discussion: z.object({
    sampledAt: z.iso.datetime(),
    current: z.object({
      topicId: z.string(), attemptNumber: z.number().int().positive(), state: z.enum(["RUNNING", "PAUSED", "EXPIRED"]),
      deadlineAt: z.iso.datetime().nullable(), remainingMs: z.number().int().nonnegative()
    }).nullable(),
    entries: z.array(z.object({
      topicId: z.string(), state: z.enum(["NOT_STARTED", "RUNNING", "PAUSED", "EXPIRED", "FINISHED", "PARKED"]),
      attempts: z.array(z.object({
        attemptNumber: z.number().int().positive(), state: z.enum(["RUNNING", "PAUSED", "EXPIRED", "FINISHED"]),
        outcome: z.enum(["DISCUSSED", "DEFERRED"]).nullable(), deadlineAt: z.iso.datetime().nullable(),
        remainingMs: z.number().int().nonnegative(), allocatedMs: z.number().int().positive(),
        startedAt: z.iso.datetime(), finishedAt: z.iso.datetime().nullable(),
        startedBy: person, finishedBy: person.nullable()
      }))
    })),
    allDiscussed: z.boolean(),
    nextTopicId: z.string().nullable(), canStart: z.boolean(), canPause: z.boolean(),
    canResume: z.boolean(), canExtend: z.boolean(), canFinish: z.boolean()
  }),
  parking: z.object({
    entries: z.array(z.object({
      topicId: z.string(), parked: z.boolean(), canPark: z.boolean(), canRestore: z.boolean(),
      events: z.array(z.object({
        version: z.number().int().positive(), kind: z.enum(["PARK", "RESTORE"]), reason: z.string().max(4000),
        createdAt: z.iso.datetime(), actor: person, attemptNumber: z.number().int().positive().nullable()
      }))
    }))
  }),
  agendaOrder: z.object({
    future: z.array(z.object({
      topicId: z.string(), discussionPosition: z.number().int().positive(),
      originalPosition: z.number().int().positive(), count: z.number().int().nonnegative(), parked: z.boolean(),
      earlierTopicId: z.string().nullable(), laterTopicId: z.string().nullable(),
      canMoveEarlier: z.boolean(), canMoveLater: z.boolean()
    })),
    history: z.array(z.object({
      version: z.number().int().positive(), topicId: z.string(), neighborTopicId: z.string(),
      direction: z.enum(["EARLIER", "LATER"]), actor: person, createdAt: z.iso.datetime(),
      beforeQueue: z.array(z.string()).min(2), afterQueue: z.array(z.string()).min(2)
    }))
  }),
  summary: z.object({ report: summaryReportSchema.nullable(), canGenerate: z.boolean() }),
  administration: administrationSchema,
  actions: z.array(action), priorActions: z.array(action),
  reviews: z.array(z.object({ id: z.string(), actionId: z.string(), title: z.string(), note: z.string(), actor: z.string(), status: z.enum(["OPEN", "IN_PROGRESS", "DONE"]) }))
}).superRefine((view, ctx) => {
  const administration = view.administration;
  const joined = administration.viewerState === "ACTIVE";
  const facilitator = joined && view.facilitator.id === view.viewerId;
  const canAdminister = facilitator && view.state !== "CLOSED";
  const viewer = administration.entries.find(entry => entry.id === view.viewerId);
  const ids = new Set(administration.entries.filter(entry => entry.inTeam && entry.removedAt === null).map(entry => entry.id));
  const valid = view.joined === joined && view.facilitatorView === facilitator &&
    administration.canAdminister === canAdminister &&
    administration.canJoin === (administration.viewerState === "NOT_JOINED" && view.state !== "CLOSED") &&
    (administration.viewerState === "NOT_JOINED" ? !viewer : Boolean(viewer?.inTeam &&
      viewer.joinedAt === administration.joinedAt && viewer.removedAt === administration.removedAt)) &&
    view.participants.length === ids.size && new Set(view.participants.map(entry => entry.id)).size === ids.size &&
    view.participants.every(entry => ids.has(entry.id)) &&
    administration.entries.every(entry => entry.id !== view.viewerId || !entry.canTransfer && !entry.canRemove && !entry.canReadmit) &&
    administration.history.every(event => event.version <= view.lifecycleVersion) &&
    (joined || !view.voting.canVote) &&
    (canAdminister || !view.voting.canStart && !view.voting.canFinalize && !view.voting.canResume && !view.voting.canClose &&
      !view.discussion.canStart && !view.discussion.canPause && !view.discussion.canResume && !view.discussion.canExtend && !view.discussion.canFinish &&
      view.parking.entries.every(entry => !entry.canPark && !entry.canRestore) &&
      view.agendaOrder.future.every(entry => !entry.canMoveEarlier && !entry.canMoveLater)) &&
    (!view.summary.canGenerate || facilitator && view.state === "CLOSED" && view.summary.report === null);
  if (!valid) ctx.addIssue({ code: "custom", message: "Session permissions and participant history are inconsistent." });
});
export type SessionSnapshot = z.infer<typeof snapshotSchema>;
