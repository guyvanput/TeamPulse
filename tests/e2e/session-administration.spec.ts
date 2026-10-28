import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { fixture, cleanFixture, testDatabase } from "../support/database";

const db = testDatabase();
let data: Awaited<ReturnType<typeof fixture>>;
test.beforeEach(async () => {
  data = await fixture(db);
  data.alice = await db.user.update({ where: { id: data.alice.id }, data: { name: "Alice" } });
  data.bob = await db.user.update({ where: { id: data.bob.id }, data: { name: "Bob" } });
  await db.membership.create({ data: { teamId: data.alpha.id, userId: data.bob.id } });
});
test.afterEach(async () => { if (data) await cleanFixture(db, data); });
test.afterAll(async () => { await db.$disconnect(); });
async function login(context: BrowserContext, userId: string) {
  const sessionToken = randomBytes(32).toString("hex");
  await db.session.create({ data: { userId, sessionToken, expires: new Date(Date.now() + 3600000) } });
  await context.addCookies([{ name: "authjs.session-token", value: sessionToken, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }]);
}
async function prepared(finalized = false) {
  const session = await db.teamSession.create({ data: {
    teamId: data.alpha.id, title: "Administration browser meeting", kind: "FACILITATED", facilitatorId: data.alice.id,
    collectionState: "PAUSED", lifecycleVersion: 2, votingState: finalized ? "FINALIZED" : "OPEN",
    votingStartedAt: new Date(), votingFinalizedAt: finalized ? new Date() : null,
    participants: { create: [{ userId: data.alice.id, ballotVersion: 1 }, { userId: data.bob.id }] }
  } });
  const topics = [];
  for (let index = 0; index < 3; index++) topics.push(await db.topic.create({ data: {
    teamId: data.alpha.id, sessionId: session.id, authorId: data.alice.id, title: `Administration topic ${index}`,
    createdAt: new Date(`2026-01-01T00:00:0${index}.000Z`)
  } }));
  await db.topicVote.create({ data: { teamId: data.alpha.id, sessionId: session.id, userId: data.alice.id, topicId: topics[0].id } });
  if (finalized) await db.agendaEntry.createMany({ data: topics.map((topic, index) => ({
    teamId: data.alpha.id, sessionId: session.id, topicId: topic.id, position: index + 1, discussionPosition: index + 1, voteCount: index === 0 ? 1 : 0
  })) });
  return { session, topics };
}
async function command(page: Page, name: string) {
  const response = page.waitForResponse(response => response.request().method() === "POST" && response.url().includes("/sessions/"));
  await page.getByRole("button", { name, exact: true }).click();
  await response;
  return Date.now();
}
const admin = (page: Page) => page.getByRole("region", { name: "Session administration", exact: true });

