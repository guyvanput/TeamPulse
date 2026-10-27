import { pathToFileURL } from "node:url";

export async function releaseSmoke(origin, request = fetch) {
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.username || base.password ||
    base.pathname !== "/" || base.search || base.hash) {
    throw new Error("Provide an HTTPS origin without credentials, path, query, or fragment.");
  }
  const checks = [];
  async function check(path, verify) {
    const response = await request(new URL(path, base), {
      redirect: "manual", signal: AbortSignal.timeout(15_000),
      headers: { "Cache-Control": "no-cache" }
    });
    await verify(response);
    checks.push({ path, status: response.status, result: "passed" });
  }
  await check("/api/health", async (response) => {
    if (response.status !== 200 || !response.headers.get("content-type")?.includes("application/json") ||
      JSON.stringify(await response.json()) !== '{"status":"ok"}') {
      throw new Error("Database health check failed.");
    }
  });
  await check("/signin", async (response) => {
    if (response.status !== 200 || !(await response.text()).includes("Sign in with GitHub")) {
      throw new Error("GitHub sign-in page is unavailable.");
    }
  });
  await check("/api/auth/providers", async (response) => {
    if (response.status !== 200) throw new Error("Auth provider discovery failed.");
    const { github } = await response.json();
    if (github?.id !== "github" || github.type !== "oauth" ||
      github.callbackUrl !== new URL("/api/auth/callback/github", base).href ||
      github.signinUrl !== new URL("/api/auth/signin/github", base).href) {
      throw new Error("GitHub provider origin or callback configuration is incorrect.");
    }
  });
  for (const path of ["/", "/sessions/release-smoke-missing", "/actions/release-smoke-missing"]) {
    await check(path, async (response) => {
      if (![302, 303, 307, 308].includes(response.status) ||
        new URL(response.headers.get("location") ?? "/", base).href !== new URL("/signin", base).href) {
        throw new Error(`Signed-out access was not denied at ${path}.`);
      }
    });
  }
  return {
    origin: base.origin, checkedAt: new Date().toISOString(), checks,
    limitation: "Read-only signed-out checks only; not evidence of interactive OAuth, the owned-action journey, or recovery."
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.info(JSON.stringify(await releaseSmoke(process.argv[2]), null, 2));
  } catch (error) {
    console.error(`Release smoke failed: ${error.message}`);
    process.exitCode = 1;
  }
}
