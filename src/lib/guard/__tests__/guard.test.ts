import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, formatWait } from "../guard";
import { createFakePool } from "./fakePool";

const NOW = new Date("2026-11-19T10:17:30.000Z");

afterEach(() => vi.restoreAllMocks());

const callTimes = async (pool: ReturnType<typeof createFakePool>["pool"], tool: string, times: number) => {
  let last = await checkRateLimit(pool, "u1", tool, NOW);
  for (let i = 1; i < times; i += 1) last = await checkRateLimit(pool, "u1", tool, NOW);
  return last;
};

describe("checkRateLimit", () => {
  it("autorise le 20e message de l'heure et refuse le 21e avec l'attente en français", async () => {
    const { pool } = createFakePool();
    expect(await callTimes(pool, "send_message", 20)).toEqual({ kind: "allow" });
    const refused = await checkRateLimit(pool, "u1", "send_message", NOW);
    expect(refused.kind).toBe("rate_limited");
    if (refused.kind !== "rate_limited") return;
    expect(refused.message).toContain("20 messages par heure");
    expect(refused.message).toContain("43 minutes");
    expect(refused.message).not.toMatch(/—/);
  });

  it("limite update_my_listing à 30 par heure", async () => {
    const { pool } = createFakePool();
    expect(await callTimes(pool, "update_my_listing", 30)).toEqual({ kind: "allow" });
    expect((await checkRateLimit(pool, "u1", "update_my_listing", NOW)).kind).toBe("rate_limited");
  });

  it("limite l'ensemble des outils connectés à 120 par minute", async () => {
    const { pool } = createFakePool();
    await callTimes(pool, "whoami", 60);
    expect(await callTimes(pool, "list_my_listings", 60)).toEqual({ kind: "allow" });
    const refused = await checkRateLimit(pool, "u1", "list_my_conversations", NOW);
    expect(refused).toMatchObject({ kind: "rate_limited" });
  });

  it("n'affecte pas un autre utilisateur", async () => {
    const { pool } = createFakePool();
    await callTimes(pool, "send_message", 21);
    expect(await checkRateLimit(pool, "u2", "send_message", NOW)).toEqual({ kind: "allow" });
  });

  it("fail-closed pour les outils d'écriture si la base est indisponible", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { pool } = createFakePool({ failOn: "mcp_rate_counters" });
    for (const tool of ["send_message", "update_my_listing"]) {
      const decision = await checkRateLimit(pool, "u1", tool, NOW);
      expect(decision.kind).toBe("unavailable");
    }
    expect(errors).toHaveBeenCalled();
  });

  it("fail-open pour les outils de lecture si la base est indisponible", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { pool } = createFakePool({ failOn: "mcp_rate_counters" });
    expect(await checkRateLimit(pool, "u1", "list_my_reservations", NOW)).toEqual({ kind: "allow" });
    expect(errors).toHaveBeenCalled();
  });

  it("fail-closed pour l'écriture si le pool ne peut pas être créé", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const getPool = () => {
      throw new Error("MCP_AUTH_DATABASE_URL manquante");
    };
    expect((await checkRateLimit(getPool, "u1", "send_message", NOW)).kind).toBe("unavailable");
    expect(await checkRateLimit(getPool, "u1", "whoami", NOW)).toEqual({ kind: "allow" });
  });
});

describe("formatWait", () => {
  it.each([
    [1, "1 seconde"],
    [45, "45 secondes"],
    [61, "2 minutes"],
    [3600, "60 minutes"],
    [3601, "1 h 1 min"],
    [13 * 3600 + 42 * 60 + 30, "13 h 43 min"],
    [7200, "2 h"],
  ])("%i s donne « %s »", (seconds, expected) => {
    expect(formatWait(seconds)).toBe(expected);
  });
});
