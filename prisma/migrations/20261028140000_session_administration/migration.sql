BEGIN;

ALTER TABLE "SessionParticipant" ADD COLUMN "removedAt" TIMESTAMP(3);
CREATE TYPE "SessionAdministrationKind" AS ENUM ('TRANSFER', 'REMOVE', 'READMIT');
CREATE TABLE "SessionAdministrationEvent" (
  "teamId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "kind" "SessionAdministrationKind" NOT NULL,
  "actorId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "SessionAdministrationEvent_pkey" PRIMARY KEY ("sessionId","version"),
  CONSTRAINT "SessionAdministrationEvent_shape_check" CHECK (
    "version" > 0 AND "actorId" <> "targetId" AND
    char_length("reason") <= 4000 AND "reason"=btrim("reason") AND
    ("kind"='REMOVE' OR "reason"='')
  ),
  CONSTRAINT "SessionAdministrationEvent_session_fkey"
    FOREIGN KEY ("teamId","sessionId") REFERENCES "TeamSession"("teamId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SessionAdministrationEvent_actor_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SessionAdministrationEvent_target_fkey"
    FOREIGN KEY ("teamId","sessionId","targetId") REFERENCES "SessionParticipant"("teamId","sessionId","userId") ON DELETE RESTRICT ON UPDATE CASCADE
);

COMMIT;
