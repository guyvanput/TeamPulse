import { randomBytes } from "node:crypto";
import { test, expect, type BrowserContext } from "@playwright/test";
import { fixture, cleanFixture, testDatabase } from "../support/database";

const db = testDatabase();
let data: Awaited<ReturnType<typeof fixture>>;
test.beforeEach(async () => {
  data = await fixture(db);
  data.alice = await db.user.update({ where: { id: data.alice.id }, data: { name: "Alice" } });
});
test.afterEach(async () => { if (data) await cleanFixture(db, data); });
test.afterAll(async () => { await db.$disconnect(); });
async function login(context: BrowserContext, userId: string) {
  const sessionToken = randomBytes(32).toString("hex");
  await db.session.create({ data: { userId, sessionToken, expires: new Date(Date.now() + 3600000) } });
  await context.addCookies([{ name: "authjs.session-token", value: sessionToken, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }]);
}
const pad = (n: number) => String(n).padStart(2, "0");
async function seed() {
  for (let i = 0; i < 22; i++) await db.teamSession.create({ data: {
    teamId: data.alpha.id, title: `History closed ${pad(i)}`, kind: "FACILITATED", facilitatorId: data.alice.id,
    collectionState: "CLOSED", closedAt: new Date(), createdAt: new Date(Date.UTC(2026, 1, 1 + i))
  } });
  await db.teamSession.create({ data: {
    teamId: data.alpha.id, title: "History current", kind: "FACILITATED", facilitatorId: data.alice.id,
    collectionState: "COLLECTING", createdAt: new Date(Date.UTC(2026, 5, 1))
  } });
}
const links = (page: import("@playwright/test").Page) => page.locator(".history .session-list a");

test("SH1/3/4: keyboard Load more continues without repeats, filters restart paging, and another team sees nothing", async ({ page, context, browser }) => {
  await seed();
  await login(context, data.alice.id);
  await page.goto("/");
  await expect(links(page)).toHaveCount(20);
  await expect(links(page).first()).toHaveText("History current");
  await expect(page.getByText("Facilitator: Alice").first()).toBeVisible();
  await expect(page.getByText("No summary yet").first()).toBeVisible();
  const more = page.getByRole("button", { name: "Load more sessions" });
  await more.focus();
  await db.teamSession.create({ data: {
    teamId: data.alpha.id, title: "History late arrival", kind: "FACILITATED", facilitatorId: data.alice.id,
    collectionState: "COLLECTING", createdAt: new Date(Date.UTC(2026, 8, 1))
  } });
  await page.keyboard.press("Enter");
  await expect(links(page)).toHaveCount(23);
  await expect(page.getByRole("link", { name: "History closed 02", exact: true })).toBeFocused();
  await expect(page.getByRole("link", { name: "History late arrival" })).toHaveCount(0);
  await expect(more).toHaveCount(0);
  const titles = await links(page).allTextContents();
  expect(new Set(titles).size).toBe(titles.length);

  await page.getByRole("radio", { name: "Closed" }).click();
  await expect(page.getByRole("radio", { name: "Closed" })).toBeChecked();
  await expect(links(page)).toHaveCount(20);
  await expect(page.getByRole("link", { name: "History current" })).toHaveCount(0);
  await page.getByRole("button", { name: "Load more sessions" }).click();
  await expect(links(page)).toHaveCount(22);
  await page.getByRole("radio", { name: "In progress" }).click();
  await expect(page.getByRole("radio", { name: "In progress" })).toBeChecked();
  await expect(links(page)).toHaveCount(2);
  await expect(links(page).first()).toHaveText("History late arrival");
  await expect(links(page).nth(1)).toHaveText("History current");

  const second = await browser.newContext();
  try {
    await login(second, data.bob.id);
    const other = await second.newPage();
    await other.goto("/");
    await expect(other.getByText("History closed 00")).toHaveCount(0);
    const denied = await other.request.get(`/api/teams/${data.alpha.id}/history?filter=ALL`);
    expect(denied.status()).toBe(404);
    expect(await denied.text()).not.toContain("History");
  } finally { await second.close(); }
});

test("SH6: a failed page load keeps rows, announces the failure and Retry recovers", async ({ page, context }) => {
  await seed();
  await login(context, data.alice.id);
  await page.goto("/");
  await expect(links(page)).toHaveCount(20);
  await page.route("**/api/teams/*/history*", route => route.fulfill({ status: 500, json: { error: "History unavailable. Please retry." } }));
  await page.getByRole("button", { name: "Load more sessions" }).click();
  const alert = page.locator(".history [role=alert]");
  await expect(alert).toContainText("Could not load more sessions");
  await expect(links(page)).toHaveCount(20);
  await page.unroute("**/api/teams/*/history*");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(links(page)).toHaveCount(23);
  await expect(alert).toHaveCount(0);
});
