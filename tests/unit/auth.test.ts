import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, NextAuthConfig } from "next-auth";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  captured: {} as { config?: NextAuthConfig }
}));
vi.mock("@/lib/db", () => ({ db: { account: { findUnique: mocks.findUnique } } }));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: vi.fn(() => ({})) }));
vi.mock("next-auth", () => ({
  default: (config: NextAuthConfig) => {
    mocks.captured.config = config;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  }
}));
await import("../../src/auth");

function signIn(account: Account | null) {
  const callback = mocks.captured.config?.callbacks?.signIn;
  if (!callback) throw new Error("Sign-in callback was not registered.");
  return callback({ account, user: { id: "incoming-user", email: "same@example.test" } });
}
function github(id = "123456") {
  return { provider: "github", type: "oauth", providerAccountId: id } satisfies Account;
}

beforeEach(() => {
  mocks.findUnique.mockReset();
});

it("returns true only for the exact provisioned GitHub identity", async () => {
  mocks.findUnique.mockResolvedValue({ user: { memberships: [{ teamId: "alpha" }] } });

  expect(await signIn(github())).toBe(true);
  expect(mocks.findUnique.mock.calls).toEqual([[
    {
      where: { provider_providerAccountId: { provider: "github", providerAccountId: "123456" } },
      include: { user: { include: { memberships: true } } }
    }
  ]]);
});

it("returns false without querying accounts when no provider account exists", async () => {
  expect(await signIn(null)).toBe(false);
  expect(mocks.findUnique).not.toHaveBeenCalled();
});

it("returns false without querying accounts for a different provider", async () => {
  expect(await signIn({ ...github(), provider: "other-provider" })).toBe(false);
  expect(mocks.findUnique).not.toHaveBeenCalled();
});

it("returns false for an unknown GitHub identity even when an email is supplied", async () => {
  mocks.findUnique.mockResolvedValue(null);

  expect(await signIn(github("unprovisioned-id"))).toBe(false);
  expect(mocks.findUnique).toHaveBeenCalledWith({
    where: { provider_providerAccountId: { provider: "github", providerAccountId: "unprovisioned-id" } },
    include: { user: { include: { memberships: true } } }
  });
});

it("returns false for a known account that has no team memberships", async () => {
  mocks.findUnique.mockResolvedValue({ user: { memberships: [] } });

  expect(await signIn(github())).toBe(false);
});

it("rejects with the original database failure instead of granting access", async () => {
  const failure = new Error("Synthetic database lookup failure");
  mocks.findUnique.mockRejectedValue(failure);

  await expect(signIn(github())).rejects.toBe(failure);
});

it("returns false on the next sign-in after the last membership is removed", async () => {
  mocks.findUnique
    .mockResolvedValueOnce({ user: { memberships: [{ teamId: "alpha" }] } })
    .mockResolvedValueOnce({ user: { memberships: [] } });

  expect(await signIn(github())).toBe(true);
  expect(await signIn(github())).toBe(false);
  expect(mocks.findUnique).toHaveBeenCalledTimes(2);
});

it("returns true for a provisioned account with multiple team memberships", async () => {
  mocks.findUnique.mockResolvedValue({ user: { memberships: [{ teamId: "alpha" }, { teamId: "beta" }] } });

  expect(await signIn(github())).toBe(true);
});

it("sets the session identity to the database user ID instead of the provider identity", async () => {
  const callback = mocks.captured.config?.callbacks?.session;
  if (!callback) throw new Error("Session callback was not registered.");
  const user = { id: "database-user-id", email: "member@example.test", emailVerified: null };
  const session = {
    sessionToken: "synthetic-token", userId: user.id,
    // Auth.js's callback type intersects adapter Date and public-session string.
    expires: "2026-11-01T00:00:00Z" as string & Date,
    user: { id: "incoming-id", email: user.email, emailVerified: null }
  };

  const result = await callback({ session, user, token: {}, newSession: undefined, trigger: "update" });

  expect(result).toEqual({ ...session, user: { id: "database-user-id", email: "member@example.test", emailVerified: null } });
});

describe("bugmagnet session 2026-10-27", () => {
  it.each(["", " 123456 ", "000123456", "\u200b123456", "123456\u0430", "9".repeat(256)])(
    "returns false for an unprovisioned exact identity %j without normalization",
    async (identity) => {
      mocks.findUnique.mockImplementation(async ({ where }) =>
        where.provider_providerAccountId.providerAccountId === "123456"
          ? { user: { memberships: [{ teamId: "alpha" }] } }
          : null);

      expect(await signIn(github(identity))).toBe(false);
      expect(mocks.findUnique).toHaveBeenCalledWith({
        where: { provider_providerAccountId: { provider: "github", providerAccountId: identity } },
        include: { user: { include: { memberships: true } } }
      });
    }
  );

  it("allows a later valid sign-in after a failed lookup without retaining the failure", async () => {
    const failure = new Error("Synthetic temporary outage");
    mocks.findUnique
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ user: { memberships: [{ teamId: "alpha" }] } });

    await expect(signIn(github())).rejects.toBe(failure);
    expect(await signIn(github())).toBe(true);
    expect(mocks.findUnique).toHaveBeenCalledTimes(2);
  });
});
