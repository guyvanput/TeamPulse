import { describe, expect, it } from "vitest";
import { discussionInput } from "../../src/lib/rules";
import { beginDiscussion, changeDiscussionTiming, discussionTiming } from "../../src/lib/discussion";

const now = new Date("2026-10-28T10:00:00.000Z");
describe("TD1/2: exact server timing", () => {
  it("starts with exactly five minutes and derives expiry without changing storage", () => {
    const clock = beginDiscussion(now);
    expect(clock).toEqual({ state: "RUNNING", deadlineAt: new Date(now.getTime() + 300000), remainingMs: null, allocatedMs: 300000 });
    expect(discussionTiming(clock, new Date(now.getTime() + 99999))).toEqual({ state: "RUNNING", remainingMs: 200001 });
    expect(discussionTiming(clock, clock.deadlineAt!)).toEqual({ state: "EXPIRED", remainingMs: 0 });
    expect(discussionTiming(clock, new Date(now.getTime() + 900000))).toEqual({ state: "EXPIRED", remainingMs: 0 });
    expect(clock.state).toBe("RUNNING");
  });
  it("preserves exact paused milliseconds and never spends suspended time", () => {
    const paused = changeDiscussionTiming(beginDiscussion(now), "pause", new Date(now.getTime() + 99999));
    expect(paused).toMatchObject({ state: "PAUSED", deadlineAt: null, remainingMs: 200001 });
    const later = new Date(now.getTime() + 900000);
    expect(discussionTiming(paused, later)).toEqual({ state: "PAUSED", remainingMs: 200001 });
    expect(changeDiscussionTiming(paused, "resume", later)).toMatchObject({
      state: "RUNNING", deadlineAt: new Date(later.getTime() + 200001), remainingMs: null
    });
  });
  it("extends running, paused and expired clocks according to their confirmed state", () => {
    const clock = beginDiscussion(now);
    expect(changeDiscussionTiming(clock, "extend", new Date(now.getTime() + 100000))).toMatchObject({
      deadlineAt: new Date(now.getTime() + 420000), allocatedMs: 420000
    });
    const paused = changeDiscussionTiming(clock, "pause", new Date(now.getTime() + 99999));
    expect(changeDiscussionTiming(paused, "extend", now)).toMatchObject({
      state: "PAUSED", remainingMs: 320001, deadlineAt: null, allocatedMs: 420000
    });
    for (const elapsed of [300000, 900000]) {
      expect(changeDiscussionTiming(clock, "extend", new Date(now.getTime() + elapsed))).toMatchObject({
        state: "RUNNING", deadlineAt: new Date(now.getTime() + elapsed + 120000), allocatedMs: 420000
      });
    }
  });
  it.each(["pause", "resume"] as const)("rejects %s at the exact deadline", command => {
    const clock = beginDiscussion(now);
    expect(() => changeDiscussionTiming(clock, command, clock.deadlineAt!)).toThrow(/extend|finish/i);
  });
  it("finishes early, paused or expired without inventing time or another topic", () => {
    const clock = beginDiscussion(now);
    expect(changeDiscussionTiming(clock, "finish", new Date(now.getTime() + 99999))).toMatchObject({ state: "FINISHED", remainingMs: 200001, deadlineAt: null });
    expect(changeDiscussionTiming(clock, "finish", clock.deadlineAt!)).toMatchObject({ state: "FINISHED", remainingMs: 0 });
    const paused = changeDiscussionTiming(clock, "pause", new Date(now.getTime() + 99999));
    expect(changeDiscussionTiming(paused, "finish", new Date(now.getTime() + 900000))).toMatchObject({ state: "FINISHED", remainingMs: 200001 });
  });
  it.each(["pause", "resume", "extend", "finish"] as const)("never restarts finished state through %s", command => {
    const finished = changeDiscussionTiming(beginDiscussion(now), "finish", now);
    expect(() => changeDiscussionTiming(finished, command, now)).toThrow(/finished/i);
  });
  it("rejects state misuse and representational overflow explicitly", () => {
    const clock = beginDiscussion(now);
    expect(() => changeDiscussionTiming(clock, "resume", now)).toThrow(/paused/i);
    const paused = changeDiscussionTiming(clock, "pause", now);
    expect(() => changeDiscussionTiming(paused, "pause", now)).toThrow(/running/i);
    expect(() => changeDiscussionTiming({ ...paused, allocatedMs: 2147483640 }, "extend", now)).toThrow(/exhaust|limit/i);
  });
});
describe("TD4/7: strict discussion commands", () => {
  it("accepts existing version syntax but strips forged timing and actor fields", () => {
    expect(discussionInput.parse({ sessionId: "s", topicId: "t", version: " 3 ", remainingMs: 999999, userId: "forged" }))
      .toEqual({ sessionId: "s", topicId: "t", version: 3 });
  });
  it.each([null, undefined, true, false, "", " ", [], {}, -1, 0.1, Infinity])("rejects malformed version %j", version => {
    expect(discussionInput.safeParse({ sessionId: "s", topicId: "t", version }).success).toBe(false);
  });
});
