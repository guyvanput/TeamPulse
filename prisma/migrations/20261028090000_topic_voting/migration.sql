-- CreateEnum
CREATE TYPE "VotingState" AS ENUM ('NOT_STARTED', 'OPEN', 'FINALIZED');

-- AlterTable
ALTER TABLE "TeamSession" ADD COLUMN     "votingFinalizedAt" TIMESTAMP(3),
ADD COLUMN     "votingStartedAt" TIMESTAMP(3),
ADD COLUMN     "votingState" "VotingState" NOT NULL DEFAULT 'NOT_STARTED';

-- AlterTable
ALTER TABLE "SessionParticipant" ADD COLUMN     "ballotVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "TopicVote" (
    "teamId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TopicVote_pkey" PRIMARY KEY ("sessionId","userId","topicId")
);

-- CreateTable
CREATE TABLE "AgendaEntry" (
    "teamId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "voteCount" INTEGER NOT NULL,

    CONSTRAINT "AgendaEntry_pkey" PRIMARY KEY ("sessionId","topicId")
);

-- CreateIndex
CREATE INDEX "TopicVote_teamId_sessionId_topicId_idx" ON "TopicVote"("teamId", "sessionId", "topicId");

-- CreateIndex
CREATE UNIQUE INDEX "AgendaEntry_sessionId_position_key" ON "AgendaEntry"("sessionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SessionParticipant_teamId_sessionId_userId_key" ON "SessionParticipant"("teamId", "sessionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_teamId_sessionId_id_key" ON "Topic"("teamId", "sessionId", "id");

-- AddForeignKey
ALTER TABLE "TopicVote" ADD CONSTRAINT "TopicVote_teamId_sessionId_userId_fkey" FOREIGN KEY ("teamId", "sessionId", "userId") REFERENCES "SessionParticipant"("teamId", "sessionId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicVote" ADD CONSTRAINT "TopicVote_teamId_sessionId_topicId_fkey" FOREIGN KEY ("teamId", "sessionId", "topicId") REFERENCES "Topic"("teamId", "sessionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendaEntry" ADD CONSTRAINT "AgendaEntry_teamId_sessionId_topicId_fkey" FOREIGN KEY ("teamId", "sessionId", "topicId") REFERENCES "Topic"("teamId", "sessionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SessionParticipant" ADD CONSTRAINT "SessionParticipant_ballotVersion_check"
CHECK ("ballotVersion" >= 0);
ALTER TABLE "AgendaEntry" ADD CONSTRAINT "AgendaEntry_values_check"
CHECK ("position" > 0 AND "voteCount" >= 0);
ALTER TABLE "TeamSession" ADD CONSTRAINT "TeamSession_voting_check" CHECK (
    ("votingState" = 'NOT_STARTED' AND "votingStartedAt" IS NULL AND "votingFinalizedAt" IS NULL)
    OR (
        "kind" = 'FACILITATED' AND "votingStartedAt" IS NOT NULL AND (
            ("votingState" = 'OPEN' AND "collectionState" = 'PAUSED' AND "votingFinalizedAt" IS NULL)
            OR ("votingState" = 'FINALIZED' AND "collectionState" IN ('PAUSED', 'CLOSED')
                AND "votingFinalizedAt" IS NOT NULL AND "votingFinalizedAt" >= "votingStartedAt")
        )
    )
);
