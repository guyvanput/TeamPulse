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
    teamId: data.alpha.id, title: "Parking browser session", kind: "FACILITATED",
    facilitatorId: data.alice.id, collectionState: "PAUSED", lifecycleVersion: 3,
    votingState: "FINALIZED", votingStartedAt: new Date(), votingFinalizedAt: new Date(),
    participants: { create: { userId: data.alice.id } }
  } });
  const topics = [];
  for (let i = 0; i < 3; i++) {
    const topic = await db.topic.create({ data: { teamId: data.alpha.id, sessionId: session.id, authorId: data.alice.id, title: `Parking topic ${i}`, description: "Keep context" } });
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
async function move(page: Page, index: number, restore = false) {
  await page.getByRole("button", { name: `${restore ? "Restore" : "Park"} Parking topic ${index}`, exact: true }).click();
  return command(page, restore ? "Confirm restore topic" : "Confirm park topic");
}

test("PL2/3/4/7: two identities see deferral/restoration and fresh attempts while drafts and focus stay stable", async ({ page, context, browser }) => {
  const { session, topics } = await prepared();
  await login(context, data.alice.id);
  await page.goto(`/sessions/${session.id}`);
  const second = await browser.newContext();
  try {
    await login(second, data.bob.id);
    const colleague = await second.newPage();
    await colleague.goto(page.url());
    expect(await page.evaluate(() => document.visibilityState)).toBe("visible");
    expect(await colleague.evaluate(() => document.visibilityState)).toBe("visible");
    await colleague.getByLabel("Action title", { exact: true }).fill("Keep colleague draft");
    await colleague.getByRole("textbox", { name: "Action title", exact: true }).focus();
    await expect(colleague.getByRole("button", { name: "Park Parking topic 0", exact: true })).toHaveCount(0);
    await command(page, "Start next topic");
    await expect(colleague.getByRole("timer")).toBeVisible();
    await command(page, "Pause timer");
    await page.getByRole("textbox", { name: "Parking reason for Parking topic 0", exact: true }).fill("Need specialist");
    await page.getByRole("button", { name: "Park Parking topic 0", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Cancel parking change" }).click();
    await expect(page.getByRole("textbox", { name: "Parking reason for Parking topic 0", exact: true })).toHaveValue("Need specialist");
    const observations: Record<string, number> = {};
    let committed = await move(page, 0);
    await expect(colleague.getByRole("list", { name: "Parked topics", exact: true })).toContainText("Need specialist", { timeout: 5000 });
    await expect(colleague.getByRole("heading", { name: "Current: Parking topic 0" })).toHaveCount(0);
    await expect(colleague.getByText("Next: Parking topic 1", { exact: true })).toBeVisible();
    observations.parkCurrent = Date.now() - committed;
    expect(observations.parkCurrent).toBeLessThan(5000);
    await expect(colleague.getByRole("textbox", { name: "Action title", exact: true })).toBeFocused();
    await command(page, "Start next topic");
    const otherBefore = await db.topicDiscussion.findFirstOrThrow({ where: { sessionId: session.id, topicId: topics[1].id } });
    committed = await move(page, 0, true);
    await expect(colleague.getByRole("list", { name: "Parked topics", exact: true })).toHaveCount(0, { timeout: 5000 });
    await expect(colleague.getByRole("heading", { name: "Current: Parking topic 1" })).toBeVisible();
    observations.restore = Date.now() - committed;
    expect(observations.restore).toBeLessThan(5000);
    expect(await db.topicDiscussion.findFirstOrThrow({ where: { sessionId: session.id, topicId: topics[1].id } })).toEqual(otherBefore);
    await page.getByRole("button", { name: "Finish topic", exact: true }).click();
    await command(page, "Confirm finish topic");
    await expect(page.getByText("Next: Parking topic 0", { exact: true })).toBeVisible();
    committed = await command(page, "Start next topic");
    await expect(colleague.getByRole("heading", { name: "Current: Parking topic 0" })).toBeVisible({ timeout: 5000 });
    observations.restarted = Date.now() - committed;
    expect(observations.restarted).toBeLessThan(5000);
    const attempts = await db.topicDiscussion.findMany({ where: { sessionId: session.id, topicId: topics[0].id }, orderBy: { attemptNumber: "asc" } });
    expect(attempts.map(item => item.outcome)).toEqual(["DEFERRED", null]);
    expect(attempts[1].deadlineAt!.getTime() - attempts[1].startedAt.getTime()).toBe(300000);
    await expect(colleague.getByRole("textbox", { name: "Action title", exact: true })).toHaveValue("Keep colleague draft");
    const path = test.info().outputPath("parking-visibility.json");
    await writeFile(path, JSON.stringify({ observations, limitMs: 5000, identities: 2, bothVisible: true, productionAccess: false }));
    await test.info().attach("PL7-parking-visibility", { path, contentType: "application/json" });
  } finally { await second.close(); }
});

test("PL5/7: all parked is not all Discussed; closed history retains reasons without restore controls", async ({ page, context }) => {
  const { session } = await prepared();
  await login(context, data.alice.id);
  await page.goto(`/sessions/${session.id}`);
  await page.getByRole("textbox", { name: "Parking reason for Parking topic 0", exact: true }).fill("<script>not executable</script>");
  for (let i = 0; i < 3; i++) await move(page, i);
  await expect(page.getByText("No eligible topic to start.", { exact: false })).toBeVisible();
  await expect(page.getByText("All agenda topics discussed.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start next topic" })).toHaveCount(0);
  await page.getByRole("button", { name: "Close session", exact: true }).click();
  await command(page, "Confirm close");
  await page.reload();
  await expect(page.getByRole("list", { name: "Parked topics", exact: true })).toContainText("<script>not executable</script>");
  await expect(page.getByRole("button", { name: "Restore Parking topic 0", exact: true })).toBeDisabled();
  expect(await db.topicDiscussion.count({ where: { sessionId: session.id } })).toBe(0);
});

test("PL6/8: an old park confirmation cannot affect a newer attempt of the same topic", async ({ page, context }) => {
  const { session, topics } = await prepared();
  await login(context, data.alice.id);
  await page.goto(`/sessions/${session.id}`);
  await command(page, "Start next topic");
  await expect(page.getByRole("timer")).toBeVisible();
  const old = await (await page.request.get(`/api/sessions/${session.id}/snapshot`)).json();
  await page.route("**/api/sessions/*/snapshot", route => route.fulfill({ json: old }));
  await page.getByRole("textbox", { name: "Parking reason for Parking topic 0", exact: true }).fill("Old reason draft");
  await page.getByRole("button", { name: "Park Parking topic 0", exact: true }).click();
  const other = await context.newPage();
  await other.goto(page.url());
  await move(other, 0);
  await move(other, 0, true);
  await command(other, "Start next topic");
  await command(page, "Confirm park topic");
  await expect(page.getByRole("alert").filter({ hasText: "changed" })).toBeVisible();
  expect(await db.topicParkingEvent.count({ where: { sessionId: session.id } })).toBe(2);
  expect(await db.topicDiscussion.findFirstOrThrow({ where: { sessionId: session.id, topicId: topics[0].id, attemptNumber: 2 } })).toMatchObject({ state: "RUNNING", outcome: null });
  await page.unroute("**/api/sessions/*/snapshot");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: "Confirm park topic" })).toBeDisabled();
  await page.getByRole("button", { name: "Cancel parking change" }).click();
  await expect(page.getByRole("textbox", { name: "Parking reason for Parking topic 0", exact: true })).toHaveValue("Old reason draft");
});

