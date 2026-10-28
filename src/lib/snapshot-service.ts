import "server-only";
import { db } from "./db";
import { sessionDetails, UserError, databaseNow } from "./service";
import { snapshotSchema } from "./session-snapshot";
import { rankTopics, VOTE_BUDGET } from "./voting";
import { discussionTiming } from "./discussion";
import { parkingProgress } from "./parking-lot";
import { validateOrderHistory } from "./agenda-order";
import { summaryReportSchema } from "./meeting-summary";
import { administrationView } from "./session-administration";

export async function sessionSnapshot(actorId: string, id: string) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const data = await sessionDetails(actorId, id, tx);
    if (data.session.kind !== "FACILITATED") throw new UserError("Session not found or access denied.", "denied");
    const facilitatorUser = await tx.user.findUniqueOrThrow({ where: { id: data.session.facilitatorId! }, select: { id: true, name: true } });
    const participants = await tx.sessionParticipant.findMany({ where: { sessionId: id }, include: { user: { select: { id: true, name: true } } }, orderBy: [{ joinedAt: "asc" }, { userId: "asc" }] });
    const topics = await tx.topic.findMany({ where: { sessionId: id }, include: {
        author: { select: { id: true, name: true } }, removedBy: { select: { id: true, name: true } }
      }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const participant = participants.find(item => item.userId === actorId);
    const activeParticipant = Boolean(participant && participant.removedAt === null);
    const counts = await tx.topicVote.groupBy({
      by: ["topicId"], where: { teamId: data.session.teamId, sessionId: id }, _count: { _all: true }
    });
    const countById = new Map(counts.map(item => [item.topicId, item._count._all]));
    const ownVotes = participant ? await tx.topicVote.findMany({
      where: { teamId: data.session.teamId, sessionId: id, userId: actorId }, select: { topicId: true },
      orderBy: { topicId: "asc" }
    }) : [];
    const active = topics.filter(topic => !topic.removedAt);
    const storedAgenda = data.session.votingState === "FINALIZED"
      ? await tx.agendaEntry.findMany({ where: { teamId: data.session.teamId, sessionId: id }, orderBy: { position: "asc" } }) : [];
    const agenda = data.session.votingState === "FINALIZED"
      ? storedAgenda.map(item => ({ topicId: item.topicId, position: item.position, count: item.voteCount }))
      : data.session.votingState === "OPEN"
        ? rankTopics(active.map(topic => ({ ...topic, count: countById.get(topic.id) ?? 0 }))) : [];
    const facilitatorView = data.session.facilitatorId === actorId && activeParticipant;
    const facilitator = facilitatorView && data.session.collectionState !== "CLOSED";
    const person = (user: { id: string; name: string | null }) => ({ id: user.id, name: user.name ?? "Team member" });
    const administrationEvents = await tx.sessionAdministrationEvent.findMany({
      where: { teamId: data.session.teamId, sessionId: id }, orderBy: { version: "asc" },
      include: { actor: { select: { id: true, name: true } }, target: { include: { user: { select: { id: true, name: true } } } } }
    });
    const memberIds = new Set(data.members.map(item => item.userId));
    const administration = administrationView({
      viewerId: actorId, facilitatorId: data.session.facilitatorId!, state: data.session.collectionState!,
      participants: participants.map(item => ({ ...person(item.user), joinedAt: item.joinedAt.toISOString(), removedAt: item.removedAt?.toISOString() ?? null })),
      memberIds, history: administrationEvents.map(item => ({
        version: item.version, kind: item.kind, actor: person(item.actor), target: person(item.target.user),
        createdAt: item.createdAt.toISOString(), reason: item.reason
      }))
    });
    const displayAction = (item: typeof data.actions[number]) => ({
      id: item.id, title: item.title, context: item.context, owner: item.owner.user.name ?? "Team member",
      dueDate: item.dueDate?.toISOString().slice(0, 10) ?? null, status: item.status,
      source: data.session.title, reviewed: false
    });
    const discussions = await tx.topicDiscussion.findMany({
      where: { teamId: data.session.teamId, sessionId: id },
      include: { startedBy: { select: { id: true, name: true } }, finishedBy: { select: { id: true, name: true } } }
    });
    const parkingEvents = await tx.topicParkingEvent.findMany({
      where: { teamId: data.session.teamId, sessionId: id }, include: { actor: { select: { id: true, name: true } } }
    });
    const progress = parkingProgress(storedAgenda, discussions, parkingEvents);
    const orderChanges = await tx.agendaOrderChange.findMany({
      where: { teamId: data.session.teamId, sessionId: id }, orderBy: { version: "asc" },
      include: { actor: { select: { id: true, name: true } } }
    });
    const agendaIds = new Set(storedAgenda.map(item => item.topicId));
    const savedSummary = await tx.sessionSummary.findUnique({ where: { sessionId: id } });
    const report = savedSummary ? summaryReportSchema.parse({
      formatVersion: savedSummary.formatVersion, generatedAt: savedSummary.generatedAt.toISOString(),
      generatedBy: { id: savedSummary.generatedById, name: savedSummary.generatedByName }, note: savedSummary.note, content: savedSummary.content
    }) : null;
    if (savedSummary && (savedSummary.teamId !== data.session.teamId || report?.content.session.id !== id)) {
      throw new Error("Stored meeting summary does not match the authorized source.");
    }
    const current = progress.current;
    const now = await databaseNow(tx);
    const timing = current ? discussionTiming(current, now) : null;
    return snapshotSchema.parse({
      id, title: data.session.title, state: data.session.collectionState,
      lifecycleVersion: data.session.lifecycleVersion, facilitator: person(facilitatorUser),
      viewerId: actorId, joined: activeParticipant, facilitatorView,
      participants: participants.filter(item => item.removedAt === null && memberIds.has(item.userId))
        .map(item => ({ ...person(item.user), joinedAt: item.joinedAt.toISOString() })),
      administration,
      members: data.members.map(item => person(item.user)),
      topics: topics.map(item => ({
        id: item.id, title: item.title, description: item.description, author: person(item.author),
        createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(), version: item.version,
        removedAt: item.removedAt?.toISOString() ?? null, removedBy: item.removedBy ? person(item.removedBy) : null
      })),
      voting: {
        state: data.session.votingState,
        startedAt: data.session.votingStartedAt?.toISOString() ?? null,
        finalizedAt: data.session.votingFinalizedAt?.toISOString() ?? null,
        budget: VOTE_BUDGET, ballotVersion: participant?.ballotVersion ?? null,
        selectedTopicIds: ownVotes.map(item => item.topicId),
        remaining: participant ? VOTE_BUDGET - ownVotes.length : null,
        counts: active.map(topic => ({ topicId: topic.id, count: countById.get(topic.id) ?? 0 })),
        agenda,
        canStart: facilitator && data.session.collectionState === "PAUSED" && data.session.votingState === "NOT_STARTED" && active.length > 0,
        canVote: activeParticipant && data.session.collectionState === "PAUSED" && data.session.votingState === "OPEN",
        canFinalize: facilitator && data.session.votingState === "OPEN",
        canResume: facilitator && data.session.collectionState === "PAUSED" && data.session.votingState === "NOT_STARTED",
        canClose: facilitator && data.session.votingState !== "OPEN" && !current
      },
      discussion: {
        sampledAt: now.toISOString(),
        current: current && timing ? {
          topicId: current.topicId, attemptNumber: current.attemptNumber, deadlineAt: current.deadlineAt?.toISOString() ?? null, ...timing
        } : null,
        entries: data.session.votingState === "FINALIZED" ? progress.entries.map(entry => ({
          topicId: entry.topicId, state: entry.current ? discussionTiming(entry.current, now).state : entry.state,
          attempts: entry.attempts.map(item => ({
            attemptNumber: item.attemptNumber, ...discussionTiming(item, now), outcome: item.outcome,
            deadlineAt: item.deadlineAt?.toISOString() ?? null, allocatedMs: item.allocatedMs,
            startedAt: item.startedAt.toISOString(), finishedAt: item.finishedAt?.toISOString() ?? null,
            startedBy: person(item.startedBy), finishedBy: item.finishedBy ? person(item.finishedBy) : null
          }))
        })) : [],
        allDiscussed: data.session.votingState === "FINALIZED" && progress.allDiscussed,
        nextTopicId: data.session.votingState === "FINALIZED" ? progress.nextTopicId : null,
        canStart: facilitator && data.session.votingState === "FINALIZED" && !current && Boolean(progress.nextTopicId),
        canPause: facilitator && timing?.state === "RUNNING",
        canResume: facilitator && timing?.state === "PAUSED",
        canExtend: facilitator && Boolean(current),
        canFinish: facilitator && Boolean(current)
      },
      parking: {
        entries: data.session.votingState === "FINALIZED" ? progress.entries.map(entry => ({
          topicId: entry.topicId, parked: entry.state === "PARKED",
          canPark: facilitator && entry.state !== "PARKED" && entry.state !== "FINISHED",
          canRestore: facilitator && entry.state === "PARKED",
          events: entry.events.map(event => ({
            version: event.version, kind: event.kind, reason: event.reason, createdAt: event.createdAt.toISOString(),
            actor: person(event.actor), attemptNumber: event.attemptNumber
          }))
        })) : []
      },
      agendaOrder: {
        future: progress.future.map((entry, index) => ({
          topicId: entry.topicId, discussionPosition: entry.discussionPosition, originalPosition: entry.position,
          count: entry.voteCount, parked: entry.state === "PARKED",
          earlierTopicId: progress.future[index - 1]?.topicId ?? null, laterTopicId: progress.future[index + 1]?.topicId ?? null,
          canMoveEarlier: facilitator && index > 0, canMoveLater: facilitator && index < progress.future.length - 1
        })),
        history: orderChanges.map(change => {
          const vectors = validateOrderHistory(change.beforeQueue, change.afterQueue, change.topicId, change.neighborTopicId, change.direction);
          if (!vectors.beforeQueue.every(topicId => agendaIds.has(topicId))) throw new Error("Stored agenda history contains an out-of-scope topic.");
          return {
            version: change.version, topicId: change.topicId, neighborTopicId: change.neighborTopicId,
            direction: change.direction, actor: person(change.actor), createdAt: change.createdAt.toISOString(), ...vectors
          };
        })
      },
      summary: {
        report, canGenerate: facilitatorView && data.session.collectionState === "CLOSED" && !report
      },
      actions: data.actions.map(displayAction),
      priorActions: data.priorActions.map(item => ({ ...displayAction(item), source: item.sourceSession.title, reviewed: Boolean(item.reviews.length) })),
      reviews: data.reviews.map(item => ({
        id: item.id, actionId: item.actionId, title: item.action.title, note: item.note,
        actor: item.actor.user.name ?? "Team member", status: item.resultingStatus
      }))
    });
  }, { isolationLevel: "RepeatableRead" });
}
