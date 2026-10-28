CREATE TYPE "SessionKind" AS ENUM ('ACTION_FOLLOW_UP', 'FACILITATED');
CREATE TYPE "CollectionState" AS ENUM ('COLLECTING', 'PAUSED', 'CLOSED');

ALTER TABLE "TeamSession"
ADD COLUMN "kind" "SessionKind" NOT NULL DEFAULT 'ACTION_FOLLOW_UP',
ADD COLUMN "facilitatorId" TEXT,
ADD COLUMN "collectionState" "CollectionState",
ADD COLUMN "lifecycleVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "closedAt" TIMESTAMP(3),
ADD CONSTRAINT "TeamSession_facilitatorId_fkey" FOREIGN KEY ("facilitatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "TeamSession_lifecycle_check" CHECK (
  "lifecycleVersion" >= 0 AND (
    ("kind" = 'ACTION_FOLLOW_UP' AND "facilitatorId" IS NULL AND "collectionState" IS NULL AND "closedAt" IS NULL)
    OR ("kind" = 'FACILITATED' AND "facilitatorId" IS NOT NULL AND "collectionState" IS NOT NULL
      AND (("collectionState" = 'CLOSED') = ("closedAt" IS NOT NULL)))
  )
);

CREATE TABLE "SessionParticipant" (
  "teamId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SessionParticipant_pkey" PRIMARY KEY ("sessionId", "userId"),
  CONSTRAINT "SessionParticipant_session_fkey" FOREIGN KEY ("teamId", "sessionId") REFERENCES "TeamSession"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SessionParticipant_user_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Topic" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "removedAt" TIMESTAMP(3),
  "removedById" TEXT,
  CONSTRAINT "Topic_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Topic_session_fkey" FOREIGN KEY ("teamId", "sessionId") REFERENCES "TeamSession"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Topic_author_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Topic_remover_fkey" FOREIGN KEY ("removedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Topic_removal_check" CHECK (("removedAt" IS NULL) = ("removedById" IS NULL)),
  CONSTRAINT "Topic_version_check" CHECK ("version" >= 0)
);
CREATE INDEX "Topic_teamId_sessionId_createdAt_id_idx" ON "Topic"("teamId", "sessionId", "createdAt", "id");
