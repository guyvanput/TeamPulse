import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { actionInput, isEarlier, reviewInput, sessionInput, joinInput, topicInput, topicChangeInput, topicRemoveInput, lifecycleInput, canTransitionCollection, voteInput, votingLifecycleInput } from "./rules";
import { rankTopics, VOTE_BUDGET } from "./voting";
import { discussionInput, discussionOperation, parkInput, restoreInput, parkingOperation, moveAgendaInput, generateSummaryInput,
  administrationInput, removalInput, administrationOperation } from "./rules";
import { beginDiscussion, changeDiscussionTiming, DiscussionError, type DiscussionOperation } from "./discussion";
import { parkingProgress, nextAttemptNumber, ParkingError } from "./parking-lot";
import { planAgendaMove, AgendaOrderError } from "./agenda-order";
import { buildSummaryContent } from "./meeting-summary";
import {
  HISTORY_PAGE_SIZE, HistoryCursorError, decodeHistoryCursor, encodeHistoryCursor, historyFilterSchema, historyLifecycle,
  historyPageSchema, type HistoryPage
} from "./session-history";

export class UserError extends Error {
  constructor(message: string, public readonly kind: "validation" | "denied" | "conflict" = "validation") {
    super(message);
  }
}

function incrementable(version: number) {
  if (version >= 2147483647) throw new UserError("The change version is exhausted. Ask the operator to investigate.", "conflict");
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new UserError(result.error.issues.map((issue) => issue.message).join(" "));
  return result.data;
}

export async function databaseNow(tx: Prisma.TransactionClient) {
  const [sample] = await tx.$queryRaw<{ milliseconds: bigint }[]>`
    SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS milliseconds
  `;
  if (!sample) throw new Error("Database clock sample unavailable.");
  const milliseconds = Number(sample.milliseconds);
  if (!Number.isSafeInteger(milliseconds) || !Number.isFinite(new Date(milliseconds).getTime())) {
    throw new Error("Database clock sample outside the supported range.");
  }
  return new Date(milliseconds);
}

async function member(actorId: string, teamId: string, tx: Prisma.TransactionClient, message = "You do not have access to this team.") {
  const rows = actorId ? await tx.$queryRaw<{ userId: string }[]>`
    SELECT "userId" FROM "Membership" WHERE "teamId" = ${teamId} AND "userId" = ${actorId} FOR SHARE
  ` : [];
  if (!rows.length) {
    throw new UserError(message, "denied");
  }
}

async function authorizedSession(actorId: string, sessionId: string, tx: Prisma.TransactionClient = db) {
  const session = await tx.teamSession.findFirst({
    where: { id: sessionId, team: { memberships: { some: { userId: actorId || "__anonymous__" } } } }
  });
  if (!actorId || !session) throw new UserError("Session not found or access denied.", "denied");
  return session;
}

async function activeParticipant(tx: Prisma.TransactionClient, actorId: string, sessionId: string) {
  const participant = await tx.sessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId: actorId } } });
  if (!participant || participant.removedAt !== null) {
    throw new UserError(participant ? "Your participation was removed. The facilitator must readmit you before contributing." : "Join this session before contributing.", "denied");
  }
  return participant;
}

async function writableSession(tx: Prisma.TransactionClient, actorId: string, sessionId: string, joined = true) {
  const allowed = await authorizedSession(actorId, sessionId, tx);
  await tx.$queryRaw`SELECT "id" FROM "TeamSession" WHERE "id" = ${allowed.id} AND "teamId" = ${allowed.teamId} FOR UPDATE`;
  await member(actorId, allowed.teamId, tx);
  const session = await tx.teamSession.findUniqueOrThrow({ where: { id: allowed.id } });
  if (session.kind === "FACILITATED") {
    if (session.collectionState === "CLOSED") throw new UserError("This session is closed and read-only.", "conflict");
    if (joined) await activeParticipant(tx, actorId, sessionId);
  }
  return session;
}

export async function listTeams(actorId: string) {
  if (!actorId) throw new UserError("Sign in to continue.", "denied");
  return db.team.findMany({
    where: { memberships: { some: { userId: actorId } } },
    orderBy: { name: "asc" }
  });
}

