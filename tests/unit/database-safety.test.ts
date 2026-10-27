import { afterEach, expect, it, vi } from "vitest";
import { testDatabase } from "../support/database";

afterEach(() => { vi.unstubAllEnvs(); });

it("refuses a cloud production database even if the host is pinned", () => {
  vi.stubEnv("TEST_DATABASE_URL", "postgresql://test:test@ep-demo.eu-central-1.aws.neon.tech/teampulse");
  vi.stubEnv("NEON_TEST_DATABASE_HOST", "ep-demo.eu-central-1.aws.neon.tech");
  expect(() => testDatabase()).toThrow("isolated");
});

it("refuses an unpinned remote test database", () => {
  vi.stubEnv("TEST_DATABASE_URL", "postgresql://test:test@ep-demo.eu-central-1.aws.neon.tech/teampulse_test");
  vi.stubEnv("NEON_TEST_DATABASE_HOST", "");
  expect(() => testDatabase()).toThrow("isolated");
});

it("refuses a remote non-Neon host even if pinned", () => {
  vi.stubEnv("TEST_DATABASE_URL", "postgresql://test:test@example.com/teampulse_test");
  vi.stubEnv("NEON_TEST_DATABASE_HOST", "example.com");
  expect(() => testDatabase()).toThrow("isolated");
});

it("refuses missing test configuration", () => {
  vi.stubEnv("TEST_DATABASE_URL", "");
  expect(() => testDatabase()).toThrow("never fall back");
});
