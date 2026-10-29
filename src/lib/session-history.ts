import { z } from "zod";

export const HISTORY_PAGE_SIZE = 20;
const MAX_CURSOR_LENGTH = 512;

export const historyFilterSchema = z.enum(["ALL", "IN_PROGRESS", "CLOSED"]);
export type HistoryFilter = z.infer<typeof historyFilterSchema>;
export const historyLifecycles = ["COLLECTING", "VOTING", "DISCUSSING", "CLOSED", "ACTION_FOLLOW_UP"] as const;
export type HistoryLifecycle = (typeof historyLifecycles)[number];

export const lifecycleLabels: Record<HistoryLifecycle, string> = {
  COLLECTING: "Collecting topics", VOTING: "Voting", DISCUSSING: "Discussing", CLOSED: "Closed", ACTION_FOLLOW_UP: "Action follow-up"
};

export function historyLifecycle(session: {
  kind: "FACILITATED" | "ACTION_FOLLOW_UP";
  collectionState: "COLLECTING" | "PAUSED" | "CLOSED" | null;
  votingState: "NOT_STARTED" | "OPEN" | "FINALIZED";
}): HistoryLifecycle {
  if (session.kind === "ACTION_FOLLOW_UP") return "ACTION_FOLLOW_UP";
  if (session.collectionState === "CLOSED") return "CLOSED";
  if (session.votingState === "OPEN") return "VOTING";
  if (session.votingState === "FINALIZED") return "DISCUSSING";
  return "COLLECTING";
}

export class HistoryCursorError extends Error {
  constructor() { super("The history page position is not valid."); }
}

const cursorSchema = z.object({ createdAt: z.string().datetime(), id: z.string().uuid() }).strict();
const cursorText = z.string().min(1).max(MAX_CURSOR_LENGTH).regex(/^[A-Za-z0-9_-]+$/);

export function encodeHistoryCursor(position: { createdAt: Date; id: string }) {
  return Buffer.from(JSON.stringify({ createdAt: position.createdAt.toISOString(), id: position.id })).toString("base64url");
}

export function decodeHistoryCursor(value: string) {
  const text = cursorText.safeParse(value);
  if (!text.success) throw new HistoryCursorError();
  try {
    const parsed = cursorSchema.parse(JSON.parse(Buffer.from(text.data, "base64url").toString("utf8")));
    return { createdAt: new Date(parsed.createdAt), id: parsed.id };
  } catch {
    throw new HistoryCursorError();
  }
}

const count = z.number().int().nonnegative();
export const historyRowSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  createdAt: z.string().datetime(),
  kind: z.enum(["FACILITATED", "ACTION_FOLLOW_UP"]),
  lifecycle: z.enum(historyLifecycles),
  facilitatorName: z.string().nullable(),
  topicCount: count.nullable(),
  openActionCount: count,
  summaryAvailable: z.boolean().nullable()
}).strict().superRefine((row, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  if ((row.kind === "ACTION_FOLLOW_UP") !== (row.lifecycle === "ACTION_FOLLOW_UP")) issue("Session kind and lifecycle contradict each other.");
  if (row.kind === "ACTION_FOLLOW_UP") {
    if (row.facilitatorName !== null || row.topicCount !== null || row.summaryAvailable !== null) issue("Action follow-up rows carry no facilitated details.");
    return;
  }
  if (row.topicCount === null) issue("Facilitated rows need a topic count.");
  if ((row.lifecycle === "CLOSED") !== (typeof row.summaryAvailable === "boolean")) issue("Only closed sessions report summary availability.");
});
export type HistoryRow = z.infer<typeof historyRowSchema>;

export const historyPageSchema = z.object({
  filter: historyFilterSchema,
  rows: z.array(historyRowSchema).max(HISTORY_PAGE_SIZE),
  nextCursor: cursorText.nullable()
}).strict();
export type HistoryPage = z.infer<typeof historyPageSchema>;