const historyInput = z.object({
  teamId: z.string().min(1).max(100),
  filter: historyFilterSchema.default("ALL"),
  cursor: z.string().optional()
}).strict();

export async function listSessionHistory(actorId: string, input: unknown): Promise<HistoryPage> {
  const data = parse(historyInput, input);
  const allowed = actorId ? await db.membership.findFirst({ where: { teamId: data.teamId, userId: actorId }, select: { userId: true } }) : null;
  if (!allowed) throw new UserError("Team not found or access denied.", "denied");
  let position: ReturnType<typeof decodeHistoryCursor> | undefined;
  if (data.cursor !== undefined) {
    try { position = decodeHistoryCursor(data.cursor); }
    catch (error) { if (error instanceof HistoryCursorError) throw new UserError(error.message); throw error; }
  }
  const lifecycle: Prisma.TeamSessionWhereInput =
    data.filter === "CLOSED" ? { kind: "FACILITATED", collectionState: "CLOSED" }
    : data.filter === "IN_PROGRESS" ? { kind: "FACILITATED", OR: [{ collectionState: null }, { collectionState: { not: "CLOSED" } }] }
    : {};
  const keyset: Prisma.TeamSessionWhereInput = position
    ? { OR: [{ createdAt: { lt: position.createdAt } }, { createdAt: position.createdAt, id: { lt: position.id } }] }
    : {};
  const found = await db.teamSession.findMany({
    where: { teamId: data.teamId, AND: [lifecycle, keyset] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: HISTORY_PAGE_SIZE + 1,
    select: {
      id: true, title: true, createdAt: true, kind: true, collectionState: true, votingState: true,
      facilitator: { select: { name: true } },
      summary: { select: { sessionId: true } },
      _count: { select: { topics: { where: { removedAt: null } }, actions: { where: { status: { not: "DONE" } } } } }
    }
  });
  const kept = found.slice(0, HISTORY_PAGE_SIZE);
  const last = kept[kept.length - 1];
  return historyPageSchema.parse({
    filter: data.filter,
    nextCursor: found.length > HISTORY_PAGE_SIZE && last ? encodeHistoryCursor(last) : null,
    rows: kept.map((row) => {
      const state = historyLifecycle(row);
      const facilitated = row.kind === "FACILITATED";
      return {
        id: row.id, title: row.title, createdAt: row.createdAt.toISOString(), kind: row.kind, lifecycle: state,
        facilitatorName: facilitated ? row.facilitator?.name ?? "Team member" : null,
        topicCount: facilitated ? row._count.topics : null,
        openActionCount: row._count.actions,
        summaryAvailable: state === "CLOSED" ? row.summary !== null : null
      };
    })
  });
}

export async function createSession(actorId: string, input: unknown) {
  const data = parse(sessionInput, input);
  return db.$transaction(async tx => {
    await member(actorId, data.teamId, tx);
    return tx.teamSession.create({ data });
  });
}

export async function createFacilitatedSession(actorId: string, input: unknown) {
  const data = parse(sessionInput, input);
  return db.$transaction(async tx => {
    await member(actorId, data.teamId, tx);
    const session = await tx.teamSession.create({ data: {
      ...data, kind: "FACILITATED", facilitatorId: actorId, collectionState: "COLLECTING"
    } });
    await tx.sessionParticipant.create({ data: { teamId: session.teamId, sessionId: session.id, userId: actorId } });
    return session;
  });
}

export async function joinSession(actorId: string, input: unknown) {
  const { sessionId } = parse(joinInput, input);
  return db.$transaction(async tx => {
    const session = await writableSession(tx, actorId, sessionId, false);
    if (session.kind !== "FACILITATED") throw new UserError("This is an action-follow-up session.");
    const existing = await tx.sessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId: actorId } } });
    if (existing?.removedAt) throw new UserError("Your participation was removed. The facilitator must readmit you before rejoining.", "denied");
    return existing ?? tx.sessionParticipant.create({ data: { teamId: session.teamId, sessionId, userId: actorId } });
  });
}

