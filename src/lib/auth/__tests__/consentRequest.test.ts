import { describe, expect, it, vi } from "vitest";
import { describeApp, readConsentRequest, SCOPE_LABELS } from "../consentRequest";

const query = (params: Record<string, string>) => new URLSearchParams(params).toString();

const SIGNED = query({
  client_id: "https://claude.ai/oauth/claude-code-client-metadata",
  redirect_uri: "http://localhost:51234/callback",
  scope: "offline_access profile:read reservations:read inconnu",
  exp: "9999999999",
  sig: "signature",
});

describe("readConsentRequest", () => {
  it("refuse une demande dont la signature ne correspond pas", async () => {
    const verify = vi.fn().mockResolvedValue(false);

    expect(await readConsentRequest(SIGNED, verify)).toEqual({ ok: false });
    expect(verify).toHaveBeenCalledWith(SIGNED);
  });

  it("refuse une demande sans signature sans même la vérifier", async () => {
    const verify = vi.fn().mockResolvedValue(true);

    expect(await readConsentRequest(query({ client_id: "x", scope: "profile:read" }), verify)).toEqual({ ok: false });
    expect(verify).not.toHaveBeenCalled();
  });

  it("ne garde que les scopes Toolzy connus d'une demande signée", async () => {
    const result = await readConsentRequest(SIGNED, async () => true);

    expect(result).toEqual({
      ok: true,
      clientId: "https://claude.ai/oauth/claude-code-client-metadata",
      redirectHost: "localhost",
      scopes: ["profile:read", "reservations:read"],
    });
  });

  it("accepte la chaîne avec ou sans point d'interrogation initial", async () => {
    const result = await readConsentRequest(`?${SIGNED}`, async () => true);

    expect(result.ok).toBe(true);
  });

  it("refuse une demande signée sans client ou sans URI de retour valide", async () => {
    const sansClient = query({ redirect_uri: "http://localhost/cb", scope: "profile:read", sig: "s" });
    const retourInvalide = query({ client_id: "c", redirect_uri: "pas une url", scope: "profile:read", sig: "s" });

    expect(await readConsentRequest(sansClient, async () => true)).toEqual({ ok: false });
    expect(await readConsentRequest(retourInvalide, async () => true)).toEqual({ ok: false });
  });
});

describe("describeApp", () => {
  it("préfère le nom déclaré par le client", () => {
    expect(describeApp("https://claude.ai/oauth/x", "Claude Code")).toBe("Claude Code");
  });

  it("retombe sur l'hôte de l'identifiant CIMD", () => {
    expect(describeApp("https://claude.ai/oauth/x", undefined)).toBe("claude.ai");
  });

  it("reste générique pour un identifiant opaque", () => {
    expect(describeApp("abc123", "  ")).toBe("Une application");
  });
});

describe("describeRedirect", () => {
  it("ne montre jamais une adresse locale : l'application tourne sur cet ordinateur", async () => {
    const { describeRedirect } = await import("../consentRequest");
    for (const host of ["localhost", "127.0.0.1", "[::1]", "::1"]) {
      expect(describeRedirect(host, "Claude Code")).toBe("Vous serez ensuite renvoyé vers Claude Code sur cet ordinateur.");
    }
  });

  it("montre le domaine de retour d'une application en ligne (protection contre l'hameçonnage)", async () => {
    const { describeRedirect } = await import("../consentRequest");
    expect(describeRedirect("claude.ai", "Claude")).toBe("Vous serez ensuite renvoyé vers claude.ai.");
  });
});

describe("SCOPE_LABELS", () => {
  it("décrit chaque scope Toolzy", async () => {
    const { TOOLZY_SCOPES } = await import("../env");
    expect(Object.keys(SCOPE_LABELS).sort()).toEqual([...TOOLZY_SCOPES].sort());
  });
});
