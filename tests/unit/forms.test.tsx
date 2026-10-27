// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ActionForm } from "../../src/components/forms";

vi.mock("../../src/app/actions", () => ({
  addAction: vi.fn(), addReview: vi.fn(), addSession: vi.fn()
}));
afterEach(cleanup);

it("AC10 labels capture inputs and uses a required owner selection", () => {
  render(<ActionForm sessionId="session" members={[{ id: "alice", name: "Alice" }]} />);
  expect(screen.getByRole("textbox", { name: "Action title" }).getAttribute("required")).not.toBeNull();
  expect(screen.getByRole("textbox", { name: "Discussion context" })).toBeDefined();
  expect(screen.getByRole("combobox", { name: "Owner" }).getAttribute("required")).not.toBeNull();
  expect(screen.getByLabelText("Due date (optional)")).toBeDefined();
  expect(screen.getByRole("button", { name: "Capture action" })).toBeDefined();
});