export async function administerSession(actorId: string, input: unknown, operation: "transfer" | "remove" | "readmit") {
  const command = parse(administrationOperation, operation);
  const data = command === "remove" ? parse(removalInput, input) : { ...parse(administrationInput, input), reason: "" };
  return db.$transaction(async tx => {
    const session = await writableSession(tx, actorId, data.sessionId);
    if (session.kind !== "FACILITATED") throw new UserError("Administration requires a facilitated session.", "conflict");
    if (session.facilitatorId !== actorId) throw new UserError("Only the current facilitator can administer participants.", "denied");
    if (session.lifecycleVersion !== data.version) throw new UserError("Session changed. Refresh and reconcile before administering participants.", "conflict");
    if (actorId === data.targetId) throw new UserError("Choose another participant; hand over before someone else removes you.");
    incrementable(session.lifecycleVersion);
    await member(data.targetId, session.teamId, tx, "The selected person is not a current member of this team.");
    const target = await tx.sessionParticipant.findUnique({ where: { sessionId_userId: { sessionId: session.id, userId: data.targetId } } });
    if (!target || target.teamId !== session.teamId) throw new UserError("The selected person has not joined this session.", "denied");
    if ((command === "readmit") !== (target.removedAt !== null)) throw new UserError("Participant state changed. Refresh and review before continuing.", "conflict");
    const now = await databaseNow(tx);
    if (command !== "transfer") await tx.sessionParticipant.update({
      where: { sessionId_userId: { sessionId: session.id, userId: data.targetId } },
      data: { removedAt: command === "remove" ? now : null }
    });
    await tx.teamSession.update({ where: { id: session.id }, data: {
      lifecycleVersion: { increment: 1 }, ...(command === "transfer" ? { facilitatorId: data.targetId } : {})
    } });
    return tx.sessionAdministrationEvent.create({ data: {
      teamId: session.teamId, sessionId: session.id, version: session.lifecycleVersion + 1,
      kind: command === "transfer" ? "TRANSFER" : command === "remove" ? "REMOVE" : "READMIT",
      actorId, targetId: data.targetId, createdAt: now, reason: data.reason
    } });
  });
}

export async function changeCollection(actorId: string, input: unknown) {
  const data = parse(lifecycleInput, input);
  return db.$transaction(async tx => {
    const session = await writableSession(tx, actorId, data.sessionId);
    if (session.facilitatorId !== actorId) throw new UserError("Only the facilitator can control collection.", "denied");
    if (session.lifecycleVersion !== data.version || !session.collectionState || !canTransitionCollection(session.collectionState, data.state)) {
      throw new UserError("Collection changed. Refresh and try again.", "conflict");
    }
    if (session.votingState !== "NOT_STARTED" && data.state === "COLLECTING") {
      throw new UserError("Topics are locked after voting starts. Collection cannot resume.", "conflict");
    }
    if (session.votingState === "OPEN" && data.state === "CLOSED") {
      throw new UserError("Finish voting first, then close the session.", "conflict");
    }
    if (data.state === "CLOSED" && await tx.topicDiscussion.count({
      where: { sessionId: session.id, state: { in: ["RUNNING", "PAUSED"] } }
    })) {
      throw new UserError("Finish or park the current discussion first, then close the session.", "conflict");
    }
    incrementable(session.lifecycleVersion);
    return tx.teamSession.update({ where: { id: session.id }, data: {
      collectionState: data.state, lifecycleVersion: { increment: 1 }, closedAt: data.state === "CLOSED" ? new Date() : null
    } });
  });
}

export async function createTopic(actorId: string, input: unknown) {
  const data = parse(topicInput, input);
  return db.$transaction(async tx => {
    const session = await writableSession(tx, actorId, data.sessionId);
    if (session.kind !== "FACILITATED" || session.collectionState !== "COLLECTING" || session.votingState !== "NOT_STARTED") throw new UserError("Topic collection is paused.", "conflict");
    return tx.topic.create({ data: { ...data, teamId: session.teamId, authorId: actorId } });
  });
}

