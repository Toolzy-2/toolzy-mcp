import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const grants = vi.hoisted(() => ({
  getGrantsDb: vi.fn(() => ({ fake: "pool" })),
  listConnectedApps: vi.fn(),
  revokeConnectedApp: vi.fn(),
}));
vi.mock("@/lib/auth/grants", () => grants);
vi.mock("@/lib/db/pool", () => ({ getPool: vi.fn() }));

import { DELETE, GET, OPTIONS } from "../route";

const SUB = "6594d54c-1a16-42c2-9892-c2bc6aff4eb0";
const OTHER = "22222222-2222-4222-8222-222222222222";
const BASE = "https://mcp.toolzy.io/api/connected-apps";
const GOOD_TOKEN = "h.eyJzdWIiOiJ4In0.s";

const ENV = {
  MCP_AUTH_DATABASE_URL: "postgresql://x",
  BETTER_AUTH_SECRET: "s",
  BETTER_AUTH_URL: "https://mcp.toolzy.io",
  MCP_RESOURCE_URL: "https://mcp.toolzy.io/api/mcp",
  SUPABASE_URL: "https://sb.test",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_OAUTH_CLIENT_ID: "id",
  SUPABASE_OAUTH_CLIENT_SECRET: "secret",
};

const request = (method: string, query = "", headers: Record<string, string> = {}) =>
  new Request(`${BASE}${query}`, { method, headers });

const authed = (method: string, query = "", origin = "https://www.toolzy.io") =>
  request(method, query, { Authorization: `Bearer ${GOOD_TOKEN}`, Origin: origin });

beforeEach(() => {
  for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
  // Supabase : seul GOOD_TOKEN est valide, il appartient à SUB.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const auth = new Headers(init.headers).get("authorization");
      return auth === `Bearer ${GOOD_TOKEN}`
        ? new Response(JSON.stringify({ id: SUB }), { status: 200 })
        : new Response(JSON.stringify({ msg: "bad jwt" }), { status: 401 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("authentification", () => {
  it.each(["GET", "DELETE"])("%s sans en-tête Authorization : 401 JSON", async (method) => {
    const response = await (method === "GET" ? GET : DELETE)(request(method, "?client_id=a"));
    expect(response.status).toBe(401);
    expect(await response.json()).toHaveProperty("error");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(grants.listConnectedApps).not.toHaveBeenCalled();
    expect(grants.revokeConnectedApp).not.toHaveBeenCalled();
  });

  it("jeton refusé par Supabase : 401", async () => {
    const response = await GET(request("GET", "", { Authorization: "Bearer h.e30.forged" }));
    expect(response.status).toBe(401);
    expect(grants.listConnectedApps).not.toHaveBeenCalled();
  });

  it("ignore les cookies : un cookie seul ne vaut pas authentification", async () => {
    const response = await GET(request("GET", "", { Cookie: "sb-access-token=whatever" }));
    expect(response.status).toBe(401);
  });
});

describe("GET /api/connected-apps", () => {
  it("renvoie les applications de l'appelant, identifié par le jeton seulement", async () => {
    const apps = [{ client_id: "c", name: "Claude", icon: null, scopes: ["profile:read"], connected_at: "2026-11-18T00:00:00.000Z", last_used_at: null }];
    grants.listConnectedApps.mockResolvedValue(apps);
    const response = await GET(authed("GET", `?sub=${OTHER}&user_id=${OTHER}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ apps });
    expect(grants.listConnectedApps).toHaveBeenCalledWith({ fake: "pool" }, SUB);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("erreur de base : 500 générique, détail dans les logs seulement", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    grants.listConnectedApps.mockRejectedValue(new Error("password authentication failed for user x"));
    const response = await GET(authed("GET"));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("password");
    expect(logged).toHaveBeenCalled();
  });
});

describe("DELETE /api/connected-apps", () => {
  it("révoque le couple (appelant, client_id) : 200 {revoked:true}", async () => {
    grants.revokeConnectedApp.mockResolvedValue("revoked");
    const clientId = "https://claude.ai/oauth/claude-code-client-metadata";
    const response = await DELETE(authed("DELETE", `?client_id=${encodeURIComponent(clientId)}&sub=${OTHER}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revoked: true });
    expect(grants.revokeConnectedApp).toHaveBeenCalledWith({ fake: "pool" }, SUB, clientId);
  });

  it("404 quand le couple n'existe pas pour l'appelant (même client_id chez un autre)", async () => {
    grants.revokeConnectedApp.mockResolvedValue("not_found");
    const response = await DELETE(authed("DELETE", "?client_id=client-de-bob"));
    expect(response.status).toBe(404);
    expect(await response.json()).toHaveProperty("error");
  });

  it.each(["", "?client_id=", `?client_id=${"x".repeat(2049)}`])("400 si client_id est absent ou invalide (%#)", async (query) => {
    const response = await DELETE(authed("DELETE", query));
    expect(response.status).toBe(400);
    expect(grants.revokeConnectedApp).not.toHaveBeenCalled();
  });

  it("erreur pendant la transaction : 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    grants.revokeConnectedApp.mockRejectedValue(new Error("panne"));
    const response = await DELETE(authed("DELETE", "?client_id=a"));
    expect(response.status).toBe(500);
  });
});

describe("CORS", () => {
  it("origine autorisée : en-têtes CORS sans credentials", async () => {
    grants.listConnectedApps.mockResolvedValue([]);
    const response = await GET(authed("GET", "", "https://toolzy.io"));
    expect(response.headers.get("access-control-allow-origin")).toBe("https://toolzy.io");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("origine refusée : aucun Access-Control-Allow-Origin", async () => {
    grants.listConnectedApps.mockResolvedValue([]);
    const response = await GET(authed("GET", "", "https://evil.example"));
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("préflight d'une origine autorisée : 204 avec méthodes et en-tête Authorization", async () => {
    const response = await OPTIONS(request("OPTIONS", "", { Origin: "https://www.toolzy.io", "Access-Control-Request-Method": "DELETE" }));
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://www.toolzy.io");
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, DELETE, OPTIONS");
    expect(response.headers.get("access-control-allow-headers")).toBe("Authorization");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("préflight d'une origine refusée : pas d'en-tête d'autorisation", async () => {
    const response = await OPTIONS(request("OPTIONS", "", { Origin: "https://evil.example" }));
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("MCP_DASHBOARD_ORIGINS remplace la liste par défaut", async () => {
    vi.stubEnv("MCP_DASHBOARD_ORIGINS", "https://preprod.toolzy.io");
    const allowed = await OPTIONS(request("OPTIONS", "", { Origin: "https://preprod.toolzy.io" }));
    const prod = await OPTIONS(request("OPTIONS", "", { Origin: "https://www.toolzy.io" }));
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://preprod.toolzy.io");
    expect(prod.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("les réponses 401 portent aussi les en-têtes CORS (lisibles par la page)", async () => {
    const response = await GET(request("GET", "", { Origin: "https://www.toolzy.io" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://www.toolzy.io");
  });
});
