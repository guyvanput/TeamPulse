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
    teamId: data.alpha.id, title: "Discussion browser session", kind: "FACILITATED",
    facilitatorId: data.alice.id, collectionState: "PAUSED", lifecycleVersion: 3,
    votingState: "FINALIZED", votingStartedAt: new Date(), votingFinalizedAt: new Date(),
    participants: { create: { userId: data.alice.id } }
  } });
  const topics = [];
  for (let i = 0; i < 3; i++) {
    const topic = await db.topic.create({ data: { teamId: data.alpha.id, sessionId: session.id, authorId: data.alice.id, title: `Timed topic ${i}` } });
    await db.agendaEntry.create({ data: { teamId: data.alpha.id, sessionId: session.id, topicId: topic.id, position: i + 1, discussionPosition: i + 1, voteCount: 0 } });
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
async function finish(page: Page) {
  await page.getByRole("button", { name: "Finish topic", exact: true }).click();
  return command(page, "Confirm finish topic");
}

test("TD1/2/3/5/6: two identities see start, pause, extend, resume and finish without losing drafts or focus", async ({ page, context, browser }) => {
  const { session, topics } = await prepared();
  const prior = await db.teamSession.create({ data: { teamId: data.alpha.id, title: "Earlier", createdAt: new Date("2025-01-01") } });
  await db.action.create({ data: { teamId: data.alpha.id, sourceSessionId: prior.id, ownerId: data.alice.id, title: "Prior commitment" } });
  await login(context, data.alice.id);
  await page.goto(`/sessions/${session.id}`);
  const second = await browser.newContext();
  try {
    await login(second, data.bob.id);
    const colleague = await second.newPage();
    await colleague.goto(page.url());
    expect(await page.evaluate(() => document.visibilityState)).toBe("visible");
    expect(await colleague.evaluate(() => document.visibilityState)).toBe("visible");
    await expect(colleague.getByRole("button", { name: "Start next topic" })).toHaveCount(0);
    await colleague.getByLabel("Action title", { exact: true }).fill("Retain action");
    await colleague.getByLabel("Progress note", { exact: true }).fill("Retain review");
    await colleague.getByRole("textbox", { name: "Progress note", exact: true }).focus();
    const observations: Record<string, number> = {};
    for (const [name, observed] of [
      ["Start next topic", "Discussion: Running"],
      ["Pause timer", "Discussion: Paused"],
      ["Extend by two minutes", "Discussion: Paused"],
      ["Resume timer", "Discussion: Running"]
    ]) {
      const before = name === "Extend by two minutes" ? (await db.topicDiscussion.findUniqueOrThrow({
        where: { sessionId_topicId_attemptNumber: { sessionId: session.id, topicId: topics[0].id, attemptNumber: 1 } }
      })).remainingMs : null;
      const committed = await command(page, name);
      if (before !== null) {
        const seconds = Math.ceil((before + 120000) / 1000);
        await expect(colleague.getByRole("timer")).toHaveText(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`, { timeout: 5000 });
        expect((await db.topicDiscussion.findUniqueOrThrow({ where: { sessionId_topicId_attemptNumber: { sessionId: session.id, topicId: topics[0].id, attemptNumber: 1 } } })).remainingMs).toBe(before + 120000);
      } else await expect(colleague.getByText(observed, { exact: true })).toBeVisible({ timeout: 5000 });
      observations[name] = Date.now() - committed;
      expect(observations[name]).toBeLessThan(5000);
      await expect(colleague.getByRole("textbox", { name: "Progress note", exact: true })).toBeFocused();
    }
    await expect(page.getByRole("button", { name: "Close session", exact: true })).toBeDisabled();
    await colleague.getByRole("button", { name: "Join session" }).click();
    await expect(colleague.getByRole("button", { name: "Capture action" })).toBeEnabled();
    await expect(colleague.getByRole("button", { name: "Pause timer" })).toHaveCount(0);
    await expect(colleague.getByRole("textbox", { name: "Action title", exact: true })).toHaveValue("Retain action");
    await expect(colleague.getByRole("textbox", { name: "Progress note", exact: true })).toHaveValue("Retain review");
    await page.getByRole("button", { name: "Finish topic", exact: true }).click();
    await page.getByRole("button", { name: "Cancel finish topic" }).click();
    await expect(page.getByText("Discussion: Running", { exact: true })).toBeVisible();
    const committed = await finish(page);
    await expect(colleague.getByRole("list", { name: "Discussion progress" }).getByRole("listitem").first()).toContainText("Discussed", { timeout: 5000 });
    observations.finish = Date.now() - committed;
    expect(observations.finish).toBeLessThan(5000);
    expect(await db.topicDiscussion.count({ where: { sessionId: session.id } })).toBe(1);
    await expect(page.getByText("Next: Timed topic 1", { exact: true })).toBeVisible();
    const output = test.info().outputPath("discussion-visibility.json");
    await writeFile(output, JSON.stringify({ observations, limitMs: 5000, identities: 2, bothVisible: true, productionAccess: false }));
    await test.info().attach("TD6-discussion-visibility", { path: output, contentType: "application/json" });
    await page.getByRole("button", { name: "Close session", exact: true }).click();
    await page.getByRole("button", { name: "Confirm close" }).click();
    await expect(colleague.getByText("This session is read-only.", { exact: false })).toBeVisible({ timeout: 5000 });
    expect(await db.topicDiscussion.count({ where: { sessionId: session.id } })).toBe(1);
    await expect(colleague.getByRole("list", { name: "Discussion progress" }).getByRole("listitem").nth(1)).toContainText("Not discussed");
  } finally { await second.close(); }
});

test("TD2/3/5/6: expiry stays at zero, extension restarts only time and every topic needs an explicit start", async ({ page, context }) => {
  const { session, topics } = await prepared();
  await login(context, data.alice.id);
  await page.clock.setFixedTime(new Date("2099-01-01"));
  await page.goto(`/sessions/${session.id}`);
  await command(page, "Start next topic");
  const key = { sessionId_topicId_attemptNumber: { sessionId: session.id, topicId: topics[0].id, attemptNumber: 1 } };
  await db.topicDiscussion.update({ where: key, data: { deadlineAt: new Date(Date.now() - 60000) } });
  await expect(page.getByText("Discussion: Time expired", { exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("timer")).toHaveText("0:00");
  await expect(page.getByRole("button", { name: "Pause timer" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Close session", exact: true })).toBeDisabled();
  expect((await db.topicDiscussion.findUniqueOrThrow({ where: key })).state).toBe("RUNNING");
  await command(page, "Extend by two minutes");
  const extended = await db.topicDiscussion.findUniqueOrThrow({ where: key });
  expect(extended.deadlineAt!.getTime()).toBeGreaterThan(Date.now() + 110000);
  expect(extended.deadlineAt!.getTime()).toBeLessThan(Date.now() + 121000);
  expect(extended.allocatedMs).toBe(420000);
  for (let index = 0; index < topics.length; index++) {
    if (index) {
      expect(await db.topicDiscussion.count({ where: { sessionId: session.id } })).toBe(index);
      await page.getByRole("button", { name: "Start next topic" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: `Current: Timed topic ${index}` })).toBeVisible();
    }
    await finish(page);
    await expect(page.getByRole("heading", { name: `Current: Timed topic ${index}` })).toHaveCount(0);
  }
  await expect(page.getByText("All agenda topics discussed.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start next topic" })).toHaveCount(0);
  expect((await db.teamSession.findUniqueOrThrow({ where: { id: session.id } })).collectionState).toBe("PAUSED");
});

test("TD4/7: a stale same-user tab cannot start another topic or advance a newer discussion", async ({ page, context }) => {
  const { session } = await prepared();
  await login(context, data.alice.id);
  await page.goto(`/sessions/${session.id}`);
  const old = await (await page.request.get(`/api/sessions/${session.id}/snapshot`)).json();
  await page.route("**/api/sessions/*/snapshot", route => route.fulfill({ json: old }));
  const other = await context.newPage();
  await other.goto(page.url());
  await command(other, "Start next topic");
  await command(page, "Start next topic");
  await expect(page.getByRole("alert").filter({ hasText: "changed" })).toBeVisible();
  expect(await db.topicDiscussion.count({ where: { sessionId: session.id } })).toBe(1);
  await page.unroute("**/api/sessions/*/snapshot");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("Discussion: Running", { exact: true })).toBeVisible();
});

test("TD4/7: a lost committed extension response is reconciled with exactly one POST", async ({ page, context }) => {
  const { session, topics } = await prepared();
  await login(context, data.alice.id);
  await page.goto(`/sessions/${session.id}`);
  await command(page, "Start next topic");
  const key = { sessionId_topicId_attemptNumber: { sessionId: session.id, topicId: topics[0].id, attemptNumber: 1 } };
  const before = await db.topicDiscussion.findUniqueOrThrow({ where: key });
  let posts = 0;
  await page.route("**/sessions/*", async route => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    posts++;
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Extend by two minutes" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Save could not be confirmed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Extend by two minutes" })).toBeEnabled();
  const after = await db.topicDiscussion.findUniqueOrThrow({ where: key });
  expect(after.deadlineAt!.getTime()).toBe(before.deadlineAt!.getTime() + 120000);
  expect(after.allocatedMs).toBe(420000);
  expect(posts).toBe(1);
});

test("TD6/7: initial synchronization, offline timing and expired auth retain no false current controls", async ({ page, context }) => {
  const { session } = await prepared();
  await login(context, data.alice.id);
  await page.route("**/api/sessions/*/snapshot", route => route.fulfill({ json: { invalid: true } }));
  await page.goto(`/sessions/${session.id}`);
  await expect(page.getByRole("button", { name: "Start next topic" })).toBeDisabled();
  await expect(page.getByText("Updates unavailable.", { exact: false })).toBeVisible();
  await page.unroute("**/api/sessions/*/snapshot");
  await page.getByRole("button", { name: "Retry updates" }).click();
  await command(page, "Start next topic");
  await expect(page.getByRole("timer")).toBeVisible();
  await expect(page.getByRole("button", { name: "Extend by two minutes" })).toBeEnabled();
  await page.getByLabel("Action title", { exact: true }).fill("Private retained draft");
  await context.setOffline(true);
  await expect(page.getByText("Timer stale.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Extend by two minutes" })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "Action title", exact: true })).toHaveValue("Private retained draft");
  await context.setOffline(false);
  await expect(page.getByRole("button", { name: "Extend by two minutes" })).toBeEnabled({ timeout: 5000 });
  await context.clearCookies();
  await expect(page.getByRole("heading", { name: "Session access unavailable" })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("region", { name: "Timed discussion" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Action title", exact: true })).toHaveCount(0);
});

test("TD4/5: a close confirmation cannot adopt newer discussion revisions silently", async ({ page, context }) => {
  const { session } = await prepared();
  await login(context, data.alice.id);
  await page.goto(`/sessions/${session.id}`);
  await page.getByRole("button", { name: "Close session", exact: true }).click();
  const other = await context.newPage();
  await other.goto(page.url());
  await command(other, "Start next topic");
  await finish(other);
  await expect(page.getByText("Session changed. Cancel and review its current state before closing.", { exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("button", { name: "Confirm close" })).toBeDisabled();
  await page.getByRole("button", { name: "Cancel close" }).click();
  await page.getByRole("button", { name: "Close session", exact: true }).click();
  await page.getByRole("button", { name: "Confirm close" }).click();
  await expect(page.getByText("This session is read-only.", { exact: false })).toBeVisible();
});