export async function changeTopic(actorId: string, input: unknown, remove = false) {
  const data = remove ? parse(topicRemoveInput, input) : parse(topicChangeInput, input);
  return db.$transaction(async tx => {
    const session = await writableSession(tx, actorId, data.sessionId);
    if (session.kind !== "FACILITATED" || session.collectionState !== "COLLECTING" || session.votingState !== "NOT_STARTED") throw new UserError("Topic collection is paused.", "conflict");
    const topic = await tx.topic.findFirst({ where: { id: data.topicId, sessionId: session.id, teamId: session.teamId } });
    if (!topic) throw new UserError("Topic not found or access denied.", "denied");
    if (topic.authorId !== actorId && session.facilitatorId !== actorId) throw new UserError("Only the author or facilitator can manage this topic.", "denied");
    if (topic.version !== data.version || topic.removedAt) {
      throw new UserError("Topic changed or was removed. Your draft was not saved; refresh and reconcile it.", "conflict");
    }
    const update = await tx.topic.updateMany({
      where: { id: topic.id, version: data.version, removedAt: null },
      data: remove ? { removedAt: new Date(), removedById: actorId, version: { increment: 1 } }
        : { ...parse(topicInput, input), version: { increment: 1 } }
    });
    if (!update.count) throw new UserError("Topic changed or was removed. Your draft was not saved; refresh and reconcile it.", "conflict");
  });
}

async function votingControl(tx: Prisma.TransactionClient, actorId: string, sessionId: string, version: number, expected: "NOT_STARTED" | "OPEN") {
  const session = await writableSession(tx, actorId, sessionId);
  if (session.kind !== "FACILITATED") throw new UserError("Voting is only available in facilitated sessions.", "conflict");
  if (session.facilitatorId !== actorId) throw new UserError("Only the facilitator can control voting.", "denied");
  if (session.collectionState !== "PAUSED" || session.votingState !== expected || session.lifecycleVersion !== version) {
    throw new UserError("Voting or collection changed. Refresh and reconcile before continuing.", "conflict");
  }
  incrementable(session.lifecycleVersion);
  return session;
}

export async function startVoting(actorId: string, input: unknown) {
  const data = parse(votingLifecycleInput, input);
  return db.$transaction(async tx => {
    const session = await votingControl(tx, actorId, data.sessionId, data.version, "NOT_STARTED");
    if (!await tx.topic.count({ where: { teamId: session.teamId, sessionId: session.id, removedAt: null } })) {
      throw new UserError("Add at least one active topic before starting voting.");
    }
    return tx.teamSession.update({ where: { id: session.id }, data: {
      votingState: "OPEN", votingStartedAt: new Date(), lifecycleVersion: { increment: 1 }
    } });
  });
}

export async function setTopicVote(actorId: string, input: unknown) {
  const data = parse(voteInput, input);
  return db.$transaction(async tx => {
    const session = await writableSession(tx, actorId, data.sessionId);
    if (session.kind !== "FACILITATED" || session.collectionState !== "PAUSED" || session.votingState !== "OPEN") {
      throw new UserError("Voting is not open. Refresh and check the session.", "conflict");
    }
    const participant = await tx.sessionParticipant.findUniqueOrThrow({
      where: { sessionId_userId: { sessionId: session.id, userId: actorId } }
    });
    if (participant.ballotVersion !== data.version) {
      throw new UserError("Your ballot changed. Refresh and reconcile your selections before retrying.", "conflict");
    }
    const topic = await tx.topic.findFirst({
      where: { id: data.topicId, teamId: session.teamId, sessionId: session.id, removedAt: null }
    });
    if (!topic) throw new UserError("Topic not found or access denied.", "denied");
    const selections = await tx.topicVote.findMany({
      where: { teamId: session.teamId, sessionId: session.id, userId: actorId }, select: { topicId: true }
    });
    const selected = selections.some(item => item.topicId === topic.id);
    if (selected === data.selected) return;
    if (data.selected && selections.length >= VOTE_BUDGET) {
      throw new UserError("You have used all three votes. Remove a selection before choosing another topic.");
    }
    incrementable(participant.ballotVersion);
    if (data.selected) {
      await tx.topicVote.create({ data: { teamId: session.teamId, sessionId: session.id, userId: actorId, topicId: topic.id } });
    } else {
      await tx.topicVote.delete({ where: { sessionId_userId_topicId: { sessionId: session.id, userId: actorId, topicId: topic.id } } });
    }
    await tx.sessionParticipant.update({
      where: { sessionId_userId: { sessionId: session.id, userId: actorId } },
      data: { ballotVersion: { increment: 1 } }
    });
  });
}

