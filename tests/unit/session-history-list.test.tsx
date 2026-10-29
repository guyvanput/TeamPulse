// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SessionHistory } from "../../src/components/session-history";
import type { HistoryPage, HistoryRow } from "../../src/lib/session-history";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n: number, patch: Partial<HistoryRow> = {}): HistoryRow => ({
  id: uuid(n), title: `Session ${n}`, createdAt: "2026-10-28T10:00:00.000Z", kind: "FACILITATED", lifecycle: "COLLECTING",
  facilitatorName: "Alice", topicCount: 2, openActionCount: 1, summaryAvailable: null, ...patch
});
const cursor = "AAAA";
const page = (rows: HistoryRow[], filter: HistoryPage["filter"] = "ALL", nextCursor: string | null = null): HistoryPage => ({ filter, rows, nextCursor });
afterEach(cleanup);

it("SH1/5/7: rows show lifecycle, facilitator, counts and summary signal; legacy rows show no facilitated details", () => {
  render(<SessionHistory teamId="t" initial={page([
    row(1, { lifecycle: "CLOSED", summaryAvailable: true }),
    row(2, { lifecycle: "CLOSED", summaryAvailable: false, topicCount: 1, openActionCount: 0 }),
    row(3, { kind: "ACTION_FOLLOW_UP", lifecycle: "ACTION_FOLLOW_UP", facilitatorName: null, topicCount: null, summaryAvailable: null })
  ])} load={vi.fn()} />);
  const items = screen.getAllByRole("listitem");
  expect(items).toHaveLength(3);
  expect(within(items[0]).getByRole("link", { name: "Session 1" }).getAttribute("href")).toBe(`/sessions/${uuid(1)}`);
  expect(items[0].textContent).toContain("Closed");
  expect(items[0].textContent).toContain("Facilitator: Alice");
  expect(items[0].textContent).toContain("2 topics");
  expect(items[0].textContent).toContain("1 open action");
  expect(items[0].textContent).toContain("Summary available");
  expect(items[1].textContent).toContain("1 topic");
  expect(items[1].textContent).toContain("0 open actions");
  expect(items[1].textContent).toContain("No summary yet");
  expect(items[2].textContent).toContain("Action follow-up");
  expect(items[2].textContent).not.toContain("Facilitator");
  expect(items[2].textContent).not.toContain("topic");
  expect(items[2].textContent).not.toContain("summary");
  expect(screen.getByText(/Counts are as of the last load/)).toBeDefined();
});

it("SH3: Load more sends the cursor once, appends without duplicates and moves focus to the first new row", async () => {
  let resolve!: (value: HistoryPage) => void;
  const load = vi.fn(() => new Promise<HistoryPage>((done) => { resolve = done; }));
  render(<SessionHistory teamId="t" initial={page([row(1), row(2)], "ALL", cursor)} load={load} />);
  const more = screen.getByRole("button", { name: "Load more sessions" });
  fireEvent.click(more);
  fireEvent.click(more);
  expect(load).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledWith("t", { filter: "ALL", cursor });
  expect(screen.getByRole("status").textContent).toContain("Loading");
  expect((more as HTMLButtonElement).getAttribute("aria-disabled")).toBe("true");
  resolve(page([row(2), row(3), row(4)]));
  await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(4));
  expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Session 1", "Session 2", "Session 3", "Session 4"]);
  expect(screen.queryByRole("button", { name: "Load more sessions" })).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("link", { name: "Session 3" })));
});

it("SH4: changing the filter restarts from the first page and replaces rows", async () => {
  const load = vi.fn(async (_team: string, request: { filter: HistoryPage["filter"]; cursor: string | null }) =>
    page([row(9, { lifecycle: "CLOSED", summaryAvailable: false })], request.filter));
  render(<SessionHistory teamId="t" initial={page([row(1), row(2)], "ALL", cursor)} load={load} />);
  expect((screen.getByRole("radio", { name: "All" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: "Closed" }));
  await waitFor(() => expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Session 9"]));
  expect(load).toHaveBeenCalledWith("t", { filter: "CLOSED", cursor: null });
  expect((screen.getByRole("radio", { name: "Closed" }) as HTMLInputElement).checked).toBe(true);
});

it("SH6: a failed page keeps loaded rows and Retry replays the same request", async () => {
  const load = vi.fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(page([row(3)]));
  render(<SessionHistory teamId="t" initial={page([row(1), row(2)], "ALL", cursor)} load={load} />);
  fireEvent.click(screen.getByRole("button", { name: "Load more sessions" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Could not load more sessions");
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
  expect(load).toHaveBeenNthCalledWith(2, "t", { filter: "ALL", cursor });
  expect(screen.queryByRole("alert")).toBeNull();
});

it("SH6: a failed filter change keeps the previous list and filter, then Retry applies it", async () => {
  const load = vi.fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(page([row(7, { lifecycle: "CLOSED", summaryAvailable: false })], "CLOSED"));
  render(<SessionHistory teamId="t" initial={page([row(1)])} load={load} />);
  fireEvent.click(screen.getByRole("radio", { name: "Closed" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Showing the previous list");
  expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Session 1"]);
  expect((screen.getByRole("radio", { name: "All" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Session 7"]));
  expect((screen.getByRole("radio", { name: "Closed" }) as HTMLInputElement).checked).toBe(true);
});

it("SH4/6: a slow response for an old filter is ignored after a newer filter choice", async () => {
  const resolvers: Record<string, (value: HistoryPage) => void> = {};
  const load = vi.fn((_team: string, request: { filter: HistoryPage["filter"] }) =>
    new Promise<HistoryPage>((done) => { resolvers[request.filter] = done; }));
  render(<SessionHistory teamId="t" initial={page([row(1)])} load={load} />);
  fireEvent.click(screen.getByRole("radio", { name: "Closed" }));
  fireEvent.click(screen.getByRole("radio", { name: "In progress" }));
  resolvers.IN_PROGRESS(page([row(5)], "IN_PROGRESS"));
  await waitFor(() => expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Session 5"]));
  resolvers.CLOSED(page([row(6, { lifecycle: "CLOSED", summaryAvailable: true })], "CLOSED"));
  await Promise.resolve();
  expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Session 5"]);
  expect((screen.getByRole("radio", { name: "In progress" }) as HTMLInputElement).checked).toBe(true);
});

it("SH6: a response for a different filter or malformed rows is treated as a failure", async () => {
  const load = vi.fn()
    .mockResolvedValueOnce(page([row(8)], "ALL"))
    .mockResolvedValueOnce({ filter: "CLOSED", rows: [{ id: "x" }], nextCursor: null });
  render(<SessionHistory teamId="t" initial={page([row(1)])} load={load} />);
  fireEvent.click(screen.getByRole("radio", { name: "Closed" }));
  await screen.findByRole("alert");
  expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Session 1"]);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1));
  expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Session 1"]);
});

it("SH4: empty states are explicit for each filter", async () => {
  const load = vi.fn(async (_team: string, request: { filter: HistoryPage["filter"] }) => page([], request.filter));
  render(<SessionHistory teamId="t" initial={page([])} load={load} />);
  expect(screen.getByText("No sessions yet. Start your first one.")).toBeDefined();
  fireEvent.click(screen.getByRole("radio", { name: "In progress" }));
  await screen.findByText("No sessions in progress.");
  fireEvent.click(screen.getByRole("radio", { name: "Closed" }));
  await screen.findByText("No closed sessions yet.");
});
