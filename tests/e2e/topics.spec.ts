import { randomBytes } from "node:crypto";
import { test, expect, type BrowserContext } from "@playwright/test";
import { fixture, cleanFixture, testDatabase } from "../support/database";

const db = testDatabase();
let data: Awaited<ReturnType<typeof fixture>>;
test.beforeEach(async () => {
  data = await fixture(db);
  await db.membership.create({ data: { teamId: data.alpha.id, userId: data.bob.id } });
});
test.afterEach(async () => { if (data) await cleanFixture(db, data); });
test.afterAll(async () => { await db.$disconnect(); });
async function login(context: BrowserContext, userId: string) {
  const sessionToken = randomBytes(32).toString("hex");
  await db.session.create({ data: { userId, sessionToken, expires: new Date(Date.now() + 3_600_000) } });
  await context.addCookies([{ name: "authjs.session-token", value: sessionToken, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }]);
}
async function session() {
  return db.teamSession.create({ data: {
    teamId: data.alpha.id, title: "Facilitated browser session", kind: "FACILITATED",
    facilitatorId: data.alice.id, collectionState: "COLLECTING",
    participants: { create: { userId: data.alice.id } }
  } });
}

test("TC1/2/5/6/8/12: create, join, share, moderate, and close using two browsers", async ({ page, context, browser }) => {
  await login(context, data.alice.id);
  await page.goto("/");
  await page.getByLabel("Facilitated conversation title").fill("Collect improvements");
  await page.getByRole("button", { name: "Create facilitated session" }).click();
  await expect(page.getByRole("heading", { name: "Collect improvements", exact: true })).toBeVisible();
  const url = page.url();
  const second = await browser.newContext();
  try {
    await login(second, data.bob.id);
    const colleague = await second.newPage();
    await colleague.goto(url);
    await expect(colleague.getByRole("button", { name: "Submit topic" })).toBeDisabled();
    await colleague.getByRole("button", { name: "Join session" }).click();
    await expect(colleague.getByRole("button", { name: "Submit topic" })).toBeEnabled();
    await page.getByLabel("Topic title", { exact: true }).fill("Unsaved facilitator draft");
    await colleague.getByLabel("Topic title", { exact: true }).fill("Shared handover");
    await colleague.getByLabel("Topic description (optional)").fill("Team discussion");
    await colleague.getByRole("button", { name: "Submit topic" }).click();
    await expect(colleague.getByText("Change saved.", { exact: true })).toBeVisible();
    const savedAt = Date.now();
    await expect(page.getByRole("heading", { name: "Shared handover", exact: true })).toBeVisible({ timeout: 5000 });
    expect(Date.now() - savedAt).toBeLessThan(5000);
    await expect(page.getByLabel("Topic title", { exact: true })).toHaveValue("Unsaved facilitator draft");
    const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "Shared handover", exact: true }) });
    await card.getByRole("button", { name: "Edit topic", exact: true }).click();
    await card.getByLabel("Edit topic title").fill("Moderated handover");
    await card.getByRole("button", { name: "Save topic" }).click();
    await expect(colleague.getByRole("heading", { name: "Moderated handover" })).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: "Pause collection" }).click();
    await expect(colleague.getByRole("button", { name: "Submit topic" })).toBeDisabled({ timeout: 5000 });
    await expect(colleague.getByRole("button", { name: "Resume collection" })).toHaveCount(0);
    await page.getByRole("button", { name: "Resume collection" }).click();
    await expect(colleague.getByRole("button", { name: "Submit topic" })).toBeEnabled({ timeout: 5000 });
    await page.getByRole("button", { name: "Close session", exact: true }).click();
    await page.getByRole("button", { name: "Cancel close" }).click();
    await expect(page.getByRole("button", { name: "Pause collection" })).toBeEnabled();
    await page.getByRole("button", { name: "Close session", exact: true }).click();
    await page.getByRole("button", { name: "Confirm close" }).click();
    await expect(colleague.getByText("This session is read-only.", { exact: false })).toBeVisible({ timeout: 5000 });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Moderated handover" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit topic" })).toBeDisabled();
  } finally { await second.close(); }
});

