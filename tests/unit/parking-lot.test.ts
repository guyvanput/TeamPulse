import { describe, expect, it } from "vitest";
import { parkingProgress, nextAttemptNumber } from "../../src/lib/parking-lot";
import { parkInput, restoreInput } from "../../src/lib/rules";

const agenda = [{ topicId: "a", position: 1, discussionPosition: 1 }, { topicId: "b", position: 2, discussionPosition: 2 }];
const attempt = (topicId: string, attemptNumber = 1, outcome: "DEFERRED" | "DISCUSSED" | null = null) => ({
  topicId, attemptNumber, state: outcome ? "FINISHED" as const : "RUNNING" as const, outcome
});
const event = (topicId: string, version: number, kind: "PARK" | "RESTORE", attemptNumber: number | null = null) => ({ topicId, version, kind, attemptNumber });
describe("PL2/4/5: coherent parking eligibility", () => {
  it("keeps all saved ranks and skips parked topics without fictional attempts", () => {
    const result = parkingProgress(agenda, [], [event("a", 4, "PARK")]);
    expect(result.entries.map(item => [item.topicId, item.state])).toEqual([["a", "PARKED"], ["b", "NOT_STARTED"]]);
    expect(result.nextTopicId).toBe("b");
    expect(result.current).toBeNull();
    expect(result.allDiscussed).toBe(false);
  });
  it("restores original eligibility while retaining deferred attempts and another current topic", () => {
    const attempts = [attempt("a", 1, "DEFERRED"), attempt("b")];
    const events = [event("a", 6, "RESTORE"), event("a", 5, "PARK", 1)];
    const result = parkingProgress(agenda, attempts, events);
    expect(result.current).toEqual(attempts[1]);
    expect(result.nextTopicId).toBe("a");
    expect(result.entries[0].attempts).toEqual([attempts[0]]);
    expect(result.entries[0].events.map(item => item.kind)).toEqual(["PARK", "RESTORE"]);
    expect(nextAttemptNumber(result.entries[0].attempts)).toBe(2);
  });
  it("keeps waiting cycles distinct from starts and only permanent completion counts as Discussed", () => {
    const result = parkingProgress(agenda, [attempt("b", 1, "DISCUSSED")],
      [event("a", 4, "PARK"), event("a", 5, "RESTORE"), event("a", 6, "PARK")]);
    expect(result.nextTopicId).toBeNull();
    expect(result.allDiscussed).toBe(false);
    expect(result.entries.map(item => item.state)).toEqual(["PARKED", "FINISHED"]);
    expect(nextAttemptNumber([])).toBe(1);
    expect(parkingProgress(agenda, [attempt("a", 1, "DISCUSSED"), attempt("b", 1, "DISCUSSED")], []).allDiscussed).toBe(true);
  });
  it.each([
    [[attempt("a"), attempt("b")], []],
    [[attempt("a")], [event("a", 4, "PARK")]],
    [[attempt("a", 1, "DISCUSSED")], [event("a", 4, "PARK")]],
    [[], [event("a", 4, "RESTORE")]],
    [[], [event("a", 4, "PARK"), event("a", 5, "PARK")]],
    [[attempt("unknown")], []],
    [[attempt("a", 2)], []],
    [[attempt("a", 1, "DEFERRED")], []],
    [[attempt("a", 1, "DISCUSSED"), attempt("a", 2)], []]
  ])("rejects contradictory history instead of hiding it (%#)", (attempts, events) => {
    expect(() => parkingProgress(agenda, attempts, events)).toThrow(/history|progress/i);
  });
  it("rejects exhausted attempt numbers explicitly", () => {
    expect(() => nextAttemptNumber([{ attemptNumber: 2147483647 }])).toThrow(/exhaust/i);
  });
});
describe("PL1/2: strict park/restore input", () => {
  const input = { sessionId: "s", topicId: "t", version: " 3 " };
  it("trims optional reasons and retains the existing numeric version syntax", () => {
    expect(parkInput.parse({ ...input, reason: "  Later  " })).toEqual({ sessionId: "s", topicId: "t", version: 3, reason: "Later" });
    expect(parkInput.parse(input).reason).toBe("");
    expect(parkInput.parse({ ...input, reason: "   " }).reason).toBe("");
    expect(parkInput.parse({ ...input, reason: "x".repeat(4000) }).reason).toHaveLength(4000);
    expect(restoreInput.parse(input)).toEqual({ sessionId: "s", topicId: "t", version: 3 });
  });
  it.each([null, false, "", [], -1, 0.1])("rejects malformed revisions %j", version => {
    expect(parkInput.safeParse({ ...input, version }).success).toBe(false);
    expect(restoreInput.safeParse({ ...input, version }).success).toBe(false);
  });
  it("rejects oversized/invalid reasons and forged/unknown properties", () => {
    for (const reason of ["x".repeat(4001), null, 3]) expect(parkInput.safeParse({ ...input, reason }).success).toBe(false);
    for (const extra of [{ actorId: "forged" }, { attemptNumber: 5 }, { deadlineAt: "2099" }]) {
      expect(parkInput.safeParse({ ...input, ...extra }).success).toBe(false);
    }
    expect(restoreInput.safeParse({ ...input, reason: "change old reason" }).success).toBe(false);
  });
});
