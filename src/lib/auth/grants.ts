import type { Pool, PoolClient } from "pg";
import { getPool } from "@/lib/db/pool";
import { UPSTREAM_PROVIDER_ID } from "./env";

/**
 * Autorisations accordées par un utilisateur aux clients MCP (tables Better
 * Auth du schéma mcp_auth) : liste, révocation, contrôle à chaque appel.
 *
 * RÈGLE : toute requête filtre explicitement sur l'utilisateur concerné, et
 * toutes sont paramétrées. L'utilisateur est retrouvé par son `sub` Supabase
 * via la ligne `account` du fournisseur amont.
 */
export interface ConnectedApp {
  readonly client_id: string;
  readonly name: string;
  readonly icon: string | null;
  readonly scopes: readonly string[];
  readonly connected_at: string;
  readonly last_used_at: string | null;
}

export type RevokeResult = "revoked" | "not_found";
export type GrantState = "active" | "no_consent" | "client_disabled" | "issued_before_consent";

const MAX_NAME_LENGTH = 100;

/** Connexion d'infrastructure de l'AS (jamais au nom d'un utilisateur Supabase). */
export function getGrantsDb(): Pool {
  return getPool();
}

/** Nom affiché : celui du client, sinon l'hôte de son document CIMD, sinon son identifiant. */
export function displayNameOf(clientId: string, name: string | null): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed.slice(0, MAX_NAME_LENGTH);
  try {
    const url = new URL(clientId);
    if (url.protocol === "https:") return url.hostname;
  } catch {
    // Identifiant opaque (client pré-enregistré) : affiché tel quel.
  }
  return clientId.slice(0, MAX_NAME_LENGTH);
}

/** L'icône vient d'un document tiers : seule une URL HTTPS est transmise à la page. */
export function safeIcon(icon: string | null): string | null {
  if (!icon) return null;
  try {
    return new URL(icon).protocol === "https:" ? icon : null;
  } catch {
    return null;
  }
}

const toIso = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : typeof value === "string" ? new Date(value).toISOString() : null;

const scopesOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((scope): scope is string => typeof scope === "string") : [];

interface AppRow {
  client_id: string;
  name: string | null;
  icon: string | null;
  scopes: unknown;
  connected_at: unknown;
  last_used_at: unknown;
}

const LIST_SQL = `
  SELECT c."clientId" AS client_id, k.name, k.icon, c.scopes, c."createdAt" AS connected_at,
    -- Dernier appel d'outil journalisé, sinon dernière rotation de refresh token
    -- (les jetons d'accès JWT ne sont pas stockés). GREATEST ignore les NULL.
    GREATEST(
      (SELECT max(l.created_at) FROM mcp_audit_log l
        WHERE l.user_id = c."userId" AND l.client_id = c."clientId"),
      (SELECT max(r."createdAt") FROM "oauthRefreshToken" r
        WHERE r."userId" = c."userId" AND r."clientId" = c."clientId")
    ) AS last_used_at
  FROM "oauthConsent" c
  JOIN account a ON a."userId" = c."userId"
  LEFT JOIN "oauthClient" k ON k."clientId" = c."clientId"
  WHERE a."providerId" = '${UPSTREAM_PROVIDER_ID}' AND a."accountId" = $1
  ORDER BY c."createdAt" DESC`;

export async function listConnectedApps(db: Pool, sub: string): Promise<ConnectedApp[]> {
  const { rows } = await db.query<AppRow>(LIST_SQL, [sub]);
  return rows.map((row) => ({
    client_id: row.client_id,
    name: displayNameOf(row.client_id, row.name),
    icon: safeIcon(row.icon),
    scopes: scopesOf(row.scopes),
    connected_at: toIso(row.connected_at) ?? new Date(0).toISOString(),
    last_used_at: toIso(row.last_used_at),
  }));
}

/**
 * Verrouille la ligne `account` : deux révocations simultanées du même
 * utilisateur sont sérialisées, sinon chacune pourrait voir le consentement
 * de l'autre encore présent et aucune ne purgerait le jeton amont.
 */
