import "server-only";
import { db } from "./db";
import { sessionDetails, UserError } from "./service";
import { snapshotSchema } from "./session-snapshot";

export async function sessionSnapshot(actorId: string, id: string) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const data = await sessionDetails(actorId, id, tx);
    if (data.session.kind !== "FACILITATED") throw new UserError("Session not found or access denied.", "denied");
    const facilitator = await tx.user.findUniqueOrThrow({ where: { id: data.session.facilitatorId! }, select: { id: true, name: true } });
    const participants = await tx.sessionParticipant.findMany({ where: { sessionId: id }, include: { user: { select: { id: true, name: true } } }, orderBy: [{ joinedAt: "asc" }, { userId: "asc" }] });
    const topics = await tx.topic.findMany({ where: { sessionId: id }, include: {
        author: { select: { id: true, name: true } }, removedBy: { select: { id: true, name: true } }
      }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const person = (user: { id: string; name: string | null }) => ({ id: user.id, name: user.name ?? "Team member" });
    const displayAction = (item: typeof data.actions[number]) => ({
      id: item.id, title: item.title, context: item.context, owner: item.owner.user.name ?? "Team member",
      dueDate: item.dueDate?.toISOString().slice(0, 10) ?? null, status: item.status,
      source: data.session.title, reviewed: false
    });
    return snapshotSchema.parse({
      id, title: data.session.title, state: data.session.collectionState,
      lifecycleVersion: data.session.lifecycleVersion, facilitator: person(facilitator),
      viewerId: actorId, joined: participants.some(item => item.userId === actorId),
      facilitatorView: data.session.facilitatorId === actorId,
      participants: participants.map(item => ({ ...person(item.user), joinedAt: item.joinedAt.toISOString() })),
      members: data.members.map(item => person(item.user)),
      topics: topics.map(item => ({
        id: item.id, title: item.title, description: item.description, author: person(item.author),
        createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(), version: item.version,
        removedAt: item.removedAt?.toISOString() ?? null, removedBy: item.removedBy ? person(item.removedBy) : null
      })),
      actions: data.actions.map(displayAction),
      priorActions: data.priorActions.map(item => ({ ...displayAction(item), source: item.sourceSession.title, reviewed: Boolean(item.reviews.length) })),
      reviews: data.reviews.map(item => ({
        id: item.id, actionId: item.actionId, title: item.action.title, note: item.note,
        actor: item.actor.user.name ?? "Team member", status: item.resultingStatus
      }))
    });
  }, { isolationLevel: "RepeatableRead" });
}
