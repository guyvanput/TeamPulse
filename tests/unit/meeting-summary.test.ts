import { expect, it } from "vitest";
import { buildSummaryContent, summaryReportSchema, type SummarySource } from "../../src/lib/meeting-summary";
import { generateSummaryInput } from "../../src/lib/rules";

const person = { id: "u", name: "Member" };
const source: SummarySource = {
  session: { id: "s", title: "Session", facilitator: person, state: "CLOSED", votingState: "FINALIZED" },
  participants: [{ ...person, joinedAt: "2026-01-01T00:00:00.000Z" }],
  topics: ["a", "b", "c", "d"].map(id => ({ id, title: id, description: "Submitted context", removedAt: null })),
  agenda: ["a", "b", "c", "d"].map((topicId, i) => ({ topicId, position: i + 1, discussionPosition: [1, 4, 2, 3][i], voteCount: i })),
  attempts: [
    { topicId: "a", attemptNumber: 1, state: "FINISHED", outcome: "DISCUSSED" },
    { topicId: "b", attemptNumber: 1, state: "FINISHED", outcome: "DEFERRED" }
  ],
  events: [
    { topicId: "b", version: 4, kind: "PARK", attemptNumber: 1, reason: "Earlier reason" },
    { topicId: "b", version: 5, kind: "RESTORE", attemptNumber: null, reason: "" },
    { topicId: "c", version: 6, kind: "PARK", attemptNumber: null, reason: "Waiting" }
  ],
  actions: [{ id: "action", title: "Commitment", context: "Keep", owner: person, dueDate: "2026-01-02", status: "DONE",
    source: { id: "earlier", title: "Earlier" }, createdHere: false,
    reviews: [{ id: "review", actor: person, createdAt: "2026-01-01T00:00:00.000Z", note: "Progress", resultingStatus: "IN_PROGRESS" }] }]
};
it("MS2/4: captures original/manual positions and exact final outcomes without rewriting historical review results", () => {
  const content = buildSummaryContent(source);
  expect(content.topics.map(item => [item.id, item.originalPosition, item.discussionPosition, item.outcome, item.reason]))
    .toEqual([["a", 1, 1, "DISCUSSED", null], ["b", 2, 4, "NOT_DISCUSSED", null], ["c", 3, 2, "DEFERRED", "Waiting"], ["d", 4, 3, "NOT_DISCUSSED", null]]);
  expect(content.actions[0]).toMatchObject({ status: "DONE", reviews: [{ resultingStatus: "IN_PROGRESS" }] });
  source.actions[0].title = "Later title";
  expect(content.actions[0].title).toBe("Commitment");
  source.actions[0].title = "Commitment";
});
it("MS2: unprioritized closed meetings have no invented vote counts or positions; removed topics stay out", () => {
  const content = buildSummaryContent({ ...source, session: { ...source.session, votingState: "NOT_STARTED" },
    agenda: [], attempts: [], events: [], topics: [...source.topics, { id: "removed", title: "Removed", description: "", removedAt: "2026-01-01" }] });
  expect(content.topics).toHaveLength(4);
  expect(content.topics.every(item => item.originalPosition === null && item.discussionPosition === null && item.voteCount === null && item.outcome === "NOT_DISCUSSED")).toBe(true);
});
it("MS2: refuses open voting, live discussions, nonclosed or incomplete/corrupt source agendas", () => {
  for (const change of [
    { session: { ...source.session, votingState: "OPEN" as const } },
    { session: { ...source.session, state: "PAUSED" as const } },
    { agenda: source.agenda.slice(1) },
    { attempts: [...source.attempts, { topicId: "d", attemptNumber: 1, state: "RUNNING" as const, outcome: null }] },
    { agenda: source.agenda.map(item => ({ ...item, discussionPosition: 1 })) }
  ]) expect(() => buildSummaryContent({ ...source, ...change })).toThrow();
});
it("MS1/3: strict generation input trims optional wrap-up and rejects forged or invalid values", () => {
  expect(generateSummaryInput.parse({ sessionId: "s", version: " 3 " })).toEqual({ sessionId: "s", version: 3, note: "" });
  expect(generateSummaryInput.parse({ sessionId: "s", version: 3, note: "  note  " }).note).toBe("note");
  expect(generateSummaryInput.parse({ sessionId: "s", version: 3, note: "x".repeat(4000) }).note).toHaveLength(4000);
  for (const change of [{ note: "x".repeat(4001) }, { note: null }, { version: null }, { version: [] },
    { actorId: "forged" }, { content: {} }, { generatedAt: "fake" }, { formatVersion: 1 }]) {
    expect(generateSummaryInput.safeParse({ sessionId: "s", version: 3, ...change }).success).toBe(false);
  }
});
it("MS3/7: saved reports validate their exact format/content; missing or unsupported data never silently becomes a live report", () => {
  const report = { formatVersion: 1, generatedAt: "2026-01-01T00:00:00.000Z", generatedBy: person, note: "<script>text</script>", content: buildSummaryContent(source) };
  expect(summaryReportSchema.parse(report)).toEqual(report);
  for (const change of [{ formatVersion: 2 }, { content: null }, { note: "x".repeat(4001) }, { generatedAt: "bad" }]) {
    expect(summaryReportSchema.safeParse({ ...report, ...change }).success).toBe(false);
  }
});