export async function finalizeVoting(actorId: string, input: unknown) {
  const data = parse(votingLifecycleInput, input);
  return db.$transaction(async tx => {
    const session = await votingControl(tx, actorId, data.sessionId, data.version, "OPEN");
    const topics = await tx.topic.findMany({
      where: { teamId: session.teamId, sessionId: session.id, removedAt: null }, select: { id: true, createdAt: true }
    });
    const counts = await tx.topicVote.groupBy({
      by: ["topicId"], where: { teamId: session.teamId, sessionId: session.id }, _count: { _all: true }
    });
    const countById = new Map(counts.map(item => [item.topicId, item._count._all]));
    const agenda = rankTopics(topics.map(topic => ({ ...topic, count: countById.get(topic.id) ?? 0 })));
    await tx.agendaEntry.createMany({ data: agenda.map(item => ({
      teamId: session.teamId, sessionId: session.id, topicId: item.topicId, position: item.position,
      discussionPosition: item.position, voteCount: item.count
    })) });
    return tx.teamSession.update({ where: { id: session.id }, data: {
      votingState: "FINALIZED", votingFinalizedAt: new Date(), lifecycleVersion: { increment: 1 }
    } });
  });
}

async function discussionControl(tx: Prisma.TransactionClient, actorId: string, data: { sessionId: string; version: number }) {
    const session = await writableSession(tx, actorId, data.sessionId);
    if (session.kind !== "FACILITATED") throw new UserError("Discussion requires a facilitated session.", "conflict");
    if (session.facilitatorId !== actorId) throw new UserError("Only the facilitator can control discussion.", "denied");
    if (session.collectionState !== "PAUSED" || session.votingState !== "FINALIZED" || session.lifecycleVersion !== data.version) {
      throw new UserError("Discussion or session changed. Refresh and reconcile before continuing.", "conflict");
    }
    incrementable(session.lifecycleVersion);
    return session;
}

async function storedProgress(tx: Prisma.TransactionClient, teamId: string, sessionId: string) {
  const where = { teamId, sessionId };
  const agenda = await tx.agendaEntry.findMany({ where, orderBy: { position: "asc" } });
  const attempts = await tx.topicDiscussion.findMany({ where });
  const events = await tx.topicParkingEvent.findMany({ where });
  return parkingProgress(agenda, attempts, events);
}

export async function controlDiscussion(actorId: string, input: unknown, operation: "start" | DiscussionOperation) {
  const data = parse(discussionInput, input);
  const command = parse(discussionOperation, operation);
  return db.$transaction(async tx => {
    const session = await discussionControl(tx, actorId, data);
    const progress = await storedProgress(tx, session.teamId, session.id);
    const current = progress.current;
    if (command === "start") {
      if (current) throw new UserError("Finish or park the current discussion before starting another topic.", "conflict");
      const next = progress.entries.find(item => item.topicId === progress.nextTopicId);
      if (!next || next.topicId !== data.topicId) throw new UserError("Start the next eligible not-discussed topic in agenda order.", "conflict");
      let attemptNumber: number;
      try { attemptNumber = nextAttemptNumber(next.attempts); }
      catch (error) {
        if (error instanceof ParkingError) throw new UserError(error.message, "conflict");
        throw error;
      }
      const now = await databaseNow(tx);
      await tx.topicDiscussion.create({ data: {
        teamId: session.teamId, sessionId: session.id, topicId: next.topicId, attemptNumber,
        ...beginDiscussion(now), startedAt: now, startedById: actorId
      } });
    } else {
      if (!current || current.topicId !== data.topicId) throw new UserError("The current topic changed or is finished. Refresh and reconcile.", "conflict");
      const now = await databaseNow(tx);
      try {
        const timing = changeDiscussionTiming(current, command, now);
        await tx.topicDiscussion.update({
          where: { teamId_sessionId_topicId_attemptNumber: {
            teamId: session.teamId, sessionId: session.id, topicId: current.topicId, attemptNumber: current.attemptNumber
          }, state: { in: ["RUNNING", "PAUSED"] } },
          data: { ...timing, ...(command === "finish" ? { finishedAt: now, finishedById: actorId, outcome: "DISCUSSED" } : {}) }
        });
      } catch (error) {
        if (error instanceof DiscussionError) throw new UserError(error.message, "conflict");
        throw error;
      }
    }
    await tx.teamSession.update({ where: { id: session.id }, data: { lifecycleVersion: { increment: 1 } } });
  });
}

