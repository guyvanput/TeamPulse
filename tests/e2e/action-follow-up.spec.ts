import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { test, expect, type BrowserContext } from "@playwright/test";
import { cleanFixture, fixture, testDatabase } from "../support/database";

const db = testDatabase();
let data: Awaited<ReturnType<typeof fixture>>;

test.beforeEach(async () => { data = await fixture(db); });
test.afterEach(async () => { if (data) await cleanFixture(db, data); });
test.afterAll(async () => { await db.$disconnect(); });

async function login(context: BrowserContext, userId: string) {
  const sessionToken = randomBytes(32).toString("hex");
  await db.session.create({ data: { userId, sessionToken, expires: new Date(Date.now() + 3_600_000) } });
  await context.addCookies([{ name: "authjs.session-token", value: sessionToken, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }]);
}

test("AC2/3/5/6/8/10: capture, revisit, complete, and retain history", async ({ page, context }) => {
  await login(context, data.alice.id);
  await page.goto("/");
  await page.getByRole("textbox", { name: "Session name" }).fill("First conversation");
  await page.getByRole("button", { name: "Create session" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("First conversation");
  await expect(page.getByText("No unresolved actions from earlier sessions.")).toBeVisible();
  const firstUrl = page.url();
  await page.getByRole("textbox", { name: "Action title" }).focus();
  await page.keyboard.type("Improve release handover");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("textbox", { name: "Discussion context" })).toBeFocused();
  await page.keyboard.type("The discussion identified unclear release ownership.");
  await page.getByRole("combobox", { name: "Owner" }).selectOption(data.alice.id);
  await page.getByLabel("Due date (optional)").fill("2026-12-01");
  await page.getByRole("button", { name: "Capture action" }).click();
  await expect(page.getByRole("status")).toHaveText("Action captured.");
  await page.reload();
  await expect(page.getByRole("link", { name: "Improve release handover" })).toBeVisible();

  await page.getByRole("link", { name: "Back to workspace" }).click();
  await page.getByRole("textbox", { name: "Session name" }).fill("Next conversation");
  await page.getByRole("button", { name: "Create session" }).click();
  const commitments = page.locator("section").filter({ has: page.getByRole("heading", { name: "Previous commitments" }) });
  await expect(commitments.getByRole("link", { name: "Improve release handover" })).toBeVisible();
  await expect(commitments.getByText("The discussion identified unclear release ownership.")).toBeVisible();
  await page.getByRole("textbox", { name: "Progress note" }).fill("A checklist is now used for every release.");
  await page.getByRole("combobox", { name: "Resulting status" }).selectOption("DONE");
  await page.getByRole("button", { name: "Record review" }).click();
  await expect(page.getByText("No unresolved actions from earlier sessions.")).toBeVisible();
  await expect(page.getByText("A checklist is now used for every release.")).toBeVisible();
  await page.getByRole("link", { name: "Improve release handover" }).click();
  await expect(page.getByRole("heading", { name: "Review history" })).toBeVisible();
  await expect(page.getByText("The discussion identified unclear release ownership.")).toBeVisible();
  await expect(page.getByText("A checklist is now used for every release.")).toBeVisible();
  await page.goto(firstUrl);
  await expect(page.getByText(`Done / Owner: ${data.alice.name}`)).toBeVisible();
});

test("AC1/9: signed-out and foreign-team reads are denied", async ({ page, context }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/signin$/);
  const session = await db.teamSession.create({ data: { teamId: data.beta.id, title: "Private Beta session" } });
  const action = await db.action.create({ data: { teamId: data.beta.id, sourceSessionId: session.id, ownerId: data.bob.id, title: "Private Beta action" } });
  await login(context, data.alice.id);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: data.beta.name })).toHaveCount(0);
  await page.goto(`/sessions/${session.id}`);
  await expect(page.getByRole("heading", { name: "Not found or access denied" })).toBeVisible();
  await expect(page.getByText("Private Beta session")).toHaveCount(0);
  await page.goto(`/actions/${action.id}`);
  await expect(page.getByRole("heading", { name: "Not found or access denied" })).toBeVisible();
  await expect(page.getByText("Private Beta action")).toHaveCount(0);
});

test("AC4/10: server validation announces a blank title without writing", async ({ page, context }) => {
  await login(context, data.alice.id);
  const session = await db.teamSession.create({ data: { teamId: data.alpha.id, title: "Validation session" } });
  await page.goto(`/sessions/${session.id}`);
  await page.getByRole("textbox", { name: "Action title" }).fill("   ");
  await page.getByRole("combobox", { name: "Owner" }).selectOption(data.alice.id);
  await page.getByRole("button", { name: "Capture action" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "A title is required." })).toBeVisible();
  expect(await db.action.count({ where: { sourceSessionId: session.id } })).toBe(0);
});

