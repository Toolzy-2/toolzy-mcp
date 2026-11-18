/**
 * Variables d'environnement du serveur d'autorisation, validées au premier
 * accès. Échec explicite plutôt qu'un démarrage silencieusement mal configuré.
 */
const REQUIRED = [
  "MCP_AUTH_DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "MCP_RESOURCE_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_OAUTH_CLIENT_ID",
  "SUPABASE_OAUTH_CLIENT_SECRET",
] as const;

export type AuthEnv = Readonly<Record<(typeof REQUIRED)[number], string>>;

let cached: AuthEnv | null = null;

export function getAuthEnv(): AuthEnv {
  if (cached) return cached;
  const missing = REQUIRED.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Variables d'environnement manquantes : ${missing.join(", ")}`);
  }
  cached = Object.freeze(
    Object.fromEntries(REQUIRED.map((name) => [name, process.env[name] as string])),
  ) as AuthEnv;
  return cached;
}

/** Identifiant du fournisseur amont (Supabase OAuth Server) dans Better Auth. */
export const UPSTREAM_PROVIDER_ID = "supabase";

/** Scopes Toolzy, appliqués par le serveur MCP (Supabase n'en connaît aucun). */
export const TOOLZY_SCOPES = [
  "profile:read",
  "reservations:read",
  "reservations:write",
  "messages:read",
  "messages:write",
  "listings:read",
  "listings:write",
] as const;
