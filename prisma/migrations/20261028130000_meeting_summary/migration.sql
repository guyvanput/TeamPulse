BEGIN;

CREATE TABLE "SessionSummary" (
  "teamId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "generatedById" TEXT NOT NULL,
  "generatedByName" TEXT NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL,
  "formatVersion" INTEGER NOT NULL DEFAULT 1,
  "note" TEXT NOT NULL DEFAULT '',
  "content" JSONB NOT NULL,
  CONSTRAINT "SessionSummary_pkey" PRIMARY KEY ("sessionId"),
  CONSTRAINT "SessionSummary_teamId_sessionId_key" UNIQUE ("teamId","sessionId"),
  CONSTRAINT "SessionSummary_shape_check" CHECK (
    "formatVersion" > 0 AND char_length("note") <= 4000 AND "note"=btrim("note") AND jsonb_typeof("content")='object'
  ),
  CONSTRAINT "SessionSummary_teamId_sessionId_fkey"
    FOREIGN KEY ("teamId","sessionId") REFERENCES "TeamSession"("teamId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SessionSummary_generatedById_fkey"
    FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

COMMIT;
