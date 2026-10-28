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
  await db.session.create({ data: { userId, sessionToken, expires: new Date(Date.now() + 3_600_000) } });
  await context.addCookies([{ name: "authjs.session-token", value: sessionToken, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }]);
}
async function prepared(open = true) {
  const session = await db.teamSession.create({ data: {
    teamId: data.alpha.id, title: "Voting browser session", kind: "FACILITATED",
    facilitatorId: data.alice.id, collectionState: open ? "PAUSED" : "COLLECTING",
    votingState: open ? "OPEN" : "NOT_STARTED", votingStartedAt: open ? new Date() : null,
    lifecycleVersion: open ? 2 : 0, participants: { create: { userId: data.alice.id } }
  } });
  const topics = [];
  for (let i = 0; i < 4; i++) topics.push(await db.topic.create({ data: {
    teamId: data.alpha.id, sessionId: session.id, authorId: data.alice.id, title: `Voting topic ${i}`
  } }));
  return { session, topics };
}
function button(page: Page, index: number) {
  return page.getByRole("button", { name: `Vote for Voting topic ${index}`, exact: true });
}
async function command(page: Page, name: string) {
  const response = page.waitForResponse(response => response.request().method() === "POST" && response.url().includes("/sessions/"));
  await page.getByRole("button", { name, exact: true }).click();
  await response;
  return Date.now();
}

