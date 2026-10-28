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
async function prepared() {
  const session = await db.teamSession.create({ data: {
    teamId: data.alpha.id, title: "Agenda browser session", kind: "FACILITATED",
    facilitatorId: data.alice.id, collectionState: "PAUSED", lifecycleVersion: 3,
    votingState: "FINALIZED", votingStartedAt: new Date(), votingFinalizedAt: new Date(),
    participants: { create: { userId: data.alice.id } }
  } });
  const topics = [];
  for (let i = 0; i < 4; i++) {
    const topic = await db.topic.create({ data: {
      teamId: data.alpha.id, sessionId: session.id, authorId: data.alice.id, title: `Order topic ${i}`
    } });
    await db.agendaEntry.create({ data: {
      teamId: data.alpha.id, sessionId: session.id, topicId: topic.id, position: i + 1, discussionPosition: i + 1, voteCount: 0
    } });
    topics.push(topic);
  }
  return { session, topics };
}
async function command(page: Page, name: string) {
  const response = page.waitForResponse(response => response.request().method() === "POST" && response.url().includes("/sessions/"));
  await page.getByRole("button", { name, exact: true }).click();
  await response;
  return Date.now();
}
const queue = (page: Page) => page.getByRole("list", { name: "Future discussion queue", exact: true }).getByRole("listitem");
async function park(page: Page, index: number, restore = false) {
  await page.getByRole("button", { name: `${restore ? "Restore" : "Park"} Order topic ${index}`, exact: true }).click();
  return command(page, restore ? "Confirm restore topic" : "Confirm park topic");
}
async function finish(page: Page) {
  await page.getByRole("button", { name: "Finish topic", exact: true }).click();
  return command(page, "Confirm finish topic");
}

