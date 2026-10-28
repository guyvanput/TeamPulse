// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AgendaOrderControls } from "../../src/components/agenda-order-controls";
import type { SessionSnapshot } from "../../src/lib/session-snapshot";

const person = { id: "u", name: "Member" };
const data: SessionSnapshot = {
  id: "s", title: "Session", state: "PAUSED", lifecycleVersion: 4, facilitator: person,
  viewerId: "u", joined: true, facilitatorView: true, participants: [], members: [], actions: [], priorActions: [], reviews: [],
  topics: ["A", "B", "C"].map(id => ({
    id, title: id, description: "Context", author: person, version: 0, removedAt: null, removedBy: null,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z"
  })),
  voting: { state: "FINALIZED", startedAt: null, finalizedAt: null, budget: 3, ballotVersion: 0,
    selectedTopicIds: [], remaining: 3, counts: [], agenda: ["A", "B", "C"].map((topicId, i) => ({ topicId, position: i + 1, count: 0 })),
    canStart: false, canVote: false, canFinalize: false, canResume: false, canClose: false },
  discussion: { sampledAt: "2026-01-01T00:00:00.000Z", current: null, entries: [], allDiscussed: false,
    nextTopicId: "B", canStart: true, canPause: false, canResume: false, canExtend: false, canFinish: false },
  parking: { entries: [] }, summary: { report: null, canGenerate: false },
  administration: { viewerState: "ACTIVE", joinedAt: "2026-01-01T00:00:00.000Z", removedAt: null, canJoin: false, canAdminister: false, entries: [], history: [] },
  agendaOrder: { future: ["B", "C"].map((topicId, i) => ({
    topicId, discussionPosition: i + 2, originalPosition: i + 2, count: 0, parked: topicId === "C",
    earlierTopicId: i === 0 ? null : "B", laterTopicId: i === 0 ? "C" : null, canMoveEarlier: i > 0, canMoveLater: i === 0
  })), history: [] }
};
afterEach(cleanup);
it("MO6/7: exact neighbor/revision commands and disabled boundaries; controls stay in original order with focus across moves", () => {
  const save = vi.fn(async () => true);
  const { rerender } = render(<AgendaOrderControls data={data} enabled save={save} />);
  const button = screen.getByRole("button", { name: "Move C earlier" });
  button.focus();
  fireEvent.click(button);
  expect(save).toHaveBeenCalledWith("move-agenda-topic", { topicId: "C", neighborTopicId: "B", direction: "earlier", version: 4 });
  expect(screen.getByRole("button", { name: "Move A earlier" }).getAttribute("aria-disabled")).toBe("true");
  expect(screen.getByRole("button", { name: "Move B earlier" }).getAttribute("aria-disabled")).toBe("true");
  expect(screen.getByRole("button", { name: "Move C later" }).getAttribute("aria-disabled")).toBe("true");
  const future = [...data.agendaOrder.future].reverse().map((entry, i) => ({
    ...entry, discussionPosition: i + 2, canMoveEarlier: i > 0, canMoveLater: i === 0
  }));
  rerender(<AgendaOrderControls data={{ ...data, lifecycleVersion: 5, agendaOrder: { future, history: [] } }} enabled save={save} />);
  expect(screen.getByRole("button", { name: "Move C earlier" })).toBe(button);
  expect(document.activeElement).toBe(button);
  expect(button.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(button);
  expect(save).toHaveBeenCalledTimes(1);
  expect(within(screen.getByLabelText("Agenda order controls")).getAllByRole("button").map(item => item.textContent))
    .toEqual(["Move A earlier", "Move A later", "Move B earlier", "Move B later", "Move C earlier", "Move C later"]);
  expect(within(screen.getByRole("list", { name: "Future discussion queue" })).getAllByRole("listitem")[0].textContent).toContain("C / Plan slot: 2");
});
it("MO4/6: readers see parked labels and text-only attributed before/after history, without administrative buttons", () => {
  const snapshot: SessionSnapshot = { ...data, facilitatorView: false, agendaOrder: { ...data.agendaOrder, history: [{
    version: 4, topicId: "C", neighborTopicId: "B", direction: "EARLIER", actor: { id: "u", name: "<script>unsafe()</script>" },
    createdAt: "2026-01-01T00:00:00.000Z", beforeQueue: ["B", "C"], afterQueue: ["C", "B"]
  }] } };
  const { container } = render(<AgendaOrderControls data={snapshot} enabled={false} save={vi.fn()} />);
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  expect(screen.getByRole("list", { name: "Agenda order history" }).textContent).toContain("<script>unsafe()</script>");
  expect(container.querySelector("script")).toBeNull();
  expect(screen.getByRole("list", { name: "Future discussion queue" }).textContent).toContain("Parked");
  expect(screen.getByText("Before: B -> C")).toBeDefined();
  expect(screen.getByText("After: C -> B")).toBeDefined();
});
it("MO7: pending/sync/offline and closed capabilities disable every move; pre-finalization controls do not render", () => {
  const save = vi.fn(async () => true);
  const { rerender } = render(<AgendaOrderControls data={data} enabled={false} save={save} />);
  expect(screen.getAllByRole("button").every(item => item.getAttribute("aria-disabled") === "true")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Move C earlier" }));
  expect(save).not.toHaveBeenCalled();
  rerender(<AgendaOrderControls data={{ ...data, state: "CLOSED", agendaOrder: { future: data.agendaOrder.future.map(entry => ({
    ...entry, canMoveEarlier: false, canMoveLater: false
  })), history: [] } }} enabled save={save} />);
  expect(screen.getAllByRole("button").every(item => item.getAttribute("aria-disabled") === "true")).toBe(true);
  rerender(<AgendaOrderControls data={{ ...data, voting: { ...data.voting, state: "OPEN" } }} enabled save={save} />);
  expect(screen.queryByRole("region", { name: "Discussion queue" })).toBeNull();
});