test("RM2/3/4/6: distinct visible users reconcile transfer/removal/readmission below five seconds with original ballot, focus and drafts", async ({ page, context, browser }) => {
  const { session } = await prepared();
  const original = await db.sessionParticipant.findUniqueOrThrow({ where: { sessionId_userId: { sessionId: session.id, userId: data.alice.id } } });
  await login(context, data.alice.id);
  await page.goto(`/sessions/${session.id}`);
  const second = await browser.newContext();
  try {
    await login(second, data.bob.id);
    const colleague = await second.newPage();
    await colleague.goto(page.url());
    expect(await page.evaluate(() => document.visibilityState)).toBe("visible");
    expect(await colleague.evaluate(() => document.visibilityState)).toBe("visible");
    await colleague.getByRole("textbox", { name: "Action title", exact: true }).fill("Bob retained draft");
    await expect(admin(colleague).getByRole("button")).toHaveCount(0);
    await admin(page).getByRole("button", { name: "Transfer facilitation to Bob", exact: true }).click();
    const transferred = await command(page, "Confirm transfer to Bob");
    await expect(admin(colleague).getByRole("button", { name: "Remove Alice", exact: true })).toBeEnabled({ timeout: 5000 });
    const transferMs = Date.now() - transferred;
    expect(transferMs).toBeLessThan(5000);
    await expect(colleague.getByRole("textbox", { name: "Action title", exact: true })).toHaveValue("Bob retained draft");
    const draft = page.getByRole("textbox", { name: "Action title", exact: true });
    await draft.fill("Alice unsaved commitment");
    await draft.focus();
    await admin(colleague).getByRole("textbox", { name: "Removal reason for Alice", exact: true }).fill("<b>Temporary removal</b>");
    await admin(colleague).getByRole("button", { name: "Remove Alice", exact: true }).click();
    const removed = await command(colleague, "Confirm remove Alice");
    await expect(admin(page).getByText(/ask the current facilitator to readmit you/)).toBeVisible({ timeout: 5000 });
    const removeMs = Date.now() - removed;
    expect(removeMs).toBeLessThan(5000);
    await expect(draft).toBeFocused();
    await expect(draft).toHaveValue("Alice unsaved commitment");
    await expect(page.getByRole("button", { name: "Capture action", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Join session", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Vote for Administration topic 0", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Vote for Administration topic 0", exact: true })).toBeDisabled();
    await expect(page.getByText("Votes remaining: 2 of 3 / Read-only until readmission", { exact: true })).toBeVisible();
    await expect(admin(page).getByText(/<b>Temporary removal<\/b>/)).toBeVisible();
    await expect(admin(page).locator("b")).toHaveCount(0);
    await admin(colleague).getByRole("button", { name: "Readmit Alice", exact: true }).click();
    const readmitted = await command(colleague, "Confirm readmit Alice");
    await expect(page.getByRole("button", { name: "Capture action", exact: true })).toBeEnabled({ timeout: 5000 });
    const readmitMs = Date.now() - readmitted;
    expect(readmitMs).toBeLessThan(5000);
    await expect(draft).toBeFocused();
    await expect(draft).toHaveValue("Alice unsaved commitment");
    expect(await db.sessionParticipant.findUniqueOrThrow({ where: { sessionId_userId: { sessionId: session.id, userId: data.alice.id } } })).toEqual(original);
    await command(page, "Vote for Administration topic 1");
    await expect(page.getByText("Votes remaining: 1 of 3", { exact: true })).toBeVisible();
    expect(await db.sessionAdministrationEvent.count({ where: { sessionId: session.id } })).toBe(3);
    const path = test.info().outputPath("session-administration-visibility.json");
    await writeFile(path, JSON.stringify({ transferMs, removeMs, readmitMs, limitMs: 5000, identities: 2, bothVisible: true, productionAccess: false }));
    await test.info().attach("RM6-administration-visibility", { path, contentType: "application/json" });
  } finally { await second.close(); }
});

test("RM2/5/6: remote handover preserves running clock and focused parking draft; stale confirmations cannot adopt a new revision", async ({ page, context, browser }) => {
  const { session, topics } = await prepared(true);
  await db.topicDiscussion.create({ data: { teamId: data.alpha.id, sessionId: session.id, topicId: topics[0].id,
    state: "RUNNING", startedAt: new Date(), startedById: data.alice.id, allocatedMs: 300000, deadlineAt: new Date(Date.now() + 300000) } });
  const clock = await db.topicDiscussion.findFirstOrThrow({ where: { sessionId: session.id } });
  await login(context, data.alice.id);
  await page.goto(`/sessions/${session.id}`);
  const reason = page.getByRole("textbox", { name: "Parking reason for Administration topic 1", exact: true });
  await reason.fill("Keep focused parking reason");
  await reason.focus();
  const other = await context.newPage();
  await other.goto(page.url());
  const second = await browser.newContext();
  try {
    await login(second, data.bob.id);
    const colleague = await second.newPage();
    await colleague.goto(page.url());
    await admin(other).getByRole("button", { name: "Transfer facilitation to Bob", exact: true }).click();
    await command(other, "Confirm transfer to Bob");
    await expect(reason).toHaveAttribute("readonly", "");
    await expect(reason).toBeFocused();
    await expect(reason).toHaveValue("Keep focused parking reason");
    await expect(page.getByRole("button", { name: "Pause timer", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Park Administration topic 1", exact: true })).toBeDisabled();
    expect(await db.topicDiscussion.findFirstOrThrow({ where: { sessionId: session.id } })).toEqual(clock);
    await expect(admin(colleague).getByRole("button", { name: "Transfer facilitation to Alice", exact: true })).toBeEnabled();
    await admin(colleague).getByRole("button", { name: "Transfer facilitation to Alice", exact: true }).click();
    const confirm = admin(colleague).getByRole("button", { name: "Confirm transfer to Alice", exact: true });
    await confirm.focus();
    const bobOther = await second.newPage();
    await bobOther.goto(colleague.url());
    await command(bobOther, "Extend by two minutes");
    await expect(confirm).toBeDisabled();
    await expect(confirm).toBeFocused();
    await expect(admin(colleague).getByText(/Session or permissions changed/)).toBeVisible();
    expect(await db.sessionAdministrationEvent.count({ where: { sessionId: session.id } })).toBe(1);
    expect((await db.topicDiscussion.findFirstOrThrow({ where: { sessionId: session.id } })).allocatedMs).toBe(420000);
  } finally { await second.close(); }
});

test("RM5/6: hidden/offline/malformed reads disable administration; one lost committed response reconciles without replay and access loss clears drafts", async ({ page, context }) => {
  const { session } = await prepared();
  await login(context, data.alice.id);
  await page.goto(`/sessions/${session.id}`);
  const remove = admin(page).getByRole("button", { name: "Remove Bob", exact: true });
  const reason = admin(page).getByRole("textbox", { name: "Removal reason for Bob", exact: true });
  await reason.fill("Retained administrative draft");
  await expect(remove).toBeEnabled();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(remove).toBeDisabled();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(remove).toBeEnabled();
  await context.setOffline(true);
  await expect(remove).toBeDisabled();
  await context.setOffline(false);
  await expect(remove).toBeEnabled();
  const malformed = await (await page.request.get(`/api/sessions/${session.id}/snapshot`)).json();
  delete malformed.administration;
  await page.route("**/api/sessions/*/snapshot", route => route.fulfill({ json: malformed }));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(remove).toBeDisabled();
  await expect(reason).toHaveValue("Retained administrative draft");
  await page.unroute("**/api/sessions/*/snapshot");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(remove).toBeEnabled();
  await remove.click();
  let posts = 0;
  await page.route("**/sessions/*", async route => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    posts++;
    await route.fetch();
    await route.abort("failed");
  });
  await admin(page).getByRole("button", { name: "Confirm remove Bob", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Save could not be confirmed" })).toBeVisible();
  await expect(admin(page).getByRole("button", { name: "Readmit Bob", exact: true })).toBeEnabled();
  expect(posts).toBe(1);
  expect(await db.sessionAdministrationEvent.count({ where: { sessionId: session.id } })).toBe(1);
  await expect(reason).toHaveValue("Retained administrative draft");
  await expect(admin(page).getByRole("button", { name: "Confirm remove Bob", exact: true })).toBeDisabled();
  await page.unroute("**/sessions/*");
  await db.membership.delete({ where: { teamId_userId: { teamId: data.alpha.id, userId: data.alice.id } } });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("heading", { name: "Session access unavailable", exact: true })).toBeVisible();
  await expect(admin(page)).toHaveCount(0);
  await expect(reason).toHaveCount(0);
});
