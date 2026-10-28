// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DiscussionControls } from "../../src/components/discussion-controls";
import type { SessionSnapshot } from "../../src/lib/session-snapshot";

const data: SessionSnapshot = {
  id: "s", title: "Session", state: "PAUSED", lifecycleVersion: 4,
  facilitator: { id: "u", name: "Member" }, viewerId: "u", joined: true, facilitatorView: true,
  participants: [], members: [], actions: [], priorActions: [], reviews: [],
  topics: [{ id: "t", title: "Topic", description: "", author: { id: "u", name: "Member" },
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", version: 0, removedAt: null, removedBy: null }],
  voting: { state: "FINALIZED", startedAt: null, finalizedAt: null, budget: 3, ballotVersion: 0,
    selectedTopicIds: [], remaining: 3, counts: [], agenda: [{ topicId: "t", position: 1, count: 0 }],
    canStart: false, canVote: false, canFinalize: false, canResume: false, canClose: false },
  discussion: { sampledAt: "2026-01-01T00:00:00.000Z",
    current: { topicId: "t", attemptNumber: 1, state: "RUNNING", deadlineAt: "2026-01-01T00:05:00.000Z", remainingMs: 300000 },
    entries: [], allDiscussed: false, nextTopicId: null, canStart: false, canPause: true, canResume: false, canExtend: true, canFinish: true },
  parking: { entries: [] }, agendaOrder: { future: [], history: [] }, summary: { report: null, canGenerate: false },
  administration: { viewerState: "ACTIVE", joinedAt: "2026-01-01T00:00:00.000Z", removedAt: null, canJoin: false, canAdminister: false, entries: [], history: [] }
};
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("TD2/6: ticks monotonically without writes, wall-clock dependence or per-second live announcements", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance", "Date"] });
  const save = vi.fn(async () => true);
  render(<DiscussionControls data={data} anchor={{ receivedAt: performance.now(), transitMs: 0 }} available enabled save={save} />);
  expect(screen.getByRole("timer").textContent).toBe("5:00");
  expect(screen.getByRole("timer").getAttribute("aria-live")).toBe("off");
  act(() => { vi.setSystemTime(new Date("2099-01-01")); vi.advanceTimersByTime(1250); });
  expect(screen.getByRole("timer").textContent).toBe("4:59");
  act(() => { vi.advanceTimersByTime(600000); });
  expect(screen.getByRole("timer").textContent).toBe("0:00");
  expect(save).not.toHaveBeenCalled();
});
it("TD6/7: synchronization/stale state cannot expose a usable timer command", () => {
  const save = vi.fn(async () => true);
  const { rerender } = render(<DiscussionControls data={data} anchor={null} available enabled save={save} />);
  expect(screen.getByText("Synchronizing timer...")).toBeDefined();
  expect(screen.getByRole("button", { name: "Pause timer" }).getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Pause timer" }));
  expect(save).not.toHaveBeenCalled();
  rerender(<DiscussionControls data={data} anchor={{ receivedAt: 0, transitMs: 0 }} available={false} enabled={false} save={save} />);
  expect(screen.getByText(/Timer stale/)).toBeDefined();
  expect(screen.queryByRole("timer")).toBeNull();
});
it("TD4: stale finish confirmation keeps its captured topic/version and cancel writes nothing", () => {
  const save = vi.fn(async () => true);
  const anchor = { receivedAt: performance.now(), transitMs: 0 };
  const { rerender } = render(<DiscussionControls data={data} anchor={anchor} available enabled save={save} />);
  fireEvent.click(screen.getByRole("button", { name: "Finish topic" }));
  rerender(<DiscussionControls data={{ ...data, lifecycleVersion: 5 }} anchor={anchor} available enabled save={save} />);
  expect(screen.getByRole("button", { name: "Confirm finish topic" }).getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Confirm finish topic" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel finish topic" }));
  expect(save).not.toHaveBeenCalled();
});
it("RM6: retained timer controls preserve focus but never retain facilitator permission", () => {
  const save = vi.fn(async () => true);
  const anchor = { receivedAt: performance.now(), transitMs: 0 };
  const { rerender } = render(<DiscussionControls data={data} anchor={anchor} available enabled save={save} retainControls />);
  const button = screen.getByRole("button", { name: "Pause timer" });
  button.focus();
  rerender(<DiscussionControls data={{ ...data, facilitatorView: false }} anchor={anchor} available enabled save={save} retainControls />);
  expect(document.activeElement).toBe(button);
  expect(button.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(button);
  expect(save).not.toHaveBeenCalled();
});
