import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { actionInput, isEarlier, reviewInput, sessionInput } from "./rules";

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

async function member(actorId: string, teamId: string) {
  if (!actorId || !await db.membership.findUnique({ where: { teamId_userId: { teamId, userId: actorId } } })) {
    throw new UserError("You do not have access to this team.", "denied");
  }
}

async function authorizedSession(actorId: string, sessionId: string) {
  const session = await db.teamSession.findFirst({
    where: { id: sessionId, team: { memberships: { some: { userId: actorId || "__anonymous__" } } } }
  });
  if (!actorId || !session) throw new UserError("Session not found or access denied.", "denied");
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
  await member(actorId, data.teamId);
  return db.teamSession.create({ data });
}

export async function createAction(actorId: string, input: unknown) {
  const data = parse(actionInput, input);
  const session = await authorizedSession(actorId, data.sessionId);
  const owner = await db.membership.findUnique({
    where: { teamId_userId: { teamId: session.teamId, userId: data.ownerId } }
  });
  if (!owner) throw new UserError("Choose an owner who belongs to this team.");
  return db.action.create({
    data: {
      teamId: session.teamId, sourceSessionId: session.id,
      title: data.title, context: data.context, ownerId: data.ownerId,
      dueDate: data.dueDate ? new Date(`${data.dueDate}T00:00:00.000Z`) : null
    }
  });
}

export async function sessionDetails(actorId: string, sessionId: string) {
  const session = await authorizedSession(actorId, sessionId);
  const [members, actions, priorActions, reviews] = await Promise.all([
    db.membership.findMany({ where: { teamId: session.teamId }, include: { user: true }, orderBy: { userId: "asc" } }),
    db.action.findMany({ where: { sourceSessionId: session.id, teamId: session.teamId }, include: { owner: { include: { user: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    db.action.findMany({
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
    }),
    db.actionReview.findMany({
      where: { teamId: session.teamId, reviewSessionId: session.id },
      include: { action: true, actor: { include: { user: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    })
  ]);
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
  const session = await authorizedSession(actorId, data.sessionId);
  try {
    return await db.$transaction(async (tx) => {
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
