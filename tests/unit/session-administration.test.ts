import { expect, it } from "vitest";
import { administrationInput, removalInput, administrationOperation } from "../../src/lib/rules";
import { administrationView, administrationSchema } from "../../src/lib/session-administration";

const joinedAt = "2026-01-01T00:00:00.000Z";
const removedAt = "2026-01-02T00:00:00.000Z";
const participants = [
  { id: "fac", name: "Facilitator", joinedAt, removedAt: null },
  { id: "active", name: "Active", joinedAt, removedAt: null },
  { id: "removed", name: "Removed", joinedAt, removedAt },
  { id: "former", name: "Former member", joinedAt, removedAt: null }
];
const source = { viewerId: "fac", facilitatorId: "fac", state: "PAUSED" as const, participants,
  memberIds: new Set(["fac", "active", "removed", "reader"]), history: [] };
it("RM1/5: strict target/version operations and bounded optional trimmed removal reason reject forged fields", () => {
  expect(administrationInput.parse({ sessionId: "s", targetId: "u", version: " 3 " })).toEqual({ sessionId: "s", targetId: "u", version: 3 });
  expect(removalInput.parse({ sessionId: "s", targetId: "u", version: 3 }).reason).toBe("");
  expect(removalInput.parse({ sessionId: "s", targetId: "u", version: 3, reason: " \n reason \n " }).reason).toBe("reason");
  expect(removalInput.parse({ sessionId: "s", targetId: "u", version: 3, reason: "x".repeat(4000) }).reason).toHaveLength(4000);
  for (const change of [{ actorId: "forged" }, { teamId: "foreign" }, { kind: "TRANSFER" }, { removedAt }, { version: null },
    { version: false }, { targetId: "" }, { reason: "x".repeat(4001) }]) {
    expect(removalInput.safeParse({ sessionId: "s", targetId: "u", version: 3, ...change }).success).toBe(false);
  }
  expect(administrationInput.safeParse({ sessionId: "s", targetId: "u", version: 3, reason: "forged" }).success).toBe(false);
  expect(administrationOperation.safeParse("promote").success).toBe(false);
});
it("RM1/2/3/4: only the current facilitator administers eligible historical targets, never self or a former member", () => {
  const view = administrationView(source);
  expect(view.viewerState).toBe("ACTIVE");
  expect(view.entries.map(item => [item.id, item.canTransfer, item.canRemove, item.canReadmit]))
    .toEqual([["fac", false, false, false], ["active", true, true, false], ["removed", false, false, true], ["former", false, false, false]]);
  expect(view.entries[2]).toMatchObject({ joinedAt, removedAt });
  for (const viewerId of ["active", "removed", "reader"]) {
    expect(administrationView({ ...source, viewerId }).entries.every(item => !item.canTransfer && !item.canRemove && !item.canReadmit)).toBe(true);
  }
});
it("RM3/4/7: removed users cannot self-join; first-time readers can join only nonclosed sessions; closed administration is disabled", () => {
  expect(administrationView({ ...source, viewerId: "removed" })).toMatchObject({ viewerState: "REMOVED", canJoin: false, removedAt });
  expect(administrationView({ ...source, viewerId: "reader" })).toMatchObject({ viewerState: "NOT_JOINED", canJoin: true, joinedAt: null });
  expect(administrationView({ ...source, viewerId: "reader", state: "CLOSED" }).canJoin).toBe(false);
  expect(administrationView({ ...source, state: "CLOSED" }).entries.every(item => !item.canTransfer && !item.canRemove && !item.canReadmit)).toBe(true);
  expect(() => administrationView({ ...source, viewerId: "foreign" })).toThrow();
});
it("RM5/6: required typed administration never silently defaults; malformed, duplicate or unscoped history is rejected", () => {
  const event = { version: 4, kind: "TRANSFER", actor: { id: "fac", name: "Facilitator" },
    target: { id: "active", name: "Active" }, createdAt: removedAt, reason: "" };
  const view = administrationView(source);
  expect(administrationSchema.safeParse({ ...view, history: [event] }).success).toBe(true);
  for (const change of [{ viewerState: undefined }, { history: undefined }, { entries: [...view.entries, view.entries[0]] },
    { history: [{ ...event, target: event.actor }] }, { history: [{ ...event, reason: "Transfer reason is forbidden" }] },
    { history: [event, event] }, { history: [{ ...event, target: { id: "foreign", name: "Foreign" } }] }]) {
    expect(administrationSchema.safeParse({ ...view, ...change }).success).toBe(false);
  }
});
