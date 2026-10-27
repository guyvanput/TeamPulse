import { describe, expect, it } from "vitest";
import { actionInput, isEarlier, reviewInput, sessionInput } from "../../src/lib/rules";

const action = { sessionId: "s", title: "Improve handover", context: "", ownerId: "u", dueDate: "" };

describe("AC3/AC4 action validation", () => {
  it("trims input and accepts an optional due date", () => {
    expect(actionInput.parse({ ...action, title: "  Improve handover  " }).title).toBe("Improve handover");
    expect(actionInput.parse({ ...action, dueDate: "2028-02-29" }).dueDate).toBe("2028-02-29");
  });
  it.each(["0000-01-01", "2026-02-29", "2026-04-31", "tomorrow", "2026-1-1", "2026-10-26T12:00:00Z"])("rejects invalid date %s", (dueDate) => {
    expect(actionInput.safeParse({ ...action, dueDate }).success).toBe(false);
  });
  it.each([{ title: " " }, { ownerId: "" }, { title: "a".repeat(161) }, { context: "a".repeat(4001) }])("rejects invalid action %j", (invalid) => {
    expect(actionInput.safeParse({ ...action, ...invalid }).success).toBe(false);
  });
  it("accepts exact field limits", () => {
    expect(actionInput.safeParse({ ...action, title: "a".repeat(160), context: "a".repeat(4000) }).success).toBe(true);
  });
});

describe("AC2/AC6 session and review rules", () => {
  it("rejects a blank session title", () => {
    expect(sessionInput.safeParse({ teamId: "t", title: " " }).success).toBe(false);
  });
  it.each(["OPEN", "IN_PROGRESS", "DONE"])("allows reviewed status %s", (status) => {
    expect(reviewInput.safeParse({ sessionId: "s", actionId: "a", note: "Progress", status }).success).toBe(true);
  });
  it.each([{ note: " " }, { note: "a".repeat(4001) }, { status: "UNKNOWN" }])("rejects invalid review %j", (invalid) => {
    expect(reviewInput.safeParse({ sessionId: "s", actionId: "a", note: "Progress", status: "OPEN", ...invalid }).success).toBe(false);
  });
  it("AC5 orders session ties consistently", () => {
    const createdAt = new Date("2026-10-26");
    expect(isEarlier({ id: "a", createdAt }, { id: "b", createdAt })).toBe(true);
    expect(isEarlier({ id: "b", createdAt }, { id: "a", createdAt })).toBe(false);
    expect(isEarlier({ id: "a", createdAt }, { id: "a", createdAt })).toBe(false);
  });
});
