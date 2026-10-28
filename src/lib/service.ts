import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { actionInput, isEarlier, reviewInput, sessionInput, joinInput, topicInput, topicChangeInput, topicRemoveInput, lifecycleInput, canTransitionCollection } from "./rules";

export class UserError extends Error {
  constructor(message: string, public readonly kind: "validation" | "denied" | "conflict" = "validation") {
    super(message);
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new UserError(result.error.issues.map((issue) => issue.message).join(" "));
  return result.data;
}

async function member(actorId: string, teamId: string, tx: Prisma.TransactionClient) {
  const rows = actorId ? await tx.$queryRaw<{ userId: string }[]>`
    SELECT "userId" FROM "Membership" WHERE "teamId" = ${teamId} AND "userId" = ${actorId} FOR SHARE
  ` : [];
  if (!rows.length) {
    throw new UserError("You do not have access to this team.", "denied");
  }
}

async function authorizedSession(actorId: string, sessionId: string, tx: Prisma.TransactionClient = db) {
  const session = await tx.teamSession.findFirst({
    where: { id: sessionId, team: { memberships: { some: { userId: actorId || "__anonymous__" } } } }
  });
  if (!actorId || !session) throw new UserError("Session not found or access denied.", "denied");
  return session;
}

async function writableSession(tx: Prisma.TransactionClient, actorId: string, sessionId: string, joined = true) {
  const allowed = await authorizedSession(actorId, sessionId, tx);
  await tx.$queryRaw`SELECT "id" FROM "TeamSession" WHERE "id" = ${allowed.id} AND "teamId" = ${allowed.teamId} FOR UPDATE`;
  await member(actorId, allowed.teamId, tx);
  const session = await tx.teamSession.findUniqueOrThrow({ where: { id: allowed.id } });
  if (session.kind === "FACILITATED") {
    if (session.collectionState === "CLOSED") throw new UserError("This session is closed and read-only.", "conflict");
    if (joined && !await tx.sessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId: actorId } } })) {
      throw new UserError("Join this session before contributing.", "denied");
    }
  }
  return session;
}

export async function listTeams(actorId: string) {
  if (!actorId) throw new UserError("Sign in to continue.", "denied");
  return db.team.findMany({
    where: { memberships: { some: { userId: actorId } } },
    include: { sessions: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] } },
    orderBy: { name: "asc" }
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
    return tx.sessionParticipant.upsert({
      where: { sessionId_userId: { sessionId, userId: actorId } }, update: {},
      create: { teamId: session.teamId, sessionId, userId: actorId }
    });
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
    return tx.teamSession.update({ where: { id: session.id }, data: {
      collectionState: data.state, lifecycleVersion: { increment: 1 }, closedAt: data.state === "CLOSED" ? new Date() : null
    } });
  });
}

export async function createTopic(actorId: string, input: unknown) {
  const data = parse(topicInput, input);
  return db.$transaction(async tx => {
    const session = await writableSession(tx, actorId, data.sessionId);
    if (session.kind !== "FACILITATED" || session.collectionState !== "COLLECTING") throw new UserError("Topic collection is paused.", "conflict");
    return tx.topic.create({ data: { ...data, teamId: session.teamId, authorId: actorId } });
  });
}

export async function changeTopic(actorId: string, input: unknown, remove = false) {
  const data = remove ? parse(topicRemoveInput, input) : parse(topicChangeInput, input);
  return db.$transaction(async tx => {
    const session = await writableSession(tx, actorId, data.sessionId);
    if (session.kind !== "FACILITATED" || session.collectionState !== "COLLECTING") throw new UserError("Topic collection is paused.", "conflict");
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
