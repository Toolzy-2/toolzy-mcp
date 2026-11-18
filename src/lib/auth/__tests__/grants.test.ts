import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

vi.mock("@/lib/db/pool", () => ({ getPool: vi.fn() }));

import { checkGrant, displayNameOf, listConnectedApps, revokeConnectedApp, safeIcon } from "../grants";

const SUB = "6594d54c-1a16-42c2-9892-c2bc6aff4eb0";

type Reply = { rows?: unknown[]; rowCount?: number } | Error;

/** Faux pool : enregistre chaque requête et répond selon la première règle qui correspond. */
const fakePool = (rules: ReadonlyArray<[RegExp, Reply]>) => {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const release = vi.fn();
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    calls.push({ text, values });
    const rule = rules.find(([pattern]) => pattern.test(text));
    const reply = rule?.[1] ?? {};
    if (reply instanceof Error) throw reply;
    return { rows: reply.rows ?? [], rowCount: reply.rowCount ?? reply.rows?.length ?? 0 };
  });
  const pool = { query, connect: vi.fn(async () => ({ query, release })) } as unknown as Pool;
  return { pool, calls, release };
};

const statements = (calls: ReadonlyArray<{ text: string }>) => calls.map((c) => c.text.trim().split(/\s+/).slice(0, 3).join(" "));

describe("displayNameOf / safeIcon", () => {
  it("prend le nom du client, sinon l'hôte du document CIMD, sinon l'identifiant", () => {
    expect(displayNameOf("abc", "  Claude Code ")).toBe("Claude Code");
    expect(displayNameOf("https://claude.ai/oauth/claude-code-client-metadata", null)).toBe("claude.ai");
    expect(displayNameOf("abc", "")).toBe("abc");
    expect(displayNameOf("x".repeat(300), null)).toHaveLength(100);
  });

  it("n'accepte qu'une icône en HTTPS", () => {
    expect(safeIcon("https://claude.ai/logo.png")).toBe("https://claude.ai/logo.png");
    expect(safeIcon("http://claude.ai/logo.png")).toBeNull();
    expect(safeIcon("javascript:alert(1)")).toBeNull();
    expect(safeIcon("data:image/svg+xml,<svg/>")).toBeNull();
    expect(safeIcon(null)).toBeNull();
  });
});

describe("listConnectedApps", () => {
  it("filtre explicitement sur l'utilisateur lié au sub Supabase, en requête paramétrée", async () => {
    const { pool, calls } = fakePool([
      [/FROM "oauthConsent"/, { rows: [] }],
    ]);
    expect(await listConnectedApps(pool, SUB)).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain(`a."providerId" = 'supabase'`);
    expect(calls[0].text).toContain(`a."accountId" = $1`);
    expect(calls[0].text).not.toContain(SUB);
    expect(calls[0].values).toEqual([SUB]);
  });

  it("met en forme les lignes (nom, icône, scopes, dates ISO)", async () => {
    const { pool } = fakePool([
      [
        /FROM "oauthConsent"/,
        {
          rows: [
            {
              client_id: "https://claude.ai/oauth/claude-code-client-metadata",
              name: null,
              icon: "javascript:x",
              scopes: ["profile:read", 42, "offline_access"],
              connected_at: new Date("2026-11-18T15:52:47Z"),
              last_used_at: null,
            },
          ],
        },
      ],
    ]);
    expect(await listConnectedApps(pool, SUB)).toEqual([
      {
        client_id: "https://claude.ai/oauth/claude-code-client-metadata",
        name: "claude.ai",
        icon: null,
        scopes: ["profile:read", "offline_access"],
        connected_at: "2026-11-18T15:52:47.000Z",
        last_used_at: null,
      },
    ]);
  });
});

