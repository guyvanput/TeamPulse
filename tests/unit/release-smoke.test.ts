import { describe, expect, it, vi } from "vitest";
import { releaseSmoke } from "../../scripts/release-smoke.mjs";

const origin = "https://teampulse.example";
function responses(overrides: Record<string, () => Response> = {}) {
  const routes: Record<string, () => Response> = {
    "/api/health": () => Response.json({ status: "ok" }),
    "/signin": () => new Response("<button>Sign in with GitHub</button>"),
    "/api/auth/providers": () => Response.json({
      github: {
        id: "github", type: "oauth",
        signinUrl: `${origin}/api/auth/signin/github`,
        callbackUrl: `${origin}/api/auth/callback/github`
      }
    }),
    "/": () => new Response(null, { status: 307, headers: { location: "/signin" } }),
    "/sessions/release-smoke-missing": () => new Response(null, { status: 307, headers: { location: "/signin" } }),
    "/actions/release-smoke-missing": () => new Response(null, { status: 307, headers: { location: "/signin" } }),
    ...overrides
  };
  return vi.fn(async (url: URL, options: RequestInit) => {
    expect(options.redirect).toBe("manual");
    expect(options.method).toBeUndefined();
    const respond = routes[url.pathname];
    if (!respond) throw new Error(`Unexpected request: ${url.pathname}`);
    return respond();
  });
}

it("reports every read-only release check without claiming an authenticated journey", async () => {
  const request = responses();
  const result = await releaseSmoke(origin, request);
  expect(result.origin).toBe(origin);
  expect(result.checks).toEqual([
    { path: "/api/health", status: 200, result: "passed" },
    { path: "/signin", status: 200, result: "passed" },
    { path: "/api/auth/providers", status: 200, result: "passed" },
    { path: "/", status: 307, result: "passed" },
    { path: "/sessions/release-smoke-missing", status: 307, result: "passed" },
    { path: "/actions/release-smoke-missing", status: 307, result: "passed" }
  ]);
  expect(result.limitation).toContain("not evidence of interactive OAuth");
  expect(request).toHaveBeenCalledTimes(6);
  for (const [, options] of request.mock.calls) {
    expect(options.redirect).toBe("manual");
    expect(options.method).toBeUndefined();
  }
});

it.each([
  "http://teampulse.example", "https://user:secret@teampulse.example",
  `${origin}/path`, `${origin}?token=secret`, `${origin}#fragment`
])("refuses an unsafe or non-origin target %s before making requests", async (target) => {
  const request = responses();
  await expect(releaseSmoke(target, request)).rejects.toThrow("HTTPS origin");
  expect(request).not.toHaveBeenCalled();
});

describe("failed release checks", () => {
  it.each([
    ["/api/health", () => Response.json({ status: "error" }), "health check failed"],
    ["/api/health", () => new Response("maintenance", { status: 503 }), "health check failed"],
    ["/api/health", () => new Response(null, { status: 302, headers: { location: "/signin" } }), "health check failed"],
    ["/signin", () => new Response("Not found", { status: 404 }), "sign-in page"],
    ["/api/auth/providers", () => Response.json({}), "callback configuration"],
    ["/api/auth/providers", () => Response.json({
      github: { id: "github", type: "oauth", callbackUrl: "http://localhost:3000/api/auth/callback/github" }
    }), "callback configuration"],
    ["/", () => new Response("Private team data"), "access was not denied"],
    ["/", () => new Response(null, { status: 307, headers: { location: "https://other.example/signin" } }), "access was not denied"],
    ["/actions/release-smoke-missing", () => new Response("Not found", { status: 404 }), "access was not denied"]
  ] as const)("fails closed for %s", async (path, response, message) => {
    await expect(releaseSmoke(origin, responses({ [path]: response }))).rejects.toThrow(message);
  });

  it("propagates network failures instead of reporting success", async () => {
    await expect(releaseSmoke(origin, async () => { throw new Error("network unavailable"); }))
      .rejects.toThrow("network unavailable");
  });
});
