// ============================================================
// demo-seed.test.ts — P0-A security hardening tests
// Covers:
//   1. isDemoSeedEnabled() env-flag semantics (absent / "1" / other values)
//   2. ensureDemoUser() assigns least-privilege role "user" (never "admin")
//   3. POST /api/seed-demo handler: 404 when disabled, 200 without any
//      password material in the response when enabled
// All DB access and bcrypt are mocked — no network, no real credentials.
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// DB mock — created via vi.hoisted so the vi.mock factories can reference it.
const dbMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), create: vi.fn() },
  offer: { findFirst: vi.fn(), create: vi.fn() },
  integration: { findUnique: vi.fn(), create: vi.fn() },
  prospect: { count: vi.fn(), create: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));

// bcrypt mock — auth.ts uses the default import (`import bcrypt from "bcryptjs"`).
vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn(async () => "$2a$10$mock-hashed-demo-password"),
    compare: vi.fn(async () => false),
  },
}));

import { ensureDemoUser, isDemoSeedEnabled } from "@/lib/auth";
import { POST } from "@/app/api/seed-demo/route";
import { mockAestheticClinics } from "@/lib/leads/mock-source-data";

const DEMO_EMAIL = "demo@agenteleads.com";

function setDemoEnv(value: string | undefined) {
  if (value === undefined) {
    delete process.env.ALLOW_DEMO_SEED;
  } else {
    process.env.ALLOW_DEMO_SEED = value;
  }
}

beforeEach(() => {
  // Start every test with the flag absent (production default)
  delete process.env.ALLOW_DEMO_SEED;
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.ALLOW_DEMO_SEED;
});

describe("isDemoSeedEnabled", () => {
  it("returns false when ALLOW_DEMO_SEED is absent (default)", () => {
    setDemoEnv(undefined);
    expect(isDemoSeedEnabled()).toBe(false);
  });

  it('returns true only when ALLOW_DEMO_SEED === "1"', () => {
    setDemoEnv("1");
    expect(isDemoSeedEnabled()).toBe(true);
  });

  it.each(["0", "true", "yes", "on", "", "1 "])(
    'returns false for other value: "%s"',
    (value) => {
      setDemoEnv(value);
      expect(isDemoSeedEnabled()).toBe(false);
    }
  );
});

describe("ensureDemoUser", () => {
  it('creates the demo user with role "user" (never "admin") and a hashed password', async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(null);
    dbMock.user.create.mockResolvedValueOnce({
      id: "demo-user-id",
      email: DEMO_EMAIL,
      name: "Demo User",
      role: "user",
      passwordHash: "$2a$10$mock-hashed-demo-password",
    });

    await ensureDemoUser();

    expect(dbMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: DEMO_EMAIL },
    });
    expect(dbMock.user.create).toHaveBeenCalledTimes(1);
    const arg = dbMock.user.create.mock.calls[0][0];
    expect(arg.data.email).toBe(DEMO_EMAIL);
    expect(arg.data.role).toBe("user");
    expect(arg.data.role).not.toBe("admin");
    // Password only ever stored hashed — plaintext never persisted.
    expect(arg.data.passwordHash).toBe("$2a$10$mock-hashed-demo-password");
    expect(arg.data.passwordHash).not.toBe("agente123");
  });

  it("returns the existing demo user without creating a duplicate", async () => {
    const existing = {
      id: "existing-id",
      email: DEMO_EMAIL,
      name: "Demo User",
      role: "user",
      passwordHash: "$2a$10$existing-hash",
    };
    dbMock.user.findUnique.mockResolvedValueOnce(existing);

    const result = await ensureDemoUser();

    expect(result).toEqual(existing);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/seed-demo", () => {
  function arrangeEnabledSeed() {
    dbMock.user.findUnique.mockResolvedValue(null);
    dbMock.user.create.mockResolvedValue({
      id: "demo-user-id",
      email: DEMO_EMAIL,
      name: "Demo User",
      role: "user",
      passwordHash: "$2a$10$mock-hashed-demo-password",
    });
    dbMock.offer.findFirst.mockResolvedValue(null);
    dbMock.offer.create.mockResolvedValue({ id: "demo-offer-id" });
    dbMock.integration.findUnique.mockResolvedValue(null);
    dbMock.integration.create.mockResolvedValue({ id: "demo-integ-id" });
    dbMock.prospect.count.mockResolvedValue(0);
    dbMock.prospect.create.mockResolvedValue({ id: "prospect-id" });
  }

  it("responds 404 without touching the DB when the flag is absent (default)", async () => {
    setDemoEnv(undefined);

    const res = await POST();

    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not Found");
    // Gate happens before any seeding: no DB access at all.
    expect(dbMock.user.findUnique).not.toHaveBeenCalled();
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("responds 404 when the flag has a value other than '1'", async () => {
    setDemoEnv("true");

    const res = await POST();

    expect(res.status).toBe(404);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("with the flag enabled, seeds and never exposes the demo password", async () => {
    setDemoEnv("1");
    arrangeEnabledSeed();

    const res = await POST();
    const text = await res.text();
    const body = JSON.parse(text);

    expect(res.status).toBe(200);
    expect(body.demo).toBe(true);
    expect(body.email).toBe(DEMO_EMAIL);
    expect(typeof body.note).toBe("string");

    // No password material whatsoever in the response (key or value).
    expect(text.toLowerCase()).not.toContain("password");
    expect(text).not.toContain("agente123");
    expect(body.user).toBeUndefined();

    // Seed actually ran behind the flag.
    expect(dbMock.user.create).toHaveBeenCalledTimes(1);
    expect(dbMock.offer.create).toHaveBeenCalledTimes(1);
    expect(dbMock.integration.create).toHaveBeenCalledTimes(1);
    expect(dbMock.prospect.create).toHaveBeenCalledTimes(
      Math.min(5, mockAestheticClinics.length)
    );
  });

  it("with the flag enabled, reuses existing offer/prospects (idempotent)", async () => {
    setDemoEnv("1");
    arrangeEnabledSeed();
    dbMock.offer.findFirst.mockResolvedValue({ id: "existing-offer-id" });
    dbMock.integration.findUnique.mockResolvedValue({ id: "existing-integ" });
    dbMock.prospect.count.mockResolvedValue(3);

    const res = await POST();

    expect(res.status).toBe(200);
    expect(dbMock.offer.create).not.toHaveBeenCalled();
    expect(dbMock.integration.create).not.toHaveBeenCalled();
    expect(dbMock.prospect.create).not.toHaveBeenCalled();
  });
});