test("TC5/8/9: a removed or changed topic preserves an open edit draft", async ({ page, context }) => {
  const own = await session();
  const topic = await db.topic.create({ data: { teamId: data.alpha.id, sessionId: own.id, authorId: data.alice.id, title: "Initial", description: "" } });
  await login(context, data.alice.id);
  await page.goto(`/sessions/${own.id}`);
  await page.getByRole("button", { name: "Edit topic", exact: true }).click();
  await page.getByLabel("Edit topic title").fill("Unsent edit");
  await db.topic.update({ where: { id: topic.id }, data: { removedAt: new Date(), removedById: data.alice.id, version: 1 } });
  await expect(page.getByText("Topic changed or was removed.", { exact: false })).toBeVisible({ timeout: 5000 });
  await expect(page.getByLabel("Edit topic title")).toHaveValue("Unsent edit");
  await expect(page.getByRole("button", { name: "Save topic" })).toBeDisabled();
  await page.getByRole("button", { name: "Cancel edit" }).click();
  await expect(page.getByRole("heading", { name: "Initial", exact: true })).toBeVisible();
  await expect(page.getByText(`By ${data.alice.name}; removed by`, { exact: false })).toBeVisible();
});

test("TC3/9: snapshot API is private, typed, uncached and clears the workspace on expiry", async ({ page, context }) => {
  const own = await session();
  const unauthenticated = await page.request.get(`/api/sessions/${own.id}/snapshot`);
  expect(unauthenticated.status()).toBe(401);
  await login(context, data.alice.id);
  await page.goto(`/sessions/${own.id}`);
  const response = await page.request.get(`/api/sessions/${own.id}/snapshot`);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const payload = JSON.stringify(await response.json());
  expect(payload).not.toMatch(/sessionToken|access_token|emailVerified|accounts/);
  await page.getByLabel("Topic title", { exact: true }).fill("Sensitive draft");
  await context.clearCookies();
  await expect(page.getByRole("heading", { name: "Session access unavailable" })).toBeVisible({ timeout: 5000 });
  await expect(page.getByLabel("Topic title", { exact: true })).toHaveCount(0);
  await expect(page.getByText(own.title, { exact: true })).toHaveCount(0);
});

test("TC9: offline drafts remain; retry restores writes without clearing input or focus", async ({ page, context }) => {
  const own = await session();
  await login(context, data.alice.id);
  await page.goto(`/sessions/${own.id}`);
  await page.getByLabel("Topic title", { exact: true }).fill("Offline draft");
  await context.setOffline(true);
  await expect(page.getByText("Updates unavailable.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit topic" })).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByRole("button", { name: "Submit topic" })).toBeEnabled({ timeout: 5000 });
  await expect(page.getByLabel("Topic title", { exact: true })).toHaveValue("Offline draft");
  await page.getByLabel("Topic title", { exact: true }).focus();
  await expect.poll(async () => {
    const text = await page.getByLabel("Topic title", { exact: true }).inputValue();
    return text;
  }).toBe("Offline draft");
  await expect(page.getByLabel("Topic title", { exact: true })).toBeFocused();
});

test("TC9/10: action and review drafts survive closure and remote completion", async ({ page, context }) => {
  const own = await session();
  const legacy = await db.teamSession.create({ data: { teamId: data.alpha.id, title: "Earlier", createdAt: new Date("2026-01-01") } });
  const action = await db.action.create({ data: { teamId: data.alpha.id, sourceSessionId: legacy.id, ownerId: data.alice.id, title: "Commitment" } });
  await login(context, data.alice.id);
  await page.goto(`/sessions/${own.id}`);
  await page.getByLabel("Action title", { exact: true }).fill("Unsent action");
  await page.getByLabel("Progress note", { exact: true }).fill("Unsent progress");
  await db.action.update({ where: { id: action.id }, data: { status: "DONE" } });
  await db.teamSession.update({ where: { id: own.id }, data: { collectionState: "CLOSED", lifecycleVersion: 1, closedAt: new Date() } });
  await expect(page.getByText("This session is read-only.", { exact: false })).toBeVisible({ timeout: 5000 });
  await expect(page.getByLabel("Action title", { exact: true })).toHaveValue("Unsent action");
  await expect(page.getByRole("textbox", { name: "Progress note", exact: true })).toHaveValue("Unsent progress");
  await expect(page.getByRole("button", { name: "Record review" })).toBeDisabled();
});

