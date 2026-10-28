BEGIN;

ALTER TABLE "AgendaEntry" ADD COLUMN "discussionPosition" INTEGER;
UPDATE "AgendaEntry" SET "discussionPosition" = "position";
ALTER TABLE "AgendaEntry"
  ALTER COLUMN "discussionPosition" SET NOT NULL,
  ADD CONSTRAINT "AgendaEntry_discussionPosition_check" CHECK ("discussionPosition" > 0),
  ADD CONSTRAINT "AgendaEntry_sessionId_discussionPosition_key" UNIQUE ("sessionId", "discussionPosition")
    DEFERRABLE INITIALLY IMMEDIATE;
CREATE TYPE "AgendaMoveDirection" AS ENUM ('EARLIER', 'LATER');
CREATE TABLE "AgendaOrderChange" (
  "teamId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "topicId" TEXT NOT NULL,
  "neighborTopicId" TEXT NOT NULL,
  "direction" "AgendaMoveDirection" NOT NULL,
  "beforeQueue" JSONB NOT NULL,
  "afterQueue" JSONB NOT NULL,
  CONSTRAINT "AgendaOrderChange_pkey" PRIMARY KEY ("sessionId", "version"),
  CONSTRAINT "AgendaOrderChange_shape_check" CHECK (
    "version" > 0 AND "topicId" <> "neighborTopicId" AND
    CASE WHEN jsonb_typeof("beforeQueue") = 'array' AND jsonb_typeof("afterQueue") = 'array'
      THEN jsonb_array_length("beforeQueue") >= 2 AND jsonb_array_length("beforeQueue") = jsonb_array_length("afterQueue")
      ELSE FALSE END
  ),
  CONSTRAINT "AgendaOrderChange_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgendaOrderChange_teamId_sessionId_topicId_fkey"
    FOREIGN KEY ("teamId","sessionId","topicId") REFERENCES "AgendaEntry"("teamId","sessionId","topicId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgendaOrderChange_teamId_sessionId_neighborTopicId_fkey"
    FOREIGN KEY ("teamId","sessionId","neighborTopicId") REFERENCES "AgendaEntry"("teamId","sessionId","topicId") ON DELETE RESTRICT ON UPDATE CASCADE
);

COMMIT;
