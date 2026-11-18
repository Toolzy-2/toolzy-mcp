import { describe, expect, it } from "vitest";
import { PUBLIC_RULES, PUBLIC_TOOL_RULES } from "../config";
import { checkPublicCalls, clientKey, publicToolCalls, rateLimitedResponse } from "../publicLimit";
import { createFakePool } from "./fakePool";

const call = (name: string, id: number | string = 1) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: {} },
});

const headers = (values: Record<string, string>) => new Headers(values);

describe("clientKey", () => {
  it("préfère l'IP posée par Vercel (x-real-ip), non modifiable par le client", () => {
    const key = clientKey(headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }));
    expect(key).toBe(clientKey(headers({ "x-real-ip": "203.0.113.7" })));
    expect(key).not.toBe(clientKey(headers({ "x-real-ip": "198.51.100.1" })));
  });

  it("ne stocke jamais l'IP en clair", () => {
    const key = clientKey(headers({ "x-real-ip": "203.0.113.7" }));
    expect(key).toMatch(/^ip:[0-9a-f]{32}$/);
    expect(key).not.toContain("203.0.113.7");
  });

  it("retombe sur la première IP de x-forwarded-for, puis sur un compteur commun", () => {
    expect(clientKey(headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe(
      clientKey(headers({ "x-real-ip": "203.0.113.7" })),
    );
    expect(clientKey(headers({}))).toBe("ip:inconnue");
  });
});

describe("publicToolCalls", () => {
  it("ne compte que les appels d'outils publics, lots compris", () => {
    const body = [call("search_tools"), call("whoami"), call("get_tool_details"), { method: "tools/list" }];
    expect(publicToolCalls(body)).toEqual(["search_tools", "get_tool_details"]);
  });

  it("ignore initialize, tools/list et les corps illisibles", () => {
    expect(publicToolCalls({ jsonrpc: "2.0", id: 1, method: "initialize" })).toEqual([]);
    expect(publicToolCalls(null)).toEqual([]);
    expect(publicToolCalls("texte")).toEqual([]);
  });

  it("ignore un outil inconnu (le serveur MCP le refusera de toute façon)", () => {
    expect(publicToolCalls(call("outil_qui_n_existe_pas"))).toEqual([]);
  });
});

describe("checkPublicCalls", () => {
  const now = new Date("2026-11-18T20:00:30Z");
  const perMinute = PUBLIC_RULES.find((rule) => rule.windowSeconds === 60)!;

  it("laisse passer jusqu'au seuil par minute, puis refuse avec l'attente", async () => {
    const { pool } = createFakePool();
    for (let i = 0; i < perMinute.max; i++) {
      expect((await checkPublicCalls(pool, "ip:a", ["search_tools"], now)).kind).toBe("allow");
    }
    const refused = await checkPublicCalls(pool, "ip:a", ["search_tools"], now);
    expect(refused).toMatchObject({ kind: "rate_limited", retryAfterSeconds: 30 });
  });

  it("compte chaque IP séparément", async () => {
    const { pool } = createFakePool();
    for (let i = 0; i < perMinute.max; i++) await checkPublicCalls(pool, "ip:a", ["search_tools"], now);
    expect((await checkPublicCalls(pool, "ip:b", ["search_tools"], now)).kind).toBe("allow");
  });

  it("compte chaque appel d'un lot", async () => {
    const { pool } = createFakePool();
    const batch = Array.from({ length: perMinute.max + 1 }, () => "search_tools");
    expect((await checkPublicCalls(pool, "ip:a", batch, now)).kind).toBe("rate_limited");
  });

  it("applique une limite plus stricte aux fiches d'annonce (aspiration du catalogue)", async () => {
    const detailsHour = PUBLIC_TOOL_RULES.get_tool_details.find((rule) => rule.windowSeconds === 3600)!;
    expect(detailsHour.max).toBeLessThan(PUBLIC_RULES.find((rule) => rule.windowSeconds === 3600)!.max);
    const { pool } = createFakePool();
    const hourStart = new Date("2026-11-18T20:00:00Z").getTime();
    let decision = await checkPublicCalls(pool, "ip:a", ["get_tool_details"], new Date(hourStart));
    for (let i = 1; i <= detailsHour.max; i++) {
      // Deux par minute, dans la même heure : seule la limite horaire des fiches joue.
      decision = await checkPublicCalls(pool, "ip:a", ["get_tool_details"], new Date(hourStart + i * 30_000));
    }
    expect(decision.kind).toBe("rate_limited");
  });

  it("laisse passer si la base de comptage est indisponible (outils en lecture)", async () => {
    const { pool } = createFakePool({ failOn: "mcp_rate_counters" });
    expect((await checkPublicCalls(pool, "ip:a", ["search_tools"], now)).kind).toBe("allow");
  });
});

describe("rateLimitedResponse", () => {
  it("répond 429 avec Retry-After et une erreur JSON-RPC lisible par l'assistant", async () => {
    const response = rateLimitedResponse(call("search_tools", 7), {
      kind: "rate_limited",
      retryAfterSeconds: 30,
      message: "Limite atteinte.",
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: { code: -32000, message: "Limite atteinte." },
    });
  });

  it("répond une erreur par message d'un lot", async () => {
    const response = rateLimitedResponse([call("search_tools", 1), call("get_tool_details", 2)], {
      kind: "rate_limited",
      retryAfterSeconds: 5,
      message: "Limite atteinte.",
    });
    const body = (await response.json()) as Array<{ id: number }>;
    expect(body.map((m) => m.id)).toEqual([1, 2]);
  });
});
