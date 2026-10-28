import { describe, expect, it } from "vitest";
import { topicInput, topicChangeInput, topicRemoveInput, lifecycleInput, canTransitionCollection } from "../../src/lib/rules";

describe("TC4 topic boundaries", () => {
  const base = { sessionId: "session", title: "Topic", description: "" };
  it.each([1, 160])("accepts title length %i", length => {
    expect(topicInput.parse({ ...base, title: "a".repeat(length) }).title).toHaveLength(length);
  });
  it.each(["", "  ", "a".repeat(161)])("rejects invalid titles", title => {
    expect(topicInput.safeParse({ ...base, title }).success).toBe(false);
  });
  it("trims text and preserves Unicode and literal markup", () => {
    expect(topicInput.parse({ ...base, title: "  日本語 <b>  ", description: " é " }))
      .toMatchObject({ title: "日本語 <b>", description: "é" });
  });
  it("counts UTF-16 consistently and bounds descriptions", () => {
    expect(topicInput.safeParse({ ...base, title: "😀".repeat(80), description: "a".repeat(4000) }).success).toBe(true);
    expect(topicInput.safeParse({ ...base, title: "😀".repeat(81) }).success).toBe(false);
    expect(topicInput.safeParse({ ...base, description: "a".repeat(4001) }).success).toBe(false);
  });
});

describe("TC6 collection lifecycle", () => {
  it.each([
    ["COLLECTING", "PAUSED", true], ["PAUSED", "COLLECTING", true],
    ["COLLECTING", "CLOSED", true], ["PAUSED", "CLOSED", true],
    ["CLOSED", "COLLECTING", false], ["CLOSED", "CLOSED", false],
    ["COLLECTING", "COLLECTING", false]
  ] as const)("%s -> %s = %s", (from, to, result) => {
    expect(canTransitionCollection(from, to)).toBe(result);
  });

  describe("expected version input types", () => {
    const topic = { sessionId: "s", topicId: "t", title: "Topic", description: "" };
    it.each([null, false, true, "", " \t ", [], [0], [1], {}])("rejects malformed expected version %j", version => {
      expect(lifecycleInput.safeParse({ sessionId: "s", state: "PAUSED", version }).success).toBe(false);
      expect(topicChangeInput.safeParse({ ...topic, version }).success).toBe(false);
      expect(topicRemoveInput.safeParse({ ...topic, version }).success).toBe(false);
    });
    it.each([[0, 0], ["0", 0], [1, 1], [" 1 ", 1], [2147483648, 2147483648]])(
      "parses explicit expected version %j as %s", (version, expected) => {
        expect(lifecycleInput.parse({ sessionId: "s", state: "PAUSED", version }).version).toBe(expected);
        expect(topicChangeInput.parse({ ...topic, version }).version).toBe(expected);
        expect(topicRemoveInput.parse({ ...topic, version }).version).toBe(expected);
      }
    );
  });
  it("requires a nonnegative expected version", () => {
    expect(lifecycleInput.safeParse({ sessionId: "s", state: "PAUSED", version: -1 }).success).toBe(false);
  });
});
