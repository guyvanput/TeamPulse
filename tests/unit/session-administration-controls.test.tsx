// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SessionAdministration } from "../../src/components/session-administration";
import type { SessionSnapshot } from "../../src/lib/session-snapshot";

const joinedAt = "2026-01-01T00:00:00.000Z";
const data: Pick<SessionSnapshot, "administration" | "facilitator" | "lifecycleVersion"> = {
  facilitator: { id: "alice", name: "Alice" }, lifecycleVersion: 4,
  administration: { viewerState: "ACTIVE", joinedAt, removedAt: null, canJoin: false, canAdminister: true,
    entries: [
      { id: "alice", name: "Alice", joinedAt, removedAt: null, inTeam: true, canTransfer: false, canRemove: false, canReadmit: false },
      { id: "bob", name: "Bob", joinedAt, removedAt: null, inTeam: true, canTransfer: true, canRemove: true, canReadmit: false }
    ], history: [] }
};
afterEach(cleanup);
it("RM5: named confirmation captures reason and revision; cancel/failure preserve drafts and never adopt edits", async () => {
  const save = vi.fn(async () => false);
  render(<SessionAdministration data={data} enabled save={save} />);
  const reason = screen.getByRole("textbox", { name: "Removal reason for Bob" });
  fireEvent.change(reason, { target: { value: "  <script>reason</script>  " } });
  fireEvent.click(screen.getByRole("button", { name: "Remove Bob" }));
  expect(screen.getByText(/same-team read access/)).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Cancel administration change" }));
  expect((reason as HTMLTextAreaElement).value).toContain("<script>reason</script>");
  fireEvent.click(screen.getByRole("button", { name: "Remove Bob" }));
  fireEvent.change(reason, { target: { value: "New unsaved reason" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm remove Bob" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith("remove-participant", { targetId: "bob", version: 4, reason: "  <script>reason</script>  " }));
  expect((reason as HTMLTextAreaElement).value).toBe("New unsaved reason");
  expect(document.querySelector("script")).toBeNull();
});
it("RM5/6: revision, current target state, permission loss and unavailability guard retained focused confirmation", () => {
  const save = vi.fn(async () => true);
  const { rerender } = render(<SessionAdministration data={data} enabled save={save} />);
  fireEvent.click(screen.getByRole("button", { name: "Transfer facilitation to Bob" }));
  const confirm = screen.getByRole("button", { name: "Confirm transfer to Bob" });
  confirm.focus();
  const revoked = { ...data, administration: { ...data.administration, canAdminister: false,
    entries: data.administration.entries.map(entry => ({ ...entry, canTransfer: false, canRemove: false, canReadmit: false })) } };
  for (const [next, enabled] of [[{ ...data, lifecycleVersion: 5 }, true], [data, false], [revoked, true]] as const) {
    rerender(<SessionAdministration data={next} enabled={enabled} save={save} />);
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(confirm);
    expect(save).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(confirm);
  }
});
it("RM4/5: readmission is explicit and preserves prior identity and vote budget; successful removal clears only its unchanged reason", async () => {
  const save = vi.fn(async () => true);
  const removed = { ...data, administration: { ...data.administration,
    entries: data.administration.entries.map(entry => entry.id === "bob"
      ? { ...entry, removedAt: joinedAt, canTransfer: false, canRemove: false, canReadmit: true } : entry) } };
  const { rerender } = render(<SessionAdministration data={removed} enabled save={save} />);
  fireEvent.click(screen.getByRole("button", { name: "Readmit Bob" }));
  expect(screen.getByText(/original join history and used voting budget/)).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Confirm readmit Bob" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith("readmit-participant", { targetId: "bob", version: 4 }));
  rerender(<SessionAdministration data={data} enabled save={save} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Removal reason for Bob" }), { target: { value: "Submitted reason" } });
  fireEvent.click(screen.getByRole("button", { name: "Remove Bob" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm remove Bob" }));
  await waitFor(() => expect((screen.getByRole("textbox", { name: "Removal reason for Bob" }) as HTMLTextAreaElement).value).toBe(""));
});
it("RM6/7: initial readers have no controls; historical names/reasons are text and removed viewers get honest read-only guidance", () => {
  const { container } = render(<SessionAdministration data={{ ...data, administration: {
    ...data.administration, viewerState: "REMOVED", removedAt: joinedAt, canAdminister: false,
    entries: data.administration.entries.map(entry => ({ ...entry, canTransfer: false, canRemove: false, canReadmit: false })),
    history: [{ version: 4, kind: "REMOVE", actor: { id: "alice", name: "Alice" },
      target: { id: "bob", name: "Bob" }, createdAt: joinedAt, reason: "<img src=x onerror=unsafe()>" }]
  } }} enabled save={vi.fn()} />);
  expect(screen.getByText(/ask the current facilitator to readmit you/)).toBeDefined();
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  expect(screen.getByText(/<img src=x onerror=unsafe\(\)>/)).toBeDefined();
  expect(container.querySelector("img")).toBeNull();
});
