CREATE TYPE "DiscussionState" AS ENUM ('RUNNING', 'PAUSED', 'FINISHED');

CREATE TABLE "TopicDiscussion" (
    "teamId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "state" "DiscussionState" NOT NULL,
    "deadlineAt" TIMESTAMP(3),
    "remainingMs" INTEGER,
    "allocatedMs" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "startedById" TEXT NOT NULL,
    "finishedById" TEXT,
    CONSTRAINT "TopicDiscussion_pkey" PRIMARY KEY ("sessionId", "topicId"),
    CONSTRAINT "TopicDiscussion_duration_check" CHECK (
      "allocatedMs" >= 300000 AND
      ("remainingMs" IS NULL OR ("remainingMs" >= 0 AND "remainingMs" <= "allocatedMs"))
    ),
    CONSTRAINT "TopicDiscussion_state_check" CHECK (
      ("state" = 'RUNNING' AND "deadlineAt" IS NOT NULL AND "remainingMs" IS NULL
        AND "finishedAt" IS NULL AND "finishedById" IS NULL) OR
      ("state" = 'PAUSED' AND "deadlineAt" IS NULL AND "remainingMs" > 0
        AND "remainingMs" IS NOT NULL AND "finishedAt" IS NULL AND "finishedById" IS NULL) OR
      ("state" = 'FINISHED' AND "deadlineAt" IS NULL AND "remainingMs" IS NOT NULL
        AND "finishedAt" >= "startedAt" AND "finishedAt" IS NOT NULL AND "finishedById" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "TopicDiscussion_teamId_sessionId_topicId_key"
  ON "TopicDiscussion"("teamId", "sessionId", "topicId");
CREATE UNIQUE INDEX "TopicDiscussion_one_current_per_session"
  ON "TopicDiscussion"("sessionId") WHERE "state" IN ('RUNNING', 'PAUSED');
CREATE UNIQUE INDEX "AgendaEntry_teamId_sessionId_topicId_key"
  ON "AgendaEntry"("teamId", "sessionId", "topicId");

ALTER TABLE "TopicDiscussion" ADD CONSTRAINT "TopicDiscussion_teamId_sessionId_topicId_fkey"
  FOREIGN KEY ("teamId", "sessionId", "topicId") REFERENCES "AgendaEntry"("teamId", "sessionId", "topicId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TopicDiscussion" ADD CONSTRAINT "TopicDiscussion_startedById_fkey"
  FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TopicDiscussion" ADD CONSTRAINT "TopicDiscussion_finishedById_fkey"
  FOREIGN KEY ("finishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
