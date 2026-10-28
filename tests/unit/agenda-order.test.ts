import { expect, it } from "vitest";
import { planAgendaMove, validateOrderHistory } from "../../src/lib/agenda-order";
import { parkingProgress } from "../../src/lib/parking-lot";
import { moveAgendaInput } from "../../src/lib/rules";

const future = [{ topicId: "a", discussionPosition: 1 }, { topicId: "b", discussionPosition: 3 }, { topicId: "c", discussionPosition: 5 }];
it("MO2: plans only an adjacent future swap, retaining physical frozen slots", () => {
  expect(planAgendaMove(future, "c", "b", "earlier")).toMatchObject({
    topic: future[2], neighbor: future[1], beforeQueue: ["a", "b", "c"], afterQueue: ["a", "c", "b"]
  });
  expect(planAgendaMove(future, "a", "b", "later").afterQueue).toEqual(["b", "a", "c"]);
  expect(future.map(item => item.discussionPosition)).toEqual([1, 3, 5]);
});
it.each([["a", "b", "earlier"], ["c", "b", "later"], ["a", "c", "later"], ["missing", "a", "later"]])(
  "MO1/7: rejects boundary/stale/missing neighbors (%s %s %s)", (topic, neighbor, direction) => {
    expect(() => planAgendaMove(future, topic, neighbor, direction)).toThrow(/changed|queue|direction/i);
  });
it("MO2/3: separate vote/planning order skips parked topics and keeps controls/progress in original order", () => {
  const agenda = ["a", "b", "c", "d", "e"].map((topicId, i) => ({ topicId, position: i + 1, discussionPosition: [1, 2, 5, 4, 3][i] }));
  const attempts = [
    { topicId: "a", attemptNumber: 1, state: "RUNNING" as const, outcome: null },
    { topicId: "d", attemptNumber: 1, state: "FINISHED" as const, outcome: "DISCUSSED" as const }
  ];
  const result = parkingProgress(agenda, attempts, [{ topicId: "b", version: 5, kind: "PARK", attemptNumber: null }]);
  expect(result.entries.map(item => item.topicId)).toEqual(["a", "b", "c", "d", "e"]);
  expect(result.future.map(item => item.topicId)).toEqual(["b", "e", "c"]);
  expect(result.nextTopicId).toBe("e");
  expect(result.current?.topicId).toBe("a");
});
it.each([[1, 1, 3], [0, 2, 3], [1, 3, 4]])("MO2: refuses corrupt planning permutations %j", (...positions) => {
  const agenda = future.map((item, i) => ({ ...item, position: i + 1, discussionPosition: positions[i] }));
  expect(() => parkingProgress(agenda, [], [])).toThrow(/history|progress/i);
});
it("MO4: validates exact before/after history rather than accepting arbitrary JSON arrays", () => {
  expect(validateOrderHistory(["a", "b", "c"], ["a", "c", "b"], "c", "b", "EARLIER")).toEqual({ beforeQueue: ["a", "b", "c"], afterQueue: ["a", "c", "b"] });
  for (const [before, after] of [
    [null, []], [["a", "b"], ["a"]], [["a", "a"], ["a", "a"]],
    [["a", "b", "c"], ["c", "b", "a"]], [["a", 3], [3, "a"]]
  ]) expect(() => validateOrderHistory(before, after, "c", "b", "EARLIER")).toThrow(/history/i);
});
it("MO1: validates direction/neighbor/version and rejects forged order/actor data", () => {
  const input = { sessionId: "s", topicId: "a", neighborTopicId: "b", direction: "later", version: " 3 " };
  expect(moveAgendaInput.parse(input)).toEqual({ ...input, version: 3 });
  for (const change of [{ direction: "sideways" }, { version: null }, { version: false }, { version: "" }, { version: [] },
    { version: -1 }, { neighborTopicId: "" }, { beforeQueue: [] }, { actorId: "forged" }]) {
    expect(moveAgendaInput.safeParse({ ...input, ...change }).success).toBe(false);
  }
});
