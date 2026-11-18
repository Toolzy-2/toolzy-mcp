import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticateSupabaseCaller, bearerFromHeader } from "../supabaseCaller";

const CONFIG = { supabaseUrl: "https://sb.test", anonKey: "anon-key" };
const SUB = "6594d54c-1a16-42c2-9892-c2bc6aff4eb0";

const jwtWith = (payload: Record<string, unknown>) =>
  `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;

const stubFetch = (status: number, body: unknown) => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bearerFromHeader", () => {
  it("extrait le jeton d'un en-tête Bearer", () => {
    expect(bearerFromHeader("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(bearerFromHeader("bearer abc")).toBe("abc");
  });

  it("refuse un en-tête absent, vide ou d'un autre schéma", () => {
    expect(bearerFromHeader(null)).toBeNull();
    expect(bearerFromHeader("")).toBeNull();
    expect(bearerFromHeader("Bearer ")).toBeNull();
    expect(bearerFromHeader("Basic dXNlcjpwYXNz")).toBeNull();
    expect(bearerFromHeader("Bearer a b")).toBeNull();
  });
});

describe("authenticateSupabaseCaller", () => {
  it("renvoie le sub quand Supabase valide le jeton", async () => {
    const fetchMock = stubFetch(200, { id: SUB, email: "a@b.c" });
    const result = await authenticateSupabaseCaller(`Bearer ${jwtWith({ sub: SUB })}`, CONFIG);
    expect(result).toEqual({ ok: true, sub: SUB });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sb.test/auth/v1/user");
    const headers = new Headers(init.headers);
    expect(headers.get("apikey")).toBe("anon-key");
    expect(headers.get("authorization")).toBe(`Bearer ${jwtWith({ sub: SUB })}`);
  });

  it("refuse sans appeler Supabase quand l'en-tête manque", async () => {
    const fetchMock = stubFetch(200, { id: SUB });
    expect(await authenticateSupabaseCaller(null, CONFIG)).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuse un jeton émis à un client OAuth tiers (claim client_id)", async () => {
    const fetchMock = stubFetch(200, { id: SUB });
    const token = jwtWith({ sub: SUB, client_id: "toolzy-mcp" });
    expect(await authenticateSupabaseCaller(`Bearer ${token}`, CONFIG)).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuse quand Supabase rejette le jeton", async () => {
    stubFetch(401, { msg: "invalid JWT" });
    expect(await authenticateSupabaseCaller(`Bearer ${jwtWith({ sub: SUB })}`, CONFIG)).toEqual({ ok: false });
  });

  it("refuse une réponse sans identifiant UUID", async () => {
    stubFetch(200, { id: "pas-un-uuid" });
    expect(await authenticateSupabaseCaller(`Bearer ${jwtWith({ sub: SUB })}`, CONFIG)).toEqual({ ok: false });
  });

  it("refuse (sans lever) quand Supabase est injoignable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("réseau"))));
    expect(await authenticateSupabaseCaller(`Bearer ${jwtWith({ sub: SUB })}`, CONFIG)).toEqual({ ok: false });
  });
});
