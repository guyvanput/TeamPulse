// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ParkingControls } from "../../src/components/parking-controls";
import type { SessionSnapshot } from "../../src/lib/session-snapshot";

const data: SessionSnapshot = {
  id: "s", title: "Session", state: "PAUSED", lifecycleVersion: 4,
  facilitator: { id: "u", name: "Member" }, viewerId: "u", joined: true, facilitatorView: true,
  participants: [], members: [], actions: [], priorActions: [], reviews: [],
  topics: [{ id: "t", title: "Topic", description: "Context", author: { id: "u", name: "Member" },
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", version: 0, removedAt: null, removedBy: null }],
  voting: { state: "FINALIZED", startedAt: null, finalizedAt: null, budget: 3, ballotVersion: 0,
    selectedTopicIds: [], remaining: 3, counts: [], agenda: [{ topicId: "t", position: 1, count: 0 }],
    canStart: false, canVote: false, canFinalize: false, canResume: false, canClose: false },
  discussion: { sampledAt: "2026-01-01T00:00:00.000Z", current: null,
    entries: [{ topicId: "t", state: "NOT_STARTED", attempts: [] }], allDiscussed: false,
    nextTopicId: "t", canStart: true, canPause: false, canResume: false, canExtend: false, canFinish: false },
  parking: { entries: [{ topicId: "t", parked: false, canPark: true, canRestore: false, events: [] }] },
  agendaOrder: { future: [], history: [] }, summary: { report: null, canGenerate: false },
  administration: { viewerState: "ACTIVE", joinedAt: "2026-01-01T00:00:00.000Z", removedAt: null, canJoin: false, canAdminister: false, entries: [], history: [] }
};
afterEach(cleanup);
it("PL7/8: cancel and remote changes preserve drafts, focus and captured confirmation revision", () => {
  const save = vi.fn(async () => true);
  const { rerender } = render(<ParkingControls data={data} enabled save={save} />);
  const reason = screen.getByRole("textbox", { name: "Parking reason for Topic" });
  fireEvent.change(reason, { target: { value: "Keep draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Park Topic" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel parking change" }));
  expect(reason).toHaveProperty("value", "Keep draft");
  fireEvent.click(screen.getByRole("button", { name: "Park Topic" }));
  rerender(<ParkingControls data={{ ...data, lifecycleVersion: 5 }} enabled save={save} />);
  expect(screen.getByRole("button", { name: "Confirm park topic" }).getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Confirm park topic" }));
  expect(reason).toHaveProperty("value", "Keep draft");
  expect(save).not.toHaveBeenCalled();
});
it("PL7: reasons render as text and nonfacilitators read history without administrative controls", () => {
  const parked: SessionSnapshot = { ...data, facilitatorView: false, joined: false,
    parking: { entries: [{ topicId: "t", parked: true, canPark: false, canRestore: false,
      events: [{ kind: "PARK", version: 5, reason: "<script>unsafe()</script>", actor: data.facilitator,
        createdAt: "2026-01-01T00:01:00.000Z", attemptNumber: null }] }] } };
  const { container } = render(<ParkingControls data={parked} enabled={false} save={vi.fn()} />);
  expect(screen.getByText("<script>unsafe()</script>")).toBeDefined();
  expect(container.querySelector("script")).toBeNull();
  expect(screen.queryAllByRole("button")).toHaveLength(0);
});
it("PL8: unavailable controls cannot submit and a failed save retains the reason", async () => {
  const save = vi.fn(async () => false);
  const { rerender } = render(<ParkingControls data={data} enabled={false} save={save} />);
  expect(screen.getByRole("button", { name: "Park Topic" }).getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Park Topic" }));
  expect(save).not.toHaveBeenCalled();
  rerender(<ParkingControls data={data} enabled save={save} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Parking reason for Topic" }), { target: { value: "Retain" } });
  fireEvent.click(screen.getByRole("button", { name: "Park Topic" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm park topic" }));
  await vi.waitFor(() => expect(save).toHaveBeenCalledWith("park-topic", { topicId: "t", version: 4, reason: "Retain" }));
  expect(screen.getByRole("textbox", { name: "Parking reason for Topic" })).toHaveProperty("value", "Retain");
});
it("RM6: role loss retains the focused parking draft and blocks both initial and confirmed commands", () => {
  const save = vi.fn(async () => true);
  const { rerender } = render(<ParkingControls data={data} enabled save={save} retainControls />);
  const reason = screen.getByRole("textbox", { name: "Parking reason for Topic" });
  fireEvent.change(reason, { target: { value: "Keep unsaved parking draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Park Topic" }));
  reason.focus();
  rerender(<ParkingControls data={{ ...data, facilitatorView: false }} enabled save={save} retainControls />);
  expect(document.activeElement).toBe(reason);
  expect(reason).toHaveProperty("value", "Keep unsaved parking draft");
  expect(reason).toHaveProperty("readOnly", true);
  fireEvent.click(screen.getByRole("button", { name: "Park Topic" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm park topic" }));
  expect(save).not.toHaveBeenCalled();
});