export async function controlParking(actorId: string, input: unknown, operation: "park" | "restore") {
  const command = parse(parkingOperation, operation);
  const data = command === "park" ? parse(parkInput, input) : { ...parse(restoreInput, input), reason: "" };
  return db.$transaction(async tx => {
    const session = await discussionControl(tx, actorId, data);
    const progress = await storedProgress(tx, session.teamId, session.id);
    const entry = progress.entries.find(item => item.topicId === data.topicId);
    if (!entry || !await tx.topic.count({ where: { id: data.topicId, teamId: session.teamId, sessionId: session.id, removedAt: null } })) {
      throw new UserError("Topic not found or access denied.", "denied");
    }
    if (entry.state === "FINISHED" || (command === "park" ? entry.state === "PARKED" : entry.state !== "PARKED")) {
      throw new UserError("Topic or parking state changed. Refresh and reconcile before continuing.", "conflict");
    }
    const now = await databaseNow(tx);
    if (command === "park" && entry.current) {
      const timing = changeDiscussionTiming(entry.current, "finish", now);
      await tx.topicDiscussion.update({
        where: { teamId_sessionId_topicId_attemptNumber: {
          teamId: session.teamId, sessionId: session.id, topicId: entry.topicId, attemptNumber: entry.current.attemptNumber
        }, state: { in: ["RUNNING", "PAUSED"] } },
        data: { ...timing, outcome: "DEFERRED", finishedAt: now, finishedById: actorId }
      });
    }
    await tx.topicParkingEvent.create({ data: {
      teamId: session.teamId, sessionId: session.id, topicId: entry.topicId, version: session.lifecycleVersion + 1,
      kind: command === "park" ? "PARK" : "RESTORE",
      reason: data.reason, actorId, createdAt: now,
      attemptNumber: command === "park" ? entry.current?.attemptNumber ?? null : null
    } });
    await tx.teamSession.update({ where: { id: session.id }, data: { lifecycleVersion: { increment: 1 } } });
  });
}

export async function moveAgendaTopic(actorId: string, input: unknown) {
  const data = parse(moveAgendaInput, input);
  return db.$transaction(async tx => {
    const session = await discussionControl(tx, actorId, data);
    if (await tx.topic.count({ where: {
      teamId: session.teamId, sessionId: session.id, id: { in: [data.topicId, data.neighborTopicId] }, removedAt: null
    } }) !== 2) throw new UserError("Topic not found or access denied.", "denied");
    const progress = await storedProgress(tx, session.teamId, session.id);
    let planned: ReturnType<typeof planAgendaMove<typeof progress.future[number]>>;
    try { planned = planAgendaMove(progress.future, data.topicId, data.neighborTopicId, data.direction); }
    catch (error) {
      if (error instanceof AgendaOrderError) throw new UserError(error.message, "conflict");
      throw error;
    }
    const now = await databaseNow(tx);
    await tx.$executeRaw`SET CONSTRAINTS "AgendaEntry_sessionId_discussionPosition_key" DEFERRED`;
    const changed = await tx.$executeRaw`
      UPDATE "AgendaEntry" SET "discussionPosition" = CASE WHEN "topicId" = ${data.topicId}
        THEN ${planned.neighbor.discussionPosition}::integer ELSE ${planned.topic.discussionPosition}::integer END
      WHERE "teamId" = ${session.teamId} AND "sessionId" = ${session.id}
        AND "topicId" IN (${data.topicId}, ${data.neighborTopicId})
    `;
    if (changed !== 2) throw new UserError("Agenda changed. Refresh and reconcile before moving.", "conflict");
    await tx.agendaOrderChange.create({ data: {
      teamId: session.teamId, sessionId: session.id, version: session.lifecycleVersion + 1,
      actorId, createdAt: now, topicId: data.topicId, neighborTopicId: data.neighborTopicId,
      direction: data.direction === "earlier" ? "EARLIER" : "LATER", beforeQueue: planned.beforeQueue, afterQueue: planned.afterQueue
    } });
    await tx.teamSession.update({ where: { id: session.id }, data: { lifecycleVersion: { increment: 1 } } });
    await tx.$executeRaw`SET CONSTRAINTS "AgendaEntry_sessionId_discussionPosition_key" IMMEDIATE`;
  });
}