async function lockUserIdForSub(client: PoolClient, sub: string): Promise<string | null> {
  const { rows } = await client.query<{ userId: string }>(
    `SELECT a."userId" FROM account a
     WHERE a."providerId" = '${UPSTREAM_PROVIDER_ID}' AND a."accountId" = $1
     LIMIT 1 FOR UPDATE`,
    [sub],
  );
  return rows[0]?.userId ?? null;
}

/** Plus aucun consentement : le serveur ne doit plus pouvoir agir au nom de l'utilisateur. */
async function purgeUpstreamIfNoConsent(client: PoolClient, userId: string): Promise<void> {
  const remaining = await client.query(`SELECT 1 FROM "oauthConsent" WHERE "userId" = $1 LIMIT 1`, [userId]);
  if ((remaining.rowCount ?? 0) > 0) return;
  await client.query(
    `UPDATE account SET "accessToken" = NULL, "refreshToken" = NULL, "idToken" = NULL,
       "accessTokenExpiresAt" = NULL, "refreshTokenExpiresAt" = NULL, "updatedAt" = now()
     WHERE "userId" = $1 AND "providerId" = '${UPSTREAM_PROVIDER_ID}'`,
    [userId],
  );
  // Sans session AS, la prochaine autorisation repasse par Supabase et relie un jeton neuf.
  await client.query(`DELETE FROM session WHERE "userId" = $1`, [userId]);
}

async function revokeWithin(client: PoolClient, sub: string, clientId: string): Promise<RevokeResult> {
  const userId = await lockUserIdForSub(client, sub);
  if (!userId) return "not_found";
  const pair = [userId, clientId];
  const deleted = await client.query(`DELETE FROM "oauthConsent" WHERE "userId" = $1 AND "clientId" = $2`, pair);
  if ((deleted.rowCount ?? 0) === 0) return "not_found";
  await client.query(
    `UPDATE "oauthRefreshToken" SET revoked = now() WHERE "userId" = $1 AND "clientId" = $2 AND revoked IS NULL`,
    pair,
  );
  await client.query(
    `UPDATE "oauthAccessToken" SET revoked = now() WHERE "userId" = $1 AND "clientId" = $2 AND revoked IS NULL`,
    pair,
  );
  await purgeUpstreamIfNoConsent(client, userId);
  return "revoked";
}

/** Révoque l'accès d'un client pour l'utilisateur `sub`, en une seule transaction. */
export async function revokeConnectedApp(db: Pool, sub: string, clientId: string): Promise<RevokeResult> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await revokeWithin(client, sub, clientId);
    await client.query(result === "revoked" ? "COMMIT" : "ROLLBACK");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch((rollbackError: unknown) => {
      console.error("[grants] ROLLBACK impossible", rollbackError instanceof Error ? rollbackError.message : rollbackError);
    });
    throw error;
  } finally {
    client.release();
  }
}

/** État de l'autorisation (utilisateur Better Auth, client) au moment d'un appel d'outil. */
export async function checkGrant(
  db: Pool,
  userId: string,
  clientId: string,
  issuedAtSeconds?: number,
): Promise<GrantState> {
  const { rows } = await db.query<{ disabled: boolean | null; created_at: Date | string | null }>(
    `SELECT k.disabled, c."createdAt" AS created_at FROM "oauthConsent" c
     LEFT JOIN "oauthClient" k ON k."clientId" = c."clientId"
     WHERE c."userId" = $1 AND c."clientId" = $2`,
    [userId, clientId],
  );
  if (rows.length === 0) return "no_consent";
  if (rows.some((row) => row.disabled === true)) return "client_disabled";
  // Un jeton émis avant le consentement actuel date d'un accès révoqué depuis
  // (révoquer supprime le consentement, reconnecter en crée un nouveau). L'iat
  // est en secondes entières : on compare à la seconde près.
  if (issuedAtSeconds !== undefined) {
    const consentSeconds = Math.min(
      ...rows.map((row) => (row.created_at ? Math.floor(new Date(row.created_at).getTime() / 1000) : 0)),
    );
    if (issuedAtSeconds < consentSeconds) return "issued_before_consent";
  }
  return "active";
}
