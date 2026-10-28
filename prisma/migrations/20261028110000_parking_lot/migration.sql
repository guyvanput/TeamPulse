BEGIN;

CREATE TYPE "DiscussionOutcome" AS ENUM ('DISCUSSED', 'DEFERRED');
CREATE TYPE "ParkingEventKind" AS ENUM ('PARK', 'RESTORE');
ALTER TABLE "TopicDiscussion"
  ADD COLUMN "attemptNumber" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "outcome" "DiscussionOutcome";
UPDATE "TopicDiscussion" SET "outcome" = 'DISCUSSED' WHERE "state" = 'FINISHED';
ALTER TABLE "TopicDiscussion" DROP CONSTRAINT "TopicDiscussion_pkey";
DROP INDEX "TopicDiscussion_teamId_sessionId_topicId_key";
ALTER TABLE "TopicDiscussion"
  ADD CONSTRAINT "TopicDiscussion_pkey" PRIMARY KEY ("sessionId", "topicId", "attemptNumber"),
  ADD CONSTRAINT "TopicDiscussion_attempt_check" CHECK ("attemptNumber" > 0),
  DROP CONSTRAINT "TopicDiscussion_state_check",
  ADD CONSTRAINT "TopicDiscussion_state_check" CHECK (
    ("state" = 'RUNNING' AND "deadlineAt" IS NOT NULL AND "remainingMs" IS NULL
      AND "finishedAt" IS NULL AND "finishedById" IS NULL AND "outcome" IS NULL) OR
    ("state" = 'PAUSED' AND "deadlineAt" IS NULL AND "remainingMs" > 0
      AND "remainingMs" IS NOT NULL AND "finishedAt" IS NULL AND "finishedById" IS NULL AND "outcome" IS NULL) OR
    ("state" = 'FINISHED' AND "deadlineAt" IS NULL AND "remainingMs" IS NOT NULL
      AND "finishedAt" >= "startedAt" AND "finishedAt" IS NOT NULL AND "finishedById" IS NOT NULL AND "outcome" IS NOT NULL)
  );
CREATE UNIQUE INDEX "TopicDiscussion_teamId_sessionId_topicId_attemptNumber_key"
  ON "TopicDiscussion"("teamId", "sessionId", "topicId", "attemptNumber");
CREATE UNIQUE INDEX "TopicDiscussion_one_discussed_per_topic"
  ON "TopicDiscussion"("sessionId", "topicId") WHERE "outcome" = 'DISCUSSED';

CREATE TABLE "TopicParkingEvent" (
  "teamId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "topicId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "kind" "ParkingEventKind" NOT NULL,
  "reason" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL,
  "actorId" TEXT NOT NULL,
  "attemptNumber" INTEGER,
  CONSTRAINT "TopicParkingEvent_pkey" PRIMARY KEY ("sessionId", "version"),
  CONSTRAINT "TopicParkingEvent_shape_check" CHECK (
    "version" > 0 AND ("attemptNumber" IS NULL OR "attemptNumber" > 0) AND
    length("reason") <= 4000 AND "reason" !~ '^[[:space:]]|[[:space:]]$' AND
    ("kind" = 'PARK' OR ("kind" = 'RESTORE' AND "reason" = '' AND "attemptNumber" IS NULL))
  ),
  CONSTRAINT "TopicParkingEvent_teamId_sessionId_topicId_fkey"
    FOREIGN KEY ("teamId", "sessionId", "topicId")
    REFERENCES "AgendaEntry"("teamId", "sessionId", "topicId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TopicParkingEvent_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TopicParkingEvent_attempt_fkey"
    FOREIGN KEY ("teamId", "sessionId", "topicId", "attemptNumber")
    REFERENCES "TopicDiscussion"("teamId", "sessionId", "topicId", "attemptNumber") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TopicParkingEvent_teamId_sessionId_topicId_attemptNumber_key"
  ON "TopicParkingEvent"("teamId", "sessionId", "topicId", "attemptNumber");
CREATE INDEX "TopicParkingEvent_teamId_sessionId_topicId_version_idx"
  ON "TopicParkingEvent"("teamId", "sessionId", "topicId", "version");

COMMIT;