export async function createAction(actorId: string, input: unknown) {
  const data = parse(actionInput, input);
  return db.$transaction(async tx => {
    const session = await writableSession(tx, actorId, data.sessionId);
    const owner = await tx.membership.findUnique({
      where: { teamId_userId: { teamId: session.teamId, userId: data.ownerId } }
    });
    if (!owner) throw new UserError("Choose an owner who belongs to this team.");
    return tx.action.create({
      data: {
        teamId: session.teamId, sourceSessionId: session.id,
        title: data.title, context: data.context, ownerId: data.ownerId,
        dueDate: data.dueDate ? new Date(`${data.dueDate}T00:00:00.000Z`) : null
      }
    });
  });
}

export async function generateMeetingSummary(actorId: string, input: unknown) {
  const data = parse(generateSummaryInput, input);
  try {
    return await db.$transaction(async tx => {
      const generatedAt = await databaseNow(tx);
      const allowed = await authorizedSession(actorId, data.sessionId, tx);
      await tx.$queryRaw`SELECT "id" FROM "TeamSession" WHERE "id"=${allowed.id} AND "teamId"=${allowed.teamId} FOR UPDATE`;
      await member(actorId, allowed.teamId, tx);
      const session = await tx.teamSession.findUniqueOrThrow({ where: { id: allowed.id } });
      if (session.kind !== "FACILITATED") throw new UserError("Summary generation requires a facilitated session.", "conflict");
      if (session.facilitatorId !== actorId) throw new UserError("Only the facilitator can generate a summary.", "denied");
      await activeParticipant(tx, actorId, session.id);
      if (session.collectionState !== "CLOSED" || session.lifecycleVersion !== data.version) {
        throw new UserError("Session changed or is not closed. Refresh before generating a summary.", "conflict");
      }
      if (await tx.sessionSummary.findUnique({ where: { sessionId: session.id } })) {
        throw new UserError("A summary already exists. Review the saved report; your note cannot replace it.", "conflict");
      }
      const safePerson = { id: true, name: true } satisfies Prisma.UserSelect;
      const person = (user: { id: string; name: string | null }) => ({ id: user.id, name: user.name ?? "Team member" });
      const generator = person(await tx.user.findUniqueOrThrow({ where: { id: actorId }, select: safePerson }));
      const scope = { teamId: session.teamId, sessionId: session.id };
      const participants = await tx.sessionParticipant.findMany({
        where: scope, include: { user: { select: safePerson } }, orderBy: [{ joinedAt: "asc" }, { userId: "asc" }]
      });
      const topics = await tx.topic.findMany({ where: scope, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      const agenda = await tx.agendaEntry.findMany({ where: scope, orderBy: { position: "asc" } });
      const attempts = await tx.topicDiscussion.findMany({ where: scope });
      const events = await tx.topicParkingEvent.findMany({ where: scope });
      const actions = await tx.action.findMany({
        where: { teamId: session.teamId, OR: [{ sourceSessionId: session.id }, { reviews: { some: { reviewSessionId: session.id, teamId: session.teamId } } }] },
        include: {
          sourceSession: { select: { id: true, title: true } }, owner: { include: { user: { select: safePerson } } },
          reviews: { where: { reviewSessionId: session.id, teamId: session.teamId }, include: { actor: { include: { user: { select: safePerson } } } },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }] }
        }, orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      });
      const content = buildSummaryContent({
        session: { id: session.id, title: session.title, facilitator: generator, state: session.collectionState, votingState: session.votingState },
        participants: participants.map(item => ({ ...person(item.user), joinedAt: item.joinedAt.toISOString() })),
        topics: topics.map(item => ({ id: item.id, title: item.title, description: item.description, removedAt: item.removedAt?.toISOString() ?? null })),
        agenda, attempts, events,
        actions: actions.map(item => ({
          id: item.id, title: item.title, context: item.context, owner: person(item.owner.user),
          dueDate: item.dueDate?.toISOString().slice(0, 10) ?? null, status: item.status,
          source: item.sourceSession, createdHere: item.sourceSessionId === session.id,
          reviews: item.reviews.map(review => ({
            id: review.id, actor: person(review.actor.user), createdAt: review.createdAt.toISOString(),
            note: review.note, resultingStatus: review.resultingStatus
          }))
        }))
      });
      return tx.sessionSummary.create({ data: {
        ...scope, generatedById: actorId, generatedByName: generator.name, generatedAt, formatVersion: 1, note: data.note, content
      } });
    }, { isolationLevel: "RepeatableRead" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034" ||
        (error.code === "P2010" && z.object({
          driverAdapterError: z.object({ cause: z.object({ kind: z.literal("TransactionWriteConflict"), originalCode: z.literal("40001") }) })
        }).safeParse(error.meta).success))) {
      throw new UserError("Summary creation changed or conflicted. Refresh and review any saved report before retrying; your note is retained.", "conflict");
    }
    throw error;
  }
}