test("VP1/2/5/8/11: two identities join, confirm one round, vote and retain drafts/focus through finalization", async ({ page, context, browser }) => {
  const { session } = await prepared(false);
  const prior = await db.teamSession.create({ data: { teamId: data.alpha.id, title: "Earlier action", createdAt: new Date("2025-01-01") } });
  await db.action.create({ data: { teamId: data.alpha.id, sourceSessionId: prior.id, ownerId: data.alice.id, title: "Prior commitment" } });
  await login(context, data.alice.id);
  await page.goto(`/sessions/${session.id}`);
  await page.getByRole("button", { name: "Edit topic", exact: true }).first().click();
  await page.getByLabel("Edit topic title").fill("Retain edit");
  await page.getByLabel("Action title", { exact: true }).fill("Retain action");
  await page.getByLabel("Progress note", { exact: true }).fill("Retain review");
  await page.getByLabel("Topic title", { exact: true }).fill("Retain new topic");
  await expect(page.getByRole("button", { name: "Start voting", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Pause collection", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start voting", exact: true })).toBeEnabled();
  const second = await browser.newContext();
  try {
    await login(second, data.bob.id);
    const colleague = await second.newPage();
    await colleague.goto(page.url());
    expect(await page.evaluate(() => document.visibilityState)).toBe("visible");
    expect(await colleague.evaluate(() => document.visibilityState)).toBe("visible");
    await expect(button(colleague, 0)).toBeDisabled();
    await expect(colleague.getByRole("button", { name: "Start voting", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Start voting", exact: true }).click();
    await expect(page.getByText("Topics will be permanently frozen.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Cancel voting change" }).click();
    expect((await db.teamSession.findUniqueOrThrow({ where: { id: session.id } })).votingState).toBe("NOT_STARTED");
    await page.getByRole("button", { name: "Start voting", exact: true }).click();
    const started = await command(page, "Confirm start voting");
    await expect(colleague.getByText("Voting: Open", { exact: true })).toBeVisible({ timeout: 5000 });
    const startMs = Date.now() - started;
    expect(startMs).toBeLessThan(5000);
    await expect(page.getByLabel("Edit topic title")).toHaveValue("Retain edit");
    await expect(page.getByRole("button", { name: "Save topic", exact: true })).toBeDisabled();
    await expect(page.getByText("Draft retained; topics are locked", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Resume collection" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Close session", exact: true })).toBeDisabled();
    await colleague.getByRole("button", { name: "Join session" }).click();
    await expect(button(colleague, 3)).toBeEnabled();
    await page.getByRole("textbox", { name: "Progress note", exact: true }).focus();
    const voted = await command(colleague, "Vote for Voting topic 3");
    await expect(page.getByRole("list", { name: "Provisional agenda" }).getByRole("listitem").first()).toHaveText("Voting topic 3 / Votes: 1", { timeout: 5000 });
    const voteMs = Date.now() - voted;
    expect(voteMs).toBeLessThan(5000);
    await expect(page.getByRole("textbox", { name: "Progress note", exact: true })).toBeFocused();
    await expect(page.getByRole("textbox", { name: "Progress note", exact: true })).toHaveValue("Retain review");
    await expect(page.getByLabel("Action title", { exact: true })).toHaveValue("Retain action");
    await expect(page.getByLabel("Topic title", { exact: true })).toHaveValue("Retain new topic");
    await page.getByRole("button", { name: "Finish voting", exact: true }).click();
    await page.getByRole("button", { name: "Cancel voting change" }).click();
    await expect(page.getByRole("button", { name: "Finish voting", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Finish voting", exact: true }).click();
    const finished = await command(page, "Confirm finish voting");
    await expect(colleague.getByRole("list", { name: "Final agenda" })).toBeVisible({ timeout: 5000 });
    const finalizeMs = Date.now() - finished;
    expect(finalizeMs).toBeLessThan(5000);
    const visibilityEvidence = test.info().outputPath("voting-visibility.json");
    await writeFile(visibilityEvidence, JSON.stringify({
      startMs, voteMs, finalizeMs, limitMs: 5000, identities: 2, bothVisible: true, productionAccess: false
    }));
    await test.info().attach("VP8-voting-visibility", { path: visibilityEvidence, contentType: "application/json" });
    await expect(button(colleague, 3)).toBeDisabled();
    const final = await colleague.getByRole("list", { name: "Final agenda" }).allTextContents();
    await page.getByRole("button", { name: "Close session", exact: true }).click();
    await page.getByRole("button", { name: "Confirm close", exact: true }).click();
    await colleague.reload();
    await expect(colleague.getByRole("list", { name: "Final agenda" })).toHaveText(final[0]);
    expect(await db.agendaEntry.count({ where: { sessionId: session.id } })).toBe(4);
  } finally { await second.close(); }
});

test("VP2/3/11: keyboard selection, three-vote limit and selected controls retain refund access", async ({ page, context }) => {
  const { session } = await prepared();
  await login(context, data.alice.id);
  await page.goto(`/sessions/${session.id}`);
  for (let i = 0; i < 3; i++) {
    await expect(button(page, i)).toBeEnabled();
    await button(page, i).focus();
    await page.keyboard.press("Enter");
    await expect(button(page, i)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(`Votes remaining: ${2 - i} of 3`, { exact: true })).toBeVisible();
  }
  await expect(button(page, 3)).toBeDisabled();
  await expect(button(page, 0)).toBeEnabled();
  await button(page, 0).click();
  await expect(page.getByText("Votes remaining: 1 of 3", { exact: true })).toBeVisible();
  await expect(button(page, 3)).toBeEnabled();
  await button(page, 3).click();
  await expect(page.getByText("Votes remaining: 0 of 3", { exact: true })).toBeVisible();
  expect(await db.topicVote.count({ where: { sessionId: session.id } })).toBe(3);
  await page.reload();
  await expect(button(page, 3)).toHaveAttribute("aria-pressed", "true");
  await expect(button(page, 0)).toHaveAttribute("aria-pressed", "false");
});

test("VP3/9: a same-user stale tab conflicts without undoing a newer ballot", async ({ page, context }) => {
  const { session } = await prepared();
  await login(context, data.alice.id);
  await page.goto(`/sessions/${session.id}`);
  const tab = await context.newPage();
  await tab.goto(page.url());
  const snapshot = await (await tab.request.get(`/api/sessions/${session.id}/snapshot`)).json();
  await tab.route("**/api/sessions/*/snapshot", route => route.fulfill({ json: snapshot }));
  await button(page, 0).click();
  await expect(button(page, 0)).toHaveAttribute("aria-pressed", "true");
  await button(tab, 1).click();
  await expect(tab.getByRole("alert").filter({ hasText: "Your ballot changed." })).toBeVisible();
  expect(await db.topicVote.count({ where: { sessionId: session.id } })).toBe(1);
  await tab.unroute("**/api/sessions/*/snapshot");
  await tab.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(button(tab, 0)).toHaveAttribute("aria-pressed", "true");
  await expect(button(tab, 1)).toBeEnabled();
  await button(tab, 1).click();
  await expect(button(tab, 1)).toHaveAttribute("aria-pressed", "true");
  expect(await db.topicVote.count({ where: { sessionId: session.id } })).toBe(2);
});

test("VP7/9: ballots stay private and expired/revoked access clears protected content", async ({ page, context }) => {
  const { session, topics } = await prepared();
  await db.sessionParticipant.create({ data: { teamId: data.alpha.id, sessionId: session.id, userId: data.bob.id, ballotVersion: 1 } });
  await db.topicVote.create({ data: { teamId: data.alpha.id, sessionId: session.id, userId: data.bob.id, topicId: topics[0].id } });
  await login(context, data.alice.id);
  await page.goto(`/sessions/${session.id}`);
  const response = await page.request.get(`/api/sessions/${session.id}/snapshot`);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const payload = await response.json();
  expect(payload.voting.selectedTopicIds).toEqual([]);
  expect(payload.voting.agenda[0].count).toBe(1);
  expect(JSON.stringify(payload)).not.toMatch(/"userId"|sessionToken|access_token|"votes"/);
  await page.getByLabel("Action title", { exact: true }).fill("Protected voting draft");
  await context.clearCookies();
  await expect(page.getByRole("heading", { name: "Session access unavailable" })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("list", { name: "Provisional agenda" })).toHaveCount(0);
  await expect(page.getByLabel("Action title", { exact: true })).toHaveCount(0);
  expect((await page.request.get(`/api/sessions/${session.id}/snapshot`)).status()).toBe(401);
});

test("VP9: offline and invalid snapshots disable voting until reconciled without resetting drafts", async ({ page, context }) => {
  const { session } = await prepared();
  await login(context, data.alice.id);
  await page.goto(`/sessions/${session.id}`);
  await page.getByLabel("Action title", { exact: true }).fill("Retain on outage");
  await context.setOffline(true);
  await expect(button(page, 0)).toBeDisabled();
  await expect(page.getByText("Updates unavailable.", { exact: false })).toBeVisible();
  await context.setOffline(false);
  await expect(button(page, 0)).toBeEnabled({ timeout: 5000 });
  await page.route("**/api/sessions/*/snapshot", route => route.fulfill({ json: { invalid: true } }));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(button(page, 0)).toBeDisabled({ timeout: 5000 });
  await expect(page.getByLabel("Action title", { exact: true })).toHaveValue("Retain on outage");
  await page.unroute("**/api/sessions/*/snapshot");
  await page.getByRole("button", { name: "Retry updates" }).click();
  await expect(button(page, 0)).toBeEnabled();
});

test("VP9: a committed vote with a lost response is reconciled, never replayed", async ({ page, context }) => {
  const { session } = await prepared();
  await login(context, data.alice.id);
  await page.goto(`/sessions/${session.id}`);
  let posts = 0;
  await page.route("**/sessions/*", async route => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    posts++;
    await route.fetch();
    await route.abort("failed");
  });
  await button(page, 0).click();
  await expect(page.getByRole("alert").filter({ hasText: "Save could not be confirmed" })).toBeVisible();
  await expect(button(page, 0)).toHaveAttribute("aria-pressed", "true", { timeout: 5000 });
  expect(posts).toBe(1);
  expect(await db.topicVote.count({ where: { sessionId: session.id } })).toBe(1);
  await page.unroute("**/sessions/*");
  await expect(button(page, 0)).toBeEnabled();
  await button(page, 0).click();
  await expect(button(page, 0)).toHaveAttribute("aria-pressed", "false");
});

test("VP3/9/11: a confirmed write stays pending until its ballot snapshot is reconciled", async ({ page, context }) => {
  const { session } = await prepared();
  await login(context, data.alice.id);
  await page.goto(`/sessions/${session.id}`);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requested!: () => void;
  const readStarted = new Promise<void>(resolve => { requested = resolve; });
  let hold = false;
  await page.route("**/api/sessions/*/snapshot", async route => {
    if (hold) { requested(); await gate; }
    await route.continue();
  });
  try {
    const saved = page.waitForResponse(response => {
      if (response.request().method() !== "POST") return false;
      hold = true;
      return true;
    });
    await button(page, 0).click();
    await saved;
    await readStarted;
    await expect(page.getByRole("status").filter({ hasText: "Saving change and refreshing confirmed state" })).toBeVisible();
    await expect(button(page, 0)).toHaveAttribute("aria-pressed", "false");
    await expect(button(page, 1)).toBeDisabled();
  } finally { release(); }
  await expect(button(page, 0)).toHaveAttribute("aria-pressed", "true");
  await expect(button(page, 1)).toBeEnabled();
  expect(await db.topicVote.count({ where: { sessionId: session.id } })).toBe(1);
});

test("VP5/6: zero-vote finalization keeps all topics, remains final on reload and allows action capture", async ({ page, context }) => {
  const { session, topics } = await prepared();
  await login(context, data.alice.id);
  await page.goto(`/sessions/${session.id}`);
  await page.getByRole("button", { name: "Finish voting", exact: true }).click();
  await expect(page.getByText("Unused votes are allowed, including no votes.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Confirm finish voting" }).click();
  const agenda = page.getByRole("list", { name: "Final agenda" });
  await expect(agenda.getByRole("listitem")).toHaveCount(4);
  const expected = [...topics].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1)).map(topic => `${topic.title} / Votes: 0`);
  await expect(agenda.getByRole("listitem")).toHaveText(expected);
  await expect(page.getByRole("button", { name: "Start voting", exact: true })).toHaveCount(0);
  await page.getByLabel("Action title", { exact: true }).fill("After finalization");
  await page.getByRole("combobox", { name: "Owner", exact: true }).selectOption(data.alice.id);
  await page.getByRole("button", { name: "Capture action" }).click();
  await expect(page.getByRole("link", { name: "After finalization" })).toBeVisible();
  await page.reload();
  await expect(agenda.getByRole("listitem")).toHaveText(expected);
  expect(await db.agendaEntry.count({ where: { sessionId: session.id } })).toBe(4);
});
