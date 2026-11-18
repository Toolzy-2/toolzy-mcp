import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";

vi.mock("@/lib/db/pool", () => ({ getPool: vi.fn() }));

import { checkGrant, listConnectedApps, revokeConnectedApp } from "../grants";

/**
 * Tests contre un vrai Postgres (base locale de l'AS). Activés seulement si
 * MCP_AUTH_TEST_DATABASE_URL est définie, par exemple :
 * MCP_AUTH_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres npx vitest run
 *
 * Les tables sont copiées (structure seule) dans un schéma jetable, supprimé à la fin :
 * les données réelles de mcp_auth ne sont ni lues ni modifiées.
 */
const BASE_URL = process.env.MCP_AUTH_TEST_DATABASE_URL;
const TABLES = ["mcp_audit_log", "user", "session", "account", "oauthClient", "oauthConsent", "oauthRefreshToken", "oauthAccessToken"];
const SCHEMA = `mcp_auth_test_${randomBytes(4).toString("hex")}`;

const ALICE = { id: "u-alice", sub: "11111111-1111-4111-8111-111111111111" };
const BOB = { id: "u-bob", sub: "22222222-2222-4222-8222-222222222222" };
const CLAUDE = "https://claude.ai/oauth/claude-code-client-metadata";
const GPT = "https://chatgpt.com/oauth/client";
const OFF = "client-desactive";