export async function sessionDetails(actorId: string, sessionId: string, tx: Prisma.TransactionClient = db) {
  const session = await authorizedSession(actorId, sessionId, tx);
  const members = await tx.membership.findMany({ where: { teamId: session.teamId }, include: { user: true }, orderBy: { userId: "asc" } });
  const actions = await tx.action.findMany({ where: { sourceSessionId: session.id, teamId: session.teamId }, include: { owner: { include: { user: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const priorActions = await tx.action.findMany({
      where: {
        teamId: session.teamId, status: { not: "DONE" },
        sourceSession: { OR: [
          { createdAt: { lt: session.createdAt } },
          { createdAt: session.createdAt, id: { lt: session.id } }
        ] }
      },
      include: {
        sourceSession: true, owner: { include: { user: true } },
        reviews: { where: { reviewSessionId: session.id } }
      },
      orderBy: [{ sourceSession: { createdAt: "asc" } }, { sourceSessionId: "asc" }, { createdAt: "asc" }, { id: "asc" }]
    });
  const reviews = await tx.actionReview.findMany({
      where: { teamId: session.teamId, reviewSessionId: session.id },
      include: { action: true, actor: { include: { user: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
  return { session, members, actions, priorActions, reviews };
}

export async function actionDetails(actorId: string, actionId: string) {
  const action = await db.action.findFirst({
    where: { id: actionId, sourceSession: { team: { memberships: { some: { userId: actorId || "__anonymous__" } } } } },
    include: {
      sourceSession: true, owner: { include: { user: true } },
      reviews: { include: { reviewSession: true, actor: { include: { user: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }
    }
  });
  if (!actorId || !action) throw new UserError("Action not found or access denied.", "denied");
  return action;
}

export async function reviewAction(actorId: string, input: unknown) {
  const data = parse(reviewInput, input);
  try {
    return await db.$transaction(async (tx) => {
      const session = await writableSession(tx, actorId, data.sessionId);
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Action" WHERE "id" = ${data.actionId} AND "teamId" = ${session.teamId} FOR UPDATE
      `;
      if (!locked.length) throw new UserError("Action not found or access denied.", "denied");
      const action = await tx.action.findUniqueOrThrow({ where: { id: data.actionId }, include: { sourceSession: true } });
      if (!isEarlier(action.sourceSession, session)) throw new UserError("Only actions from an earlier session can be reviewed.");
      if (await tx.actionReview.findUnique({ where: { actionId_reviewSessionId: { actionId: action.id, reviewSessionId: session.id } } })) {
        throw new UserError("This action was already reviewed in this session.", "conflict");
      }
      if (action.status === "DONE") throw new UserError("This action is already done.", "conflict");
      const review = await tx.actionReview.create({
        data: { teamId: session.teamId, actionId: action.id, reviewSessionId: session.id, actorId, note: data.note, resultingStatus: data.status }
      });
      await tx.action.update({ where: { id: action.id }, data: { status: data.status } });
      return review;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new UserError("This action was already reviewed in this session.", "conflict");
    }
    throw error;
  }
}