test("TC4/5/12: keyboard topic validation, text rendering and confirmed removal", async ({ page, context }) => {
  const own = await session();
  await login(context, data.alice.id);
  await page.goto(`/sessions/${own.id}`);
  const title = page.getByRole("textbox", { name: "Topic title", exact: true });
  await title.focus();
  await page.keyboard.type("   ");
  await page.getByRole("button", { name: "Submit topic" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "A title is required." })).toBeVisible();
  expect(await db.topic.count({ where: { sessionId: own.id } })).toBe(0);
  await title.fill("<script>not executable</script>");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("textbox", { name: "Topic description (optional)" })).toBeFocused();
  await page.keyboard.type("Discuss this");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "<script>not executable</script>", exact: true })).toBeVisible();
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "<script>not executable</script>", exact: true }) });
  await card.getByRole("button", { name: "Remove topic", exact: true }).click();
  await card.getByRole("button", { name: "Cancel removal" }).click();
  expect(await db.topic.count({ where: { sessionId: own.id, removedAt: null } })).toBe(1);
  await card.getByRole("button", { name: "Remove topic", exact: true }).click();
  await card.getByRole("button", { name: "Confirm remove" }).click();
  await expect(page.getByText("No topics submitted yet.")).toBeVisible();
  const history = page.locator("section").filter({ has: page.getByRole("heading", { name: "Removed topic history", exact: true }) });
  await expect(history.getByRole("heading", { name: "<script>not executable</script>", exact: true })).toBeVisible();
  await page.reload();
  await expect(history.getByText("Discuss this")).toBeVisible();
});

test("TC9: invalid snapshot and failed saves are explicit and preserve drafts", async ({ page, context }) => {
  const own = await session();
  await login(context, data.alice.id);
  await page.goto(`/sessions/${own.id}`);
  await page.getByRole("textbox", { name: "Topic title", exact: true }).fill("Retained");
  await page.route("**/api/sessions/*/snapshot", route => route.fulfill({ json: { unexpected: "invalid" } }));
  await expect(page.getByText("Updates unavailable.", { exact: false })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("button", { name: "Submit topic" })).toBeDisabled();
  await page.unroute("**/api/sessions/*/snapshot");
  await page.getByRole("button", { name: "Retry updates" }).click();
  await expect(page.getByRole("button", { name: "Submit topic" })).toBeEnabled();
  await page.route("**/sessions/*", async route => {
    if (route.request().method() === "POST") await route.abort("failed");
    else await route.continue();
  });
  await page.getByRole("button", { name: "Submit topic" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Save could not be confirmed" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Topic title", exact: true })).toHaveValue("Retained");
  expect(await db.topic.count({ where: { sessionId: own.id } })).toBe(0);
});

test("TC8/9: returning to visibility refreshes within five seconds without focus theft", async ({ page, context }) => {
    const own = await session();
    await login(context, data.alice.id);
    await page.goto(`/sessions/${own.id}`);
    await page.getByRole("textbox", { name: "Topic title", exact: true }).fill("Keep this draft");
    await page.getByRole("textbox", { name: "Topic title", exact: true }).focus();
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await db.topic.create({ data: { teamId: data.alpha.id, sessionId: own.id, authorId: data.alice.id, title: "While hidden" } });
    const returnedAt = Date.now();
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.getByRole("heading", { name: "While hidden", exact: true })).toBeVisible({ timeout: 5000 });
    expect(Date.now() - returnedAt).toBeLessThan(5000);
    await expect(page.getByRole("textbox", { name: "Topic title", exact: true })).toBeFocused();
    await expect(page.getByRole("textbox", { name: "Topic title", exact: true })).toHaveValue("Keep this draft");
  });

test("TC9: a slow stale read cannot overwrite a confirmed local mutation", async ({ page, context }) => {
    const own = await session();
    await login(context, data.alice.id);
    await page.goto(`/sessions/${own.id}`);
    const old = await (await page.request.get(`/api/sessions/${own.id}/snapshot`)).json();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let first = true;
    await page.route("**/api/sessions/*/snapshot", async route => {
      if (!first) { await route.continue(); return; }
      first = false;
      await gate;
      await route.fulfill({ json: old });
    });
    try {
      const read = page.waitForRequest(request => request.url().endsWith("/snapshot"));
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await read;
      await page.getByRole("textbox", { name: "Topic title", exact: true }).fill("Confirmed new topic");
      await page.getByRole("button", { name: "Submit topic" }).click();
      await expect(page.getByText("Change saved.", { exact: true })).toBeVisible();
      release();
      await expect(page.getByRole("heading", { name: "Confirmed new topic" })).toBeVisible({ timeout: 5000 });
      const nextRead = page.waitForResponse(response => response.url().endsWith("/snapshot") && response.status() === 200);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await nextRead;
      await expect(page.getByRole("heading", { name: "Confirmed new topic" })).toBeVisible();
    } finally { release(); }
});
