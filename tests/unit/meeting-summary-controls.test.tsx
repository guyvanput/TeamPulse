// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MeetingSummary } from "../../src/components/meeting-summary";
import type { SessionSnapshot } from "../../src/lib/session-snapshot";
import type { SummaryReport } from "../../src/lib/meeting-summary";

const person = { id: "u", name: "Member" };
const report: SummaryReport = {
  formatVersion: 1, generatedAt: "2026-01-01T00:00:00.000Z", generatedBy: person, note: "<script>Wrap-up</script>",
  content: {
    session: { id: "s", title: "Session", facilitator: person }, participants: [{ ...person, joinedAt: "2026-01-01T00:00:00.000Z" }],
    votingState: "NOT_STARTED",
    topics: [{ id: "t", title: "Topic", description: "<img src=x onerror=unsafe()>", originalPosition: null,
      discussionPosition: null, voteCount: null, outcome: "NOT_DISCUSSED", reason: null }],
    actions: [{ id: "a", title: "Commitment", context: "Context", owner: person, dueDate: "2026-01-02", status: "DONE",
      source: { id: "earlier", title: "Earlier" }, createdHere: false,
      reviews: [{ id: "r", actor: person, createdAt: "2026-01-01T00:00:00.000Z", note: "Earlier progress", resultingStatus: "IN_PROGRESS" }] }]
  }
};
const data: Pick<SessionSnapshot, "summary" | "state" | "lifecycleVersion"> = {
  state: "CLOSED", lifecycleVersion: 8, summary: { canGenerate: true, report: null }
};
afterEach(cleanup);
it("MS1/3: explicit permanent confirmation captures the exact draft/version; cancel and failure retain the editable note", async () => {
  const save = vi.fn(async () => false);
  render(<MeetingSummary data={data} enabled save={save} />);
  const note = screen.getByRole("textbox", { name: "Facilitator wrap-up (optional)" });
  fireEvent.change(note, { target: { value: "  conclusions  " } });
  fireEvent.click(screen.getByRole("button", { name: "Generate summary" }));
  expect(screen.getByText(/permanent report/)).toBeDefined();
  expect(screen.getByText(/at generation, not at meeting close/)).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Cancel summary creation" }));
  expect((note as HTMLTextAreaElement).value).toBe("  conclusions  ");
  fireEvent.click(screen.getByRole("button", { name: "Generate summary" }));
  fireEvent.change(note, { target: { value: "New unsaved draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm generate summary" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith("generate-summary", { note: "  conclusions  ", version: 8 }));
  expect((note as HTMLTextAreaElement).value).toBe("New unsaved draft");
  expect(screen.getByText("No summary has been generated.")).toBeDefined();
});
it("MS1/5/6: revision changes, unavailable state and server capability prevent generation without deleting confirmation/draft", () => {
  const save = vi.fn(async () => true);
  const { rerender } = render(<MeetingSummary data={data} enabled save={save} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Keep draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate summary" }));
  const confirm = screen.getByRole("button", { name: "Confirm generate summary" });
  confirm.focus();
  rerender(<MeetingSummary data={{ ...data, lifecycleVersion: 9 }} enabled save={save} />);
  expect(confirm.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(confirm);
  expect(save).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(confirm);
  rerender(<MeetingSummary data={data} enabled={false} save={save} />);
  fireEvent.click(confirm);
  expect(save).not.toHaveBeenCalled();
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Keep draft");
  rerender(<MeetingSummary data={{ ...data, summary: { canGenerate: false, report: null } }} enabled save={save} />);
  expect(screen.queryByRole("button", { name: "Generate summary" })).toBeNull();
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Keep draft");
});
it("MS3/5/6: a remote winner shows the saved report, retains the unused note and its focused editor until explicit dismissal", () => {
  const save = vi.fn(async () => true);
  const { rerender } = render(<MeetingSummary data={data} enabled save={save} />);
  const note = screen.getByRole("textbox");
  fireEvent.change(note, { target: { value: "My unused conclusions" } });
  note.focus();
  rerender(<MeetingSummary data={{ ...data, summary: { canGenerate: false, report } }} enabled save={save} />);
  expect(screen.getByRole("region", { name: "Saved meeting summary" })).toBeDefined();
  expect(screen.getByText(/not included in the saved report/)).toBeDefined();
  expect(screen.getByRole("textbox")).toBe(note);
  expect(document.activeElement).toBe(note);
  expect((note as HTMLTextAreaElement).value).toBe("My unused conclusions");
  expect(screen.queryByRole("button", { name: "Confirm generate summary" })).toBeNull();
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss retained draft" }));
  expect(screen.queryByRole("textbox")).toBeNull();
});
it("MS2/3/4: report is text only, honest about unheld voting and current-action links, with distinct captured and review statuses", () => {
  const { container } = render(<MeetingSummary data={{ ...data, summary: { canGenerate: false, report } }} enabled={false} save={vi.fn()} />);
  expect(screen.getByText("Voting: Not held")).toBeDefined();
  expect(screen.getByText("<script>Wrap-up</script>")).toBeDefined();
  expect(screen.getByText("<img src=x onerror=unsafe()>")).toBeDefined();
  expect(container.querySelector("script, img")).toBeNull();
  expect(screen.getByRole("heading", { name: "Action details at summary generation" })).toBeDefined();
  expect(screen.getByText("Status at generation: Done")).toBeDefined();
  expect(screen.getByText(/Recorded result: In progress/)).toBeDefined();
  expect(screen.getByRole("link", { name: "View current action: Commitment" }).getAttribute("href")).toBe("/actions/a");
  expect(screen.queryAllByRole("button")).toHaveLength(0);
});