test("PL8: lost park/restore responses never replay; offline and access loss preserve then clear protected drafts", async ({ page, context }) => {
  const { session } = await prepared();
  await login(context, data.alice.id);
  await page.goto(`/sessions/${session.id}`);
  await expect(page.getByRole("button", { name: "Park Parking topic 0", exact: true })).toBeEnabled();
  for (const restore of [false, true]) {
    await page.getByRole("textbox", { name: "Parking reason for Parking topic 0", exact: true }).fill("Retain ambiguous draft");
    let posts = 0;
    await page.route("**/sessions/*", async route => {
      if (route.request().method() !== "POST") { await route.continue(); return; }
      posts++;
      await route.fetch();
      await route.abort("failed");
    });
    await page.getByRole("button", { name: `${restore ? "Restore" : "Park"} Parking topic 0`, exact: true }).click();
    await page.getByRole("button", { name: restore ? "Confirm restore topic" : "Confirm park topic" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Save could not be confirmed" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Parking reason for Parking topic 0", exact: true })).toHaveValue("Retain ambiguous draft");
    expect(posts).toBe(1);
    await page.unroute("**/sessions/*");
    await page.getByRole("button", { name: "Cancel parking change" }).click();
  }
  expect(await db.topicParkingEvent.count({ where: { sessionId: session.id } })).toBe(2);
  await context.setOffline(true);
  await expect(page.getByRole("button", { name: "Park Parking topic 0", exact: true })).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByRole("button", { name: "Park Parking topic 0", exact: true })).toBeEnabled({ timeout: 5000 });
  await context.clearCookies();
  await expect(page.getByRole("heading", { name: "Session access unavailable" })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("region", { name: "Parking lot", exact: true })).toHaveCount(0);
});
