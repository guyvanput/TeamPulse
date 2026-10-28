import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
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
  await db.session.create({ data: { userId, sessionToken, expires: new Date(Date.now() + 3600000) } });
  await context.addCookies([{ name: "authjs.session-token", value: sessionToken, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }]);
}
async function prepared(closed = true) {
  const session = await db.teamSession.create({ data: {
    teamId: data.alpha.id, title: "Summary browser meeting", kind: "FACILITATED", facilitatorId: data.alice.id,
    collectionState: closed ? "CLOSED" : "COLLECTING", closedAt: closed ? new Date() : null,
    lifecycleVersion: closed ? 1 : 0, participants: { create: { userId: data.alice.id } }
  } });
  await db.topic.create({ data: {
    teamId: data.alpha.id, sessionId: session.id, authorId: data.alice.id, title: "Summary topic", description: "<script>Submitted context</script>"
  } });
  return session;
}
async function command(page: Page, name: string) {
  const response = page.waitForResponse(response => response.request().method() === "POST" && response.url().includes("/sessions/"));
  await page.getByRole("button", { name, exact: true }).click();
  await response;
  return Date.now();
}
const report = (page: Page) => page.getByRole("region", { name: "Saved meeting summary", exact: true });

test("MS1/2/3/4/6: distinct visible readers see one confirmed plain-text report; keyboard, stable drafts and later live action progress", async ({ page, context, browser }) => {
  const session = await prepared(false);
  const action = await db.action.create({ data: {
    teamId: data.alpha.id, sourceSessionId: session.id, ownerId: data.alice.id,
    title: "Summary commitment", context: "Original commitment context", status: "IN_PROGRESS", dueDate: new Date("2026-11-01")
  } });
  await login(context, data.alice.id);
  await page.goto(`/sessions/${session.id}`);
  await page.getByRole("textbox", { name: "Action title", exact: true }).fill("Keep closed action draft");
  const second = await browser.newContext();
  try {
    await login(second, data.bob.id);
    const colleague = await second.newPage();
    await colleague.goto(page.url());
    expect(await page.evaluate(() => document.visibilityState)).toBe("visible");
    expect(await colleague.evaluate(() => document.visibilityState)).toBe("visible");
    await expect(colleague.getByRole("button", { name: "Generate summary", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Close session", exact: true }).click();
    await command(page, "Confirm close");
    const draft = page.getByRole("textbox", { name: "Facilitator wrap-up (optional)", exact: true });
    await draft.fill("<b>Facilitator conclusions</b>");
    await page.getByRole("button", { name: "Generate summary", exact: true }).click();
    await page.getByRole("button", { name: "Cancel summary creation", exact: true }).click();
    await expect(draft).toHaveValue("<b>Facilitator conclusions</b>");
    await page.getByRole("button", { name: "Generate summary", exact: true }).click();
    const confirm = page.getByRole("button", { name: "Confirm generate summary", exact: true });
    await confirm.focus();
    const response = page.waitForResponse(response => response.request().method() === "POST" && response.url().includes("/sessions/"));
    await page.keyboard.press("Enter");
    await response;
    const committed = Date.now();
    await expect(report(colleague)).toBeVisible({ timeout: 5000 });
    const visibilityMs = Date.now() - committed;
    expect(visibilityMs).toBeLessThan(5000);
    await expect(report(page)).toBeVisible();
    await expect(report(colleague).getByText("<b>Facilitator conclusions</b>", { exact: true })).toBeVisible();
    await expect(report(colleague).getByText("<script>Submitted context</script>", { exact: true })).toBeVisible();
    await expect(report(colleague).locator("script, b")).toHaveCount(0);
    await expect(report(colleague).getByText("Voting: Not held", { exact: true })).toBeVisible();
    await expect(report(colleague).getByText("Outcome: Not discussed", { exact: true })).toBeVisible();
    await expect(report(colleague).getByText("Status at generation: In progress", { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Action title", exact: true })).toHaveValue("Keep closed action draft");
    await expect(page.getByRole("button", { name: "Capture action", exact: true })).toBeDisabled();
    const saved = await db.sessionSummary.findUniqueOrThrow({ where: { sessionId: session.id } });
    const later = await db.teamSession.create({ data: { teamId: data.alpha.id, title: "Later summary follow-up" } });
    await page.goto(`/sessions/${later.id}`);
    await page.getByRole("textbox", { name: "Progress note", exact: true }).fill("Completed after summary");
    await page.getByRole("combobox", { name: "Resulting status", exact: true }).selectOption("DONE");
    await page.getByRole("button", { name: "Record review", exact: true }).click();
    await expect(page.getByText("Completed after summary", { exact: true })).toBeVisible();
    await page.goto(`/sessions/${session.id}#meeting-summary`);
    await expect(report(page).getByText("Status at generation: In progress", { exact: true })).toBeVisible();
    expect(await db.sessionSummary.findUniqueOrThrow({ where: { sessionId: session.id } })).toEqual(saved);
    expect((await db.action.findUniqueOrThrow({ where: { id: action.id } })).status).toBe("DONE");
    await report(page).getByRole("link", { name: "View current action: Summary commitment", exact: true }).click();
    await expect(page.getByText("Completed after summary", { exact: true })).toBeVisible();
    const path = test.info().outputPath("meeting-summary-visibility.json");
    await writeFile(path, JSON.stringify({ visibilityMs, limitMs: 5000, identities: 2, bothVisible: true, productionAccess: false }));
    await test.info().attach("MS6-summary-visibility", { path, contentType: "application/json" });
  } finally { await second.close(); }
});

test("MS3/5/6: remote generation preserves a focused unused draft; stale confirmation conflicts without replacement", async ({ page, context }) => {
  const session = await prepared();
  await login(context, data.alice.id);
  await page.goto(`/sessions/${session.id}`);
  const draft = page.getByRole("textbox", { name: "Facilitator wrap-up (optional)", exact: true });
  await draft.fill("Unused conclusions");
  await page.getByRole("button", { name: "Generate summary", exact: true }).click();
  const stale = await (await page.request.get(`/api/sessions/${session.id}/snapshot`)).json();
  await page.route("**/api/sessions/*/snapshot", route => route.fulfill({ json: stale }));
  const other = await context.newPage();
  await other.goto(page.url());
  await other.getByRole("textbox", { name: "Facilitator wrap-up (optional)", exact: true }).fill("Winning conclusions");
  await other.getByRole("button", { name: "Generate summary", exact: true }).click();
  await command(other, "Confirm generate summary");
  await expect(report(other)).toBeVisible();
  await command(page, "Confirm generate summary");
  await expect(page.getByRole("alert").filter({ hasText: "already exists" })).toBeVisible();
  await expect(draft).toHaveValue("Unused conclusions");
  await draft.focus();
  await page.unroute("**/api/sessions/*/snapshot");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(report(page).getByText("Winning conclusions", { exact: true })).toBeVisible();
  await expect(page.getByText(/not included in the saved report/)).toBeVisible();
  await expect(draft).toBeFocused();
  await expect(draft).toHaveValue("Unused conclusions");
  expect(await db.sessionSummary.count({ where: { sessionId: session.id } })).toBe(1);
  await page.getByRole("button", { name: "Dismiss retained draft", exact: true }).click();
  await expect(draft).toHaveCount(0);
});

test("MS5/6: lost committed response is reconciled with one POST; hidden/offline/invalid reads retain notes and membership loss clears report/drafts", async ({ page, context }) => {
  const session = await prepared();
  await login(context, data.alice.id);
  await page.goto(`/sessions/${session.id}`);
  const draft = page.getByRole("textbox", { name: "Facilitator wrap-up (optional)", exact: true });
  await draft.fill("Retained ambiguous summary");
  await expect(page.getByRole("button", { name: "Generate summary", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByRole("button", { name: "Generate summary", exact: true })).toBeDisabled();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByRole("button", { name: "Generate summary", exact: true })).toBeEnabled();
  await context.setOffline(true);
  await expect(page.getByRole("button", { name: "Generate summary", exact: true })).toBeDisabled();
  await expect(draft).toHaveValue("Retained ambiguous summary");
  await context.setOffline(false);
  await expect(page.getByRole("button", { name: "Generate summary", exact: true })).toBeEnabled();
  const malformed = await (await page.request.get(`/api/sessions/${session.id}/snapshot`)).json();
  delete malformed.summary;
  await page.route("**/api/sessions/*/snapshot", route => route.fulfill({ json: malformed }));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: "Generate summary", exact: true })).toBeDisabled();
  await expect(draft).toHaveValue("Retained ambiguous summary");
  await page.unroute("**/api/sessions/*/snapshot");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: "Generate summary", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Generate summary", exact: true }).click();
  let posts = 0;
  await page.route("**/sessions/*", async route => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    posts++;
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Confirm generate summary", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Save could not be confirmed" })).toBeVisible();
  await expect(report(page)).toBeVisible();
  expect(posts).toBe(1);
  expect(await db.sessionSummary.count({ where: { sessionId: session.id } })).toBe(1);
  await page.unroute("**/sessions/*");
  await db.membership.delete({ where: { teamId_userId: { teamId: data.alpha.id, userId: data.alice.id } } });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("heading", { name: "Session access unavailable", exact: true })).toBeVisible();
  await expect(report(page)).toHaveCount(0);
  await expect(draft).toHaveCount(0);
});
