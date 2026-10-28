import { describe, expect, it } from "vitest";
import { voteInput, votingLifecycleInput } from "../../src/lib/rules";
import { rankTopics, VOTE_BUDGET } from "../../src/lib/voting";

describe("VP2/3: explicit vote commands", () => {
  const command = { sessionId: "session", topicId: "topic", selected: true, version: 0 };
  it("uses the fixed three-vote budget and accepts an absolute boolean selection", () => {
    expect(VOTE_BUDGET).toBe(3);
    expect(voteInput.parse(command)).toEqual(command);
    expect(voteInput.parse({ ...command, selected: false, version: " 2 " }).version).toBe(2);
    expect(votingLifecycleInput.parse({ sessionId: "s", version: "0" })).toEqual({ sessionId: "s", version: 0 });
  });
  it.each([null, undefined, false, true, "", " ", [], [0], {}, -1, 0.5, "invalid", Infinity])(
    "rejects malformed expected ballot/lifecycle version %j", version => {
      expect(voteInput.safeParse({ ...command, version }).success).toBe(false);
      expect(votingLifecycleInput.safeParse({ sessionId: "s", version }).success).toBe(false);
    }
  );
  it.each(["true", "false", 1, 0, null, undefined, [], {}])("does not coerce selected %j", selected => {
    expect(voteInput.safeParse({ ...command, selected }).success).toBe(false);
  });
});

describe("VP6: deterministic complete ranking", () => {
  it("orders by votes, original creation instant, then ordinal identity without mutating input", () => {
    const at = new Date("2026-01-01");
    const input = [
      { id: "z", createdAt: at, count: 0 },
      { id: "b", createdAt: at, count: 1 },
      { id: "a", createdAt: at, count: 1 },
      { id: "early", createdAt: new Date("2025-01-01"), count: 1 },
      { id: "popular", createdAt: at, count: 3 }
    ];
    expect(rankTopics(input)).toEqual([
      { topicId: "popular", position: 1, count: 3 },
      { topicId: "early", position: 2, count: 1 },
      { topicId: "a", position: 3, count: 1 },
      { topicId: "b", position: 4, count: 1 },
      { topicId: "z", position: 5, count: 0 }
    ]);
    expect(input[0].id).toBe("z");
  });
  it("includes every zero-vote topic and accepts an empty provisional input", () => {
    const createdAt = new Date();
    expect(rankTopics([{ id: "b", createdAt, count: 0 }, { id: "a", createdAt, count: 0 }]))
      .toEqual([{ topicId: "a", position: 1, count: 0 }, { topicId: "b", position: 2, count: 0 }]);
    expect(rankTopics([])).toEqual([]);
  });
});