test("MO2/3/6: distinct visible readers see manual parked order and next start; keyboard, review/action/reason drafts and focused controls stay stable", async ({ page, context, browser }) => {
  const { session, topics } = await prepared();
  const prior = await db.teamSession.create({ data: { teamId: data.alpha.id, title: "Earlier", createdAt: new Date("2025-01-01") } });
  await db.action.create({ data: { teamId: data.alpha.id, sourceSessionId: prior.id, ownerId: data.alice.id, title: "Prior order commitment" } });
  await login(context, data.alice.id);
  await page.goto(`/sessions/${session.id}`);
  const second = await browser.newContext();
  try {
    await login(second, data.bob.id);
    const colleague = await second.newPage();
    await colleague.goto(page.url());
    expect(await page.evaluate(() => document.visibilityState)).toBe("visible");
    expect(await colleague.evaluate(() => document.visibilityState)).toBe("visible");
    await expect(colleague.getByRole("button", { name: "Move Order topic 2 earlier", exact: true })).toHaveCount(0);
    await colleague.getByLabel("Action title", { exact: true }).fill("Keep reader action");
    await colleague.getByLabel("Progress note", { exact: true }).fill("Keep reader review");
    await colleague.getByRole("textbox", { name: "Progress note", exact: true }).focus();
    await page.getByRole("textbox", { name: "Parking reason for Order topic 1", exact: true }).fill("Keep reason");
    await page.getByRole("textbox", { name: "Action title", exact: true }).fill("Keep facilitator action");
    await park(page, 1);
    await expect(page.getByRole("button", { name: "Restore Order topic 1", exact: true })).toBeEnabled();
    await page.getByRole("textbox", { name: "Parking reason for Order topic 1", exact: true }).fill("Keep unsaved reason");
    await command(page, "Start next topic");
    await expect(page.getByRole("heading", { name: "Current: Order topic 0", exact: true })).toBeVisible();
    const clockBefore = await db.topicDiscussion.findFirstOrThrow({ where: { sessionId: session.id } });
    await expect(page.getByRole("button", { name: "Move Order topic 0 earlier", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Move Order topic 1 earlier", exact: true })).toBeDisabled();
    const button = page.getByRole("button", { name: "Move Order topic 2 earlier", exact: true });
    await expect(button).toBeEnabled();
    await button.focus();
    const response = page.waitForResponse(response => response.request().method() === "POST" && response.url().includes("/sessions/"));
    await page.keyboard.press("Enter");
    await response;
    const observations: Record<string, number> = {};
    let committed = Date.now();
    await expect(queue(colleague).first()).toContainText("Order topic 2", { timeout: 5000 });
    observations.move = Date.now() - committed;
    expect(observations.move).toBeLessThan(5000);
    await expect(button).toBeFocused();
    await expect(colleague.getByRole("textbox", { name: "Progress note", exact: true })).toBeFocused();
    await expect(queue(colleague).nth(1)).toContainText("Order topic 1 / Plan slot: 3 / Original vote rank: 2");
    await expect(queue(colleague).nth(1)).toContainText("Parked");
    expect(await db.topicDiscussion.findFirstOrThrow({ where: { sessionId: session.id } })).toEqual(clockBefore);
    committed = await park(page, 1, true);
    await expect(queue(colleague).nth(1)).not.toContainText("Parked", { timeout: 5000 });
    observations.restore = Date.now() - committed;
    expect(observations.restore).toBeLessThan(5000);
    expect(await db.topicDiscussion.findFirstOrThrow({ where: { sessionId: session.id } })).toEqual(clockBefore);
    committed = await finish(page);
    await expect(colleague.getByText("Next: Order topic 2", { exact: true })).toBeVisible({ timeout: 5000 });
    observations.next = Date.now() - committed;
    expect(observations.next).toBeLessThan(5000);
    await expect(page.getByRole("button", { name: "Move Order topic 0 later", exact: true })).toBeDisabled();
    await command(page, "Start next topic");
    await expect(colleague.getByRole("heading", { name: "Current: Order topic 2", exact: true })).toBeVisible();
    const started = await db.topicDiscussion.findFirstOrThrow({ where: { sessionId: session.id, topicId: topics[2].id } });
    expect(started.deadlineAt!.getTime() - started.startedAt.getTime()).toBe(300000);
    await expect(page.getByRole("textbox", { name: "Parking reason for Order topic 1", exact: true })).toHaveValue("Keep unsaved reason");
    await expect(page.getByRole("textbox", { name: "Action title", exact: true })).toHaveValue("Keep facilitator action");
    await expect(colleague.getByRole("textbox", { name: "Action title", exact: true })).toHaveValue("Keep reader action");
    await expect(colleague.getByRole("textbox", { name: "Progress note", exact: true })).toHaveValue("Keep reader review");
    await expect(colleague.getByRole("list", { name: "Final agenda", exact: true }).getByRole("listitem").nth(1)).toHaveText("Order topic 1 / Votes: 0");
    const path = test.info().outputPath("agenda-order-visibility.json");
    await writeFile(path, JSON.stringify({ observations, limitMs: 5000, identities: 2, bothVisible: true, productionAccess: false }));
    await test.info().attach("MO6-agenda-order-visibility", { path, contentType: "application/json" });
  } finally { await second.close(); }
});

test("MO4/6: reverse moves and closure retain attributed history and immutable vote results", async ({ page, context }) => {
  const { session } = await prepared();
  await login(context, data.alice.id);
  await page.goto(`/sessions/${session.id}`);
  await command(page, "Move Order topic 2 earlier");
  await expect(queue(page).nth(1)).toContainText("Order topic 2");
  await command(page, "Move Order topic 2 later");
  await expect(queue(page).nth(1)).toContainText("Order topic 1");
  await expect(page.getByRole("list", { name: "Agenda order history", exact: true }).getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button", { name: "Close session", exact: true }).click();
  await command(page, "Confirm close");
  await page.reload();
  await expect(page.getByRole("list", { name: "Agenda order history", exact: true })).toContainText("by Alice ");
  await expect(page.getByRole("list", { name: "Agenda order history", exact: true })).toContainText("Before: Order topic 0 -> Order topic 2 -> Order topic 1 -> Order topic 3");
  await expect(page.getByRole("button", { name: "Move Order topic 2 earlier", exact: true })).toBeDisabled();
  expect(await db.agendaOrderChange.count({ where: { sessionId: session.id } })).toBe(2);
  expect((await db.agendaEntry.findMany({ where: { sessionId: session.id }, orderBy: { position: "asc" } })).map(item => item.discussionPosition)).toEqual([1, 2, 3, 4]);
});

test("MO7: stale same-user neighbor and version conflict, never silently moving a new neighbor", async ({ page, context }) => {
  const { session } = await prepared();
  await login(context, data.alice.id);
  await page.goto(`/sessions/${session.id}`);
  await expect(page.getByRole("button", { name: "Move Order topic 2 earlier", exact: true })).toBeEnabled();
  const old = await (await page.request.get(`/api/sessions/${session.id}/snapshot`)).json();
  await page.route("**/api/sessions/*/snapshot", route => route.fulfill({ json: old }));
  const other = await context.newPage();
  await other.goto(page.url());
  await command(other, "Move Order topic 1 earlier");
  await expect(queue(other).first()).toContainText("Order topic 1");
  await command(page, "Move Order topic 2 earlier");
  await expect(page.getByRole("alert").filter({ hasText: "changed" })).toBeVisible();
  expect(await db.agendaOrderChange.count({ where: { sessionId: session.id } })).toBe(1);
  await page.unroute("**/api/sessions/*/snapshot");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(queue(page).first()).toContainText("Order topic 1");
  expect((await db.agendaEntry.findMany({ where: { sessionId: session.id }, orderBy: { discussionPosition: "asc" } })).map(item => item.position)).toEqual([2, 1, 3, 4]);
});

test("MO7: lost committed move has one POST; hidden/offline/malformed snapshots disable writes and access loss clears protected drafts", async ({ page, context }) => {
  const { session } = await prepared();
  await login(context, data.alice.id);
  await page.goto(`/sessions/${session.id}`);
  await page.getByRole("textbox", { name: "Action title", exact: true }).fill("Retain ambiguous move draft");
  let posts = 0;
  await page.route("**/sessions/*", async route => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    posts++;
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Move Order topic 2 earlier", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Save could not be confirmed" })).toBeVisible();
  await expect(queue(page).nth(1)).toContainText("Order topic 2");
  await expect(page.getByRole("button", { name: "Move Order topic 2 later", exact: true })).toBeEnabled();
  expect(posts).toBe(1);
  expect(await db.agendaOrderChange.count({ where: { sessionId: session.id } })).toBe(1);
  await page.unroute("**/sessions/*");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByRole("button", { name: "Move Order topic 2 earlier", exact: true })).toBeDisabled();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByRole("button", { name: "Move Order topic 2 earlier", exact: true })).toBeEnabled();
  await context.setOffline(true);
  await expect(page.getByRole("button", { name: "Move Order topic 2 earlier", exact: true })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "Action title", exact: true })).toHaveValue("Retain ambiguous move draft");
  await context.setOffline(false);
  await expect(page.getByRole("button", { name: "Move Order topic 2 earlier", exact: true })).toBeEnabled();
  const malformed = await (await page.request.get(`/api/sessions/${session.id}/snapshot`)).json();
  delete malformed.agendaOrder;
  await page.route("**/api/sessions/*/snapshot", route => route.fulfill({ json: malformed }));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: "Move Order topic 2 earlier", exact: true })).toBeDisabled();
  await expect(queue(page).nth(1)).toContainText("Order topic 2");
  await page.unroute("**/api/sessions/*/snapshot");
  await context.clearCookies();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("heading", { name: "Session access unavailable" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Discussion queue", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Action title", exact: true })).toHaveCount(0);
});