describe.skipIf(!BASE_URL)("grants contre Postgres", () => {
  let admin: Pool;
  let db: Pool;

  const q = (text: string, values: unknown[] = []) => db.query(text, values);

  const seedUser = async (user: { id: string; sub: string }) => {
    await q(`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, $1, $1 || '@t.test', true, now(), now())`, [user.id]);
    await q(
      `INSERT INTO account (id, "accountId", "providerId", "userId", "accessToken", "refreshToken", "updatedAt") VALUES ($1, $2, 'supabase', $3, 'at', 'rt', now())`,
      [`acc-${user.id}`, user.sub, user.id],
    );
    await q(`INSERT INTO session (id, token, "expiresAt", "userId", "updatedAt") VALUES ($1, $1, now() + interval '1 day', $2, now())`, [`ses-${user.id}`, user.id]);
  };

  const seedGrant = async (userId: string, clientId: string, usedAt: string) => {
    const key = `${userId}-${clientId}`;
    await q(`INSERT INTO "oauthConsent" (id, "clientId", "userId", scopes, "createdAt", "updatedAt") VALUES ($1, $2, $3, '["profile:read"]', '2026-11-01T10:00:00Z', now())`, [`c-${key}`, clientId, userId]);
    await q(`INSERT INTO "oauthRefreshToken" (id, token, "clientId", "userId", "expiresAt", "createdAt", scopes) VALUES ($1, $1, $2, $3, now() + interval '30 days', $4::timestamptz - interval '1 day', '[]')`, [`r-${key}`, clientId, userId, usedAt]);
    // Dernière utilisation = dernier appel d'outil journalisé (plus récent que la rotation du refresh token).
    await q(`INSERT INTO mcp_audit_log (user_id, client_id, tool, status, duration_ms, created_at) VALUES ($1, $2, 'whoami', 'ok', 10, $3)`, [userId, clientId, usedAt]);
    await q(`INSERT INTO "oauthAccessToken" (id, token, "clientId", "userId", "expiresAt", "createdAt", scopes) VALUES ($1, $1, $2, $3, now() + interval '5 minutes', $4, '[]')`, [`a-${key}`, clientId, userId, usedAt]);
  };

  const revokedCount = async (table: string, userId: string, clientId: string) =>
    (await q(`SELECT count(*)::int AS n FROM "${table}" WHERE "userId" = $1 AND "clientId" = $2 AND revoked IS NOT NULL`, [userId, clientId])).rows[0].n;

  const upstreamTokens = async (userId: string) =>
    (await q(`SELECT "accessToken", "refreshToken" FROM account WHERE "userId" = $1`, [userId])).rows[0];

  beforeAll(async () => {
    admin = new Pool({ connectionString: BASE_URL, max: 1 });
    await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
    for (const table of TABLES) {
      await admin.query(`CREATE TABLE "${SCHEMA}"."${table}" (LIKE mcp_auth."${table}" INCLUDING ALL)`);
    }
    db = new Pool({ connectionString: BASE_URL, max: 3, options: `-c search_path=${SCHEMA}` });
    await q(`INSERT INTO "oauthClient" (id, "clientId", name, icon, "redirectUris", disabled) VALUES
      ('k1', $1, 'Claude Code', 'https://claude.ai/icon.png', '[]', false),
      ('k2', $2, NULL, NULL, '[]', false),
      ('k3', $3, 'Désactivé', NULL, '[]', true)`, [CLAUDE, GPT, OFF]);
    await seedUser(ALICE);
    await seedUser(BOB);
    await seedGrant(ALICE.id, CLAUDE, "2026-11-18T12:00:00Z");
    await seedGrant(ALICE.id, GPT, "2026-11-17T12:00:00Z");
    await seedGrant(BOB.id, CLAUDE, "2026-11-16T12:00:00Z");
    await seedGrant(BOB.id, OFF, "2026-11-16T12:00:00Z");
  });

  afterAll(async () => {
    await db?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await admin?.end();
  });

  it("liste uniquement les applications de l'utilisateur appelant", async () => {
    const apps = await listConnectedApps(db, ALICE.sub);
    expect(apps.map((a) => a.client_id).sort()).toEqual([CLAUDE, GPT].sort());
    const claude = apps.find((a) => a.client_id === CLAUDE);
    expect(claude).toMatchObject({ name: "Claude Code", icon: "https://claude.ai/icon.png", scopes: ["profile:read"] });
    expect(claude?.connected_at).toBe("2026-11-01T10:00:00.000Z");
    expect(claude?.last_used_at).toBe("2026-11-18T12:00:00.000Z");
    expect(apps.find((a) => a.client_id === GPT)?.name).toBe("chatgpt.com");
  });

  it("liste vide pour un sub sans compte lié", async () => {
    expect(await listConnectedApps(db, "33333333-3333-4333-8333-333333333333")).toEqual([]);
  });

  it("refuse (404) de révoquer un couple qui n'appartient pas à l'appelant", async () => {
    expect(await revokeConnectedApp(db, ALICE.sub, OFF)).toBe("not_found");
    expect(await checkGrant(db, BOB.id, OFF)).toBe("client_disabled");
    expect(await revokedCount("oauthRefreshToken", BOB.id, OFF)).toBe(0);
  });

  it("révoque le couple de l'appelant sans toucher au même client chez un autre utilisateur", async () => {
    expect(await checkGrant(db, ALICE.id, CLAUDE)).toBe("active");
    expect(await revokeConnectedApp(db, ALICE.sub, CLAUDE)).toBe("revoked");

    expect(await checkGrant(db, ALICE.id, CLAUDE)).toBe("no_consent");
    expect(await revokedCount("oauthRefreshToken", ALICE.id, CLAUDE)).toBe(1);
    expect(await revokedCount("oauthAccessToken", ALICE.id, CLAUDE)).toBe(1);

    expect(await checkGrant(db, BOB.id, CLAUDE)).toBe("active");
    expect(await revokedCount("oauthRefreshToken", BOB.id, CLAUDE)).toBe(0);
    expect(await revokedCount("oauthAccessToken", BOB.id, CLAUDE)).toBe(0);
    expect((await listConnectedApps(db, BOB.sub)).map((a) => a.client_id).sort()).toEqual([CLAUDE, OFF].sort());

    // Alice a encore ChatGPT : le jeton Supabase est conservé.
    expect(await upstreamTokens(ALICE.id)).toEqual({ accessToken: "at", refreshToken: "rt" });
    expect(await revokeConnectedApp(db, ALICE.sub, CLAUDE)).toBe("not_found");
  });

  it("purge le jeton Supabase et les sessions de l'AS au dernier consentement révoqué", async () => {
    expect(await revokeConnectedApp(db, ALICE.sub, GPT)).toBe("revoked");
    expect(await listConnectedApps(db, ALICE.sub)).toEqual([]);
    expect(await upstreamTokens(ALICE.id)).toEqual({ accessToken: null, refreshToken: null });
    expect((await q(`SELECT count(*)::int AS n FROM session WHERE "userId" = $1`, [ALICE.id])).rows[0].n).toBe(0);

    // Bob n'est pas touché.
    expect(await upstreamTokens(BOB.id)).toEqual({ accessToken: "at", refreshToken: "rt" });
    expect((await q(`SELECT count(*)::int AS n FROM session WHERE "userId" = $1`, [BOB.id])).rows[0].n).toBe(1);
  });
});
