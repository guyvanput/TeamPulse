import { describe, expect, it } from "vitest";
import {
  HISTORY_PAGE_SIZE, historyLifecycle, historyFilterSchema, encodeHistoryCursor, decodeHistoryCursor,
  historyPageSchema, HistoryCursorError
} from "../../src/lib/session-history";

const base = { kind: "FACILITATED" as const, collectionState: "COLLECTING" as const, votingState: "NOT_STARTED" as const };

describe("session history lifecycle", () => {
  it.each([
    [{ ...base, kind: "ACTION_FOLLOW_UP" as const, collectionState: null }, "ACTION_FOLLOW_UP"],
    [{ ...base }, "COLLECTING"],
    [{ ...base, collectionState: "PAUSED" as const }, "COLLECTING"],
    [{ ...base, collectionState: "PAUSED" as const, votingState: "OPEN" as const }, "VOTING"],
    [{ ...base, collectionState: "PAUSED" as const, votingState: "FINALIZED" as const }, "DISCUSSING"],
    [{ ...base, collectionState: "CLOSED" as const }, "CLOSED"],
    [{ ...base, collectionState: "CLOSED" as const, votingState: "FINALIZED" as const }, "CLOSED"],
    [{ ...base, collectionState: "CLOSED" as const, votingState: "OPEN" as const }, "CLOSED"],
    [{ ...base, collectionState: null }, "COLLECTING"]
  ])("derives %j as %s", (input, expected) => {
    expect(historyLifecycle(input)).toBe(expected);
  });
});

describe("session history filter and cursor", () => {
  it("accepts only the three approved filters", () => {
    expect(historyFilterSchema.parse("ALL")).toBe("ALL");
    expect(historyFilterSchema.parse("IN_PROGRESS")).toBe("IN_PROGRESS");
    expect(historyFilterSchema.parse("CLOSED")).toBe("CLOSED");
    for (const value of ["all", "", "OPEN", "SEARCH", null, undefined, 3]) expect(historyFilterSchema.safeParse(value).success).toBe(false);
  });
  it("uses the approved page size", () => expect(HISTORY_PAGE_SIZE).toBe(20));
  it("round-trips an opaque cursor", () => {
    const createdAt = new Date("2026-10-28T10:11:12.345Z");
    const id = "3f6c1d1e-0000-4000-8000-000000000001";
    const cursor = encodeHistoryCursor({ createdAt, id });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor).not.toContain(id);
    const decoded = decodeHistoryCursor(cursor);
    expect(decoded.createdAt.toISOString()).toBe(createdAt.toISOString());
    expect(decoded.id).toBe(id);
  });
  it.each([
    ["empty", ""],
    ["not base64url json", "%%%"],
    ["plain text", Buffer.from("hello").toString("base64url")],
    ["array", Buffer.from("[]").toString("base64url")],
    ["bad date", Buffer.from(JSON.stringify({ createdAt: "yesterday", id: "3f6c1d1e-0000-4000-8000-000000000001" })).toString("base64url")],
    ["bad id", Buffer.from(JSON.stringify({ createdAt: "2026-10-28T10:11:12.345Z", id: "not-a-uuid" })).toString("base64url")],
    ["extra key", Buffer.from(JSON.stringify({ createdAt: "2026-10-28T10:11:12.345Z", id: "3f6c1d1e-0000-4000-8000-000000000001", x: 1 })).toString("base64url")],
    ["oversized", "A".repeat(5000)]
  ])("rejects a %s cursor", (_name, value) => {
    expect(() => decodeHistoryCursor(value)).toThrow(HistoryCursorError);
  });
});

describe("session history page DTO", () => {
  const row = {
    id: "3f6c1d1e-0000-4000-8000-000000000001", title: "Retro", createdAt: "2026-10-28T10:11:12.345Z", kind: "FACILITATED",
    lifecycle: "CLOSED", facilitatorName: "Alice", topicCount: 3, openActionCount: 1, summaryAvailable: true
  };
  it("accepts facilitated and legacy rows", () => {
    expect(historyPageSchema.parse({ filter: "ALL", rows: [row], nextCursor: null }).rows).toHaveLength(1);
    const legacy = { ...row, kind: "ACTION_FOLLOW_UP", lifecycle: "ACTION_FOLLOW_UP", facilitatorName: null, topicCount: null, summaryAvailable: null };
    expect(historyPageSchema.safeParse({ filter: "ALL", rows: [legacy], nextCursor: null }).success).toBe(true);
  });
  it("rejects contradictory, oversized and unknown-field payloads", () => {
    const bad = (patch: object, rows = [{ ...row, ...patch }]) => historyPageSchema.safeParse({ filter: "ALL", rows, nextCursor: null }).success;
    expect(bad({ lifecycle: "ACTION_FOLLOW_UP" })).toBe(false);
    expect(bad({ kind: "ACTION_FOLLOW_UP", lifecycle: "ACTION_FOLLOW_UP" })).toBe(false);
    expect(bad({ lifecycle: "COLLECTING", summaryAvailable: true })).toBe(false);
    expect(bad({ lifecycle: "CLOSED", summaryAvailable: null })).toBe(false);
    expect(bad({ topicCount: -1 })).toBe(false);
    expect(bad({ openActionCount: 1.5 })).toBe(false);
    expect(bad({ report: "secret" })).toBe(false);
    expect(bad({}, Array.from({ length: HISTORY_PAGE_SIZE + 1 }, () => row))).toBe(false);
    expect(historyPageSchema.safeParse({ filter: "ALL", rows: [], nextCursor: "not valid!" }).success).toBe(false);
  });
});