test("AC9: tampering with a form's session id cannot write to another team", async ({ page, context }) => {
    await login(context, data.alice.id);
    const own = await db.teamSession.create({ data: { teamId: data.alpha.id, title: "Own session" } });
    const foreign = await db.teamSession.create({ data: { teamId: data.beta.id, title: "Foreign session" } });
    await page.goto(`/sessions/${own.id}`);
    await page.getByRole("textbox", { name: "Action title" }).fill("Attempted cross-team write");
    await page.getByRole("combobox", { name: "Owner" }).selectOption(data.alice.id);
    await page.locator('input[name="sessionId"]').evaluate((element, value) => {
      if (!(element instanceof HTMLInputElement)) throw new Error("Expected a hidden input.");
      element.value = value;
    }, foreign.id);
    await page.getByRole("button", { name: "Capture action" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "access denied" })).toBeVisible();
    expect(await db.action.count({ where: { sourceSessionId: foreign.id } })).toBe(0);
});

test("AC1: an expired authenticated page cannot submit after sign-out", async ({ page, context }) => {
    await login(context, data.alice.id);
    const session = await db.teamSession.create({ data: { teamId: data.alpha.id, title: "Expired page" } });
    await page.goto(`/sessions/${session.id}`);
    await page.getByRole("textbox", { name: "Action title" }).fill("Must not be saved");
    await page.getByRole("combobox", { name: "Owner" }).selectOption(data.alice.id);
    await context.clearCookies();
    await page.getByRole("button", { name: "Capture action" }).click();
    await expect(page).toHaveURL(/\/signin$/);
    expect(await db.action.count({ where: { sourceSessionId: session.id } })).toBe(0);
});

async function startApp(port: number) {
  let logs = "";
  const child = spawn(process.execPath, [resolve("scripts", "start.mjs"), "--port", String(port)], {
    env: { ...process.env, AUTH_URL: `http://127.0.0.1:${port}` },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout?.on("data", (chunk) => { logs += String(chunk); });
  child.stderr?.on("data", (chunk) => { logs += String(chunk); });
  try {
    await expect.poll(async () => {
      if (child.exitCode !== null) throw new Error(`Restart server exited: ${logs}`);
      try { return (await fetch(`http://127.0.0.1:${port}/api/health`)).status; }
      catch (error) {
        if (error instanceof TypeError) return 0;
        throw error;
      }
    }, { timeout: 30_000 }).toBe(200);
    return child;
  } catch (error) {
    await stopApp(child);
    throw error;
  }
}

async function stopApp(child: ChildProcess) {
  if (child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  await exited;
}

test("TC11: facilitated state, roster, active and removed topics survive process restart", async ({ page, context }) => {
  test.setTimeout(90_000);
  await login(context, data.alice.id);
  const session = await db.teamSession.create({ data: {
    teamId: data.alpha.id, title: "Persistent facilitated session", kind: "FACILITATED",
    facilitatorId: data.alice.id, collectionState: "PAUSED",
    participants: { create: { userId: data.alice.id } }
  } });
  await db.topic.createMany({ data: [
    { teamId: data.alpha.id, sessionId: session.id, authorId: data.alice.id, title: "Persistent topic", description: "Persistent context" },
    { teamId: data.alpha.id, sessionId: session.id, authorId: data.alice.id, title: "Removed topic", removedAt: new Date(), removedById: data.alice.id }
  ] });
  let server = await startApp(3101);
  try {
    await page.goto(`http://127.0.0.1:3101/sessions/${session.id}`);
    await expect(page.getByRole("heading", { name: "Persistent topic", exact: true })).toBeVisible();
    await stopApp(server);
    server = await startApp(3101);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Persistent topic", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Removed topic", exact: true })).toBeVisible();
    await expect(page.getByText("Collection: Collection paused", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Resume collection" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Join session" })).toHaveCount(0);
  } finally { await stopApp(server); }
});

test("AC8: database action and review survive an actual application process restart", async ({ page, context }) => {
  test.setTimeout(90_000);
  await login(context, data.alice.id);
  const source = await db.teamSession.create({ data: { teamId: data.alpha.id, title: "Source" } });
  const later = await db.teamSession.create({ data: { teamId: data.alpha.id, title: "Later" } });
  const action = await db.action.create({ data: { teamId: data.alpha.id, sourceSessionId: source.id, ownerId: data.alice.id, title: "Persistent commitment", context: "Persistent context", status: "DONE" } });
  await db.actionReview.create({ data: { teamId: data.alpha.id, actionId: action.id, reviewSessionId: later.id, actorId: data.alice.id, note: "Persistent review", resultingStatus: "DONE" } });
  for (let attempt = 0; attempt < 2; attempt++) {
    const server = await startApp(3101);
    try {
      await page.goto(`http://127.0.0.1:3101/actions/${action.id}`);
      await expect(page.getByRole("heading", { name: "Persistent commitment" })).toBeVisible();
      await expect(page.getByText("Persistent context")).toBeVisible();
      await expect(page.getByText("Persistent review")).toBeVisible();
    } finally {
      await stopApp(server);
    }
  }
});