describe("revokeConnectedApp (transaction)", () => {
  const ACCOUNT = [/FROM account/, { rows: [{ userId: "u1" }] }] as [RegExp, Reply];

  it("révoque, garde le jeton amont si d'autres consentements restent, puis COMMIT", async () => {
    const { pool, calls, release } = fakePool([
      ACCOUNT,
      [/DELETE FROM "oauthConsent"/, { rowCount: 1 }],
      [/SELECT 1 FROM "oauthConsent"/, { rows: [{ "?column?": 1 }] }],
    ]);
    expect(await revokeConnectedApp(pool, SUB, "client-a")).toBe("revoked");
    expect(statements(calls)).toEqual([
      "BEGIN",
      "SELECT a.\"userId\" FROM",
      "DELETE FROM \"oauthConsent\"",
      "UPDATE \"oauthRefreshToken\" SET",
      "UPDATE \"oauthAccessToken\" SET",
      "SELECT 1 FROM",
      "COMMIT",
    ]);
    for (const call of calls.slice(2, 5)) expect(call.values).toEqual(["u1", "client-a"]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("purge le jeton Supabase et les sessions quand plus aucun consentement ne reste", async () => {
    const { pool, calls } = fakePool([
      ACCOUNT,
      [/DELETE FROM "oauthConsent"/, { rowCount: 1 }],
      [/SELECT 1 FROM "oauthConsent"/, { rows: [] }],
    ]);
    expect(await revokeConnectedApp(pool, SUB, "client-a")).toBe("revoked");
    const purge = calls.find((c) => /UPDATE account/.test(c.text));
    expect(purge?.text).toMatch(/"accessToken" = NULL/);
    expect(purge?.text).toMatch(/"refreshToken" = NULL/);
    expect(purge?.text).toMatch(/"providerId" = 'supabase'/);
    expect(purge?.values).toEqual(["u1"]);
    expect(calls.some((c) => /DELETE FROM session/.test(c.text))).toBe(true);
    expect(statements(calls).at(-1)).toBe("COMMIT");
  });

  it("404 : aucun compte lié, ROLLBACK sans rien écrire", async () => {
    const { pool, calls, release } = fakePool([[/FROM account/, { rows: [] }]]);
    expect(await revokeConnectedApp(pool, SUB, "client-a")).toBe("not_found");
    expect(statements(calls)).toEqual(["BEGIN", "SELECT a.\"userId\" FROM", "ROLLBACK"]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("404 : couple (utilisateur, client) inexistant, ROLLBACK", async () => {
    const { pool, calls } = fakePool([ACCOUNT, [/DELETE FROM "oauthConsent"/, { rowCount: 0 }]]);
    expect(await revokeConnectedApp(pool, SUB, "client-b")).toBe("not_found");
    expect(statements(calls).at(-1)).toBe("ROLLBACK");
    expect(calls.some((c) => /^\s*UPDATE/.test(c.text))).toBe(false);
  });

  it("annule tout (ROLLBACK) et relance l'erreur si une étape échoue", async () => {
    const { pool, calls, release } = fakePool([
      ACCOUNT,
      [/DELETE FROM "oauthConsent"/, { rowCount: 1 }],
      [/UPDATE "oauthAccessToken"/, new Error("panne")],
    ]);
    await expect(revokeConnectedApp(pool, SUB, "client-a")).rejects.toThrow("panne");
    expect(statements(calls)).toContain("ROLLBACK");
    expect(statements(calls)).not.toContain("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });
});

describe("checkGrant", () => {
  it("actif quand le consentement existe et le client est disponible", async () => {
    const { pool, calls } = fakePool([[/FROM "oauthConsent"/, { rows: [{ disabled: false }] }]]);
    expect(await checkGrant(pool, "u1", "client-a")).toBe("active");
    expect(calls[0].values).toEqual(["u1", "client-a"]);
  });

  it("refuse sans consentement", async () => {
    const { pool } = fakePool([[/FROM "oauthConsent"/, { rows: [] }]]);
    expect(await checkGrant(pool, "u1", "client-a")).toBe("no_consent");
  });

  it("refuse un client désactivé", async () => {
    const { pool } = fakePool([[/FROM "oauthConsent"/, { rows: [{ disabled: true }] }]]);
    expect(await checkGrant(pool, "u1", "client-a")).toBe("client_disabled");
  });

  // Révoquer puis reconnecter crée un nouveau consentement : un jeton émis
  // avant la révocation (encore valable 300 s) ne doit pas redevenir valide.
  const consentAt = new Date("2026-11-19T10:00:00.500Z");
  const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

  it("refuse un jeton émis avant le consentement actuel", async () => {
    const { pool } = fakePool([[/FROM "oauthConsent"/, { rows: [{ disabled: false, created_at: consentAt }] }]]);
    expect(await checkGrant(pool, "u1", "client-a", at("2026-11-19T09:58:00Z"))).toBe("issued_before_consent");
  });

  it("accepte un jeton émis dans la même seconde que le consentement", async () => {
    const { pool } = fakePool([[/FROM "oauthConsent"/, { rows: [{ disabled: false, created_at: consentAt }] }]]);
    expect(await checkGrant(pool, "u1", "client-a", at("2026-11-19T10:00:00Z"))).toBe("active");
  });

  it("accepte un jeton émis après le consentement", async () => {
    const { pool } = fakePool([[/FROM "oauthConsent"/, { rows: [{ disabled: false, created_at: consentAt }] }]]);
    expect(await checkGrant(pool, "u1", "client-a", at("2026-11-19T11:00:00Z"))).toBe("active");
  });
});
