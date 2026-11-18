import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

const upstream = vi.hoisted(() => ({
  getUpstreamAccessToken: vi.fn(),
  getUpstreamUser: vi.fn(),
  createSupabaseForToken: vi.fn(),
}));
const grants = vi.hoisted(() => ({ checkGrant: vi.fn(), getGrantsDb: vi.fn(() => ({ fake: "pool" })) }));

vi.mock("../upstream", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../upstream")>()),
  ...upstream,
}));
vi.mock("../grants", () => grants);
vi.mock("@/lib/db/pool", () => ({ getPool: vi.fn() }));

import { ConsentRevokedError, openUserSession } from "../userSession";
import { UpstreamSessionError } from "../upstream";

const SUB = "6594d54c-1a16-42c2-9892-c2bc6aff4eb0";
const authInfo = (overrides: Partial<AuthInfo> = {}): AuthInfo => ({
  token: "jwt",
  clientId: "https://claude.ai/oauth/claude-code-client-metadata",
  scopes: ["profile:read"],
  extra: { userId: "ba-user-1", issuedAt: 1763546400 },
  ...overrides,
});

const fakeDb = () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: { prenom: "Alice", role: "Owner", is_blocked: false, is_super_loueur: false }, error: null }),
  };
  return { from: vi.fn(() => chain) };
};

afterEach(() => vi.clearAllMocks());

describe("openUserSession : contrôle du consentement à chaque appel", () => {
  it("refuse après révocation, avant toute lecture du jeton amont ou des données", async () => {
    grants.checkGrant.mockResolvedValue("no_consent");
    const error = await openUserSession(authInfo()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConsentRevokedError);
    expect((error as ConsentRevokedError).reason).toBe("no_consent");
    // Traduit par l'appelant comme une session à rouvrir.
    expect(error).toBeInstanceOf(UpstreamSessionError);
    // L'heure d'émission du jeton est transmise : un jeton antérieur au consentement actuel est refusé.
    expect(grants.checkGrant).toHaveBeenCalledWith({ fake: "pool" }, "ba-user-1", authInfo().clientId, 1763546400);
    expect(upstream.getUpstreamAccessToken).not.toHaveBeenCalled();
    expect(upstream.createSupabaseForToken).not.toHaveBeenCalled();
  });

  it("refuse un client désactivé", async () => {
    grants.checkGrant.mockResolvedValue("client_disabled");
    const error = await openUserSession(authInfo()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConsentRevokedError);
    expect((error as ConsentRevokedError).reason).toBe("client_disabled");
    expect(upstream.getUpstreamAccessToken).not.toHaveBeenCalled();
  });

  it("refuse un jeton sans client identifié", async () => {
    await expect(openUserSession(authInfo({ clientId: "" }))).rejects.toThrow();
    expect(grants.checkGrant).not.toHaveBeenCalled();
    expect(upstream.getUpstreamAccessToken).not.toHaveBeenCalled();
  });

  it("ouvre la session quand le consentement est actif", async () => {
    grants.checkGrant.mockResolvedValue("active");
    upstream.getUpstreamAccessToken.mockResolvedValue("supabase-token");
    upstream.getUpstreamUser.mockResolvedValue({ id: SUB, email: "a@t.test" });
    upstream.createSupabaseForToken.mockReturnValue(fakeDb());
    const session = await openUserSession(authInfo());
    expect(session.userId).toBe(SUB);
    expect(session.profile.prenom).toBe("Alice");
  });

  it("propage une panne de la base de l'AS (jamais d'accès par défaut)", async () => {
    grants.checkGrant.mockRejectedValue(new Error("connexion refusée"));
    await expect(openUserSession(authInfo())).rejects.toThrow("connexion refusée");
    expect(upstream.getUpstreamAccessToken).not.toHaveBeenCalled();
  });
});
