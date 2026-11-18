import { describe, expect, it } from "vitest";
import { GLOBAL_RULE, RATE_LIMIT_RULES } from "../config";
import { evaluateCounts, incrementCounters, rulesFor, windowStartOf } from "../rateLimit";
import { createFakePool } from "./fakePool";

const NOW = new Date("2026-11-19T10:17:30.000Z");

describe("seuils configurés", () => {
  it("send_message : 20 par heure et 100 par jour", () => {
    const rules = RATE_LIMIT_RULES.send_message.map((r) => [r.max, r.windowSeconds]);
    expect(rules).toEqual(expect.arrayContaining([[20, 3600], [100, 86400]]));
  });

  it("update_my_listing : 30 par heure", () => {
    expect(RATE_LIMIT_RULES.update_my_listing.map((r) => [r.max, r.windowSeconds])).toEqual([[30, 3600]]);
  });

  it("tous les outils connectés confondus : 120 par minute", () => {
    expect([GLOBAL_RULE.max, GLOBAL_RULE.windowSeconds]).toEqual([120, 60]);
  });

  it("un outil de lecture n'a que la règle globale, un outil d'écriture les deux", () => {
    expect(rulesFor("whoami")).toEqual([GLOBAL_RULE]);
    expect(rulesFor("send_message")).toHaveLength(3);
    expect(rulesFor("send_message")[0]).toBe(GLOBAL_RULE);
  });

  it("les noms de compteur sont uniques", () => {
    const buckets = [GLOBAL_RULE, ...Object.values(RATE_LIMIT_RULES).flat()].map((r) => r.bucket);
    expect(new Set(buckets).size).toBe(buckets.length);
  });
});

describe("fenêtres fixes", () => {
  it("aligne la fenêtre sur la minute, l'heure ou le jour UTC", () => {
    expect(windowStartOf(NOW, 60).toISOString()).toBe("2026-11-19T10:17:00.000Z");
    expect(windowStartOf(NOW, 3600).toISOString()).toBe("2026-11-19T10:00:00.000Z");
    expect(windowStartOf(NOW, 86400).toISOString()).toBe("2026-11-19T00:00:00.000Z");
  });
});

describe("incrément des compteurs", () => {
  it("incrémente en une seule requête atomique (ON CONFLICT ... RETURNING)", async () => {
    const fake = createFakePool();
    await incrementCounters(fake.pool, "u1", rulesFor("send_message"), NOW);
    expect(fake.queries).toHaveLength(1);
    expect(fake.queries[0].text).toMatch(/on conflict \(user_id, bucket, window_start\) do update/i);
    expect(fake.queries[0].text).toMatch(/returning/i);
  });

  it("compte séparément par utilisateur", async () => {
    const fake = createFakePool();
    await incrementCounters(fake.pool, "u1", rulesFor("whoami"), NOW);
    await incrementCounters(fake.pool, "u1", rulesFor("whoami"), NOW);
    const other = await incrementCounters(fake.pool, "u2", rulesFor("whoami"), NOW);
    expect(other[0].count).toBe(1);
  });

  it("repart à zéro à la fenêtre suivante", async () => {
    const fake = createFakePool();
    await incrementCounters(fake.pool, "u1", rulesFor("whoami"), NOW);
    const next = await incrementCounters(fake.pool, "u1", rulesFor("whoami"), new Date(NOW.getTime() + 60_000));
    expect(next[0].count).toBe(1);
  });

  it("refuse une réponse de base mal formée", async () => {
    const pool = { query: async () => ({ rows: [{ bucket: "connected:60", count: "beaucoup" }] }) };
    await expect(incrementCounters(pool, "u1", rulesFor("whoami"), NOW)).rejects.toThrow();
  });

  it("refuse une réponse de base incomplète", async () => {
    const pool = { query: async () => ({ rows: [] }) };
    await expect(incrementCounters(pool, "u1", rulesFor("send_message"), NOW)).rejects.toThrow();
  });
});

describe("décision", () => {
  const hourRule = RATE_LIMIT_RULES.send_message.find((r) => r.windowSeconds === 3600)!;
  const dayRule = RATE_LIMIT_RULES.send_message.find((r) => r.windowSeconds === 86400)!;

  it("autorise jusqu'au seuil inclus", () => {
    const counts = [{ rule: hourRule, windowStart: windowStartOf(NOW, 3600), count: 20 }];
    expect(evaluateCounts(counts, NOW)).toEqual({ allowed: true });
  });

  it("refuse au-delà du seuil et donne l'attente jusqu'à la fin de la fenêtre", () => {
    const counts = [{ rule: hourRule, windowStart: windowStartOf(NOW, 3600), count: 21 }];
    const decision = evaluateCounts(counts, NOW);
    expect(decision).toMatchObject({ allowed: false, rule: hourRule, retryAfterSeconds: 42 * 60 + 30 });
  });

  it("retient l'attente la plus longue quand plusieurs seuils sont dépassés", () => {
    const counts = [
      { rule: hourRule, windowStart: windowStartOf(NOW, 3600), count: 21 },
      { rule: dayRule, windowStart: windowStartOf(NOW, 86400), count: 101 },
    ];
    expect(evaluateCounts(counts, NOW)).toMatchObject({ allowed: false, rule: dayRule });
  });
});
