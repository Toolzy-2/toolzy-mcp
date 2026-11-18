import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getAuth } from "./auth";
import { getAuthEnv, UPSTREAM_PROVIDER_ID } from "./env";

/** L'utilisateur n'a pas (ou plus) de liaison Supabase utilisable : il doit se reconnecter. */
export class UpstreamSessionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UpstreamSessionError";
  }
}

export interface UpstreamUser {
  id: string;
  email: string | null;
}

/**
 * Jeton Supabase de l'utilisateur, détenu par le serveur et rafraîchi par lui.
 * Ne doit jamais sortir du serveur (ni réponse d'outil, ni log).
 */
export async function getUpstreamAccessToken(userId: string): Promise<string> {
  const auth = getAuth();
  const context = await auth.$context;

  const accounts = await context.internalAdapter.findAccounts(userId);
  const account = accounts.find((candidate) => candidate.providerId === UPSTREAM_PROVIDER_ID);
  if (!account) throw new UpstreamSessionError("Aucun compte Toolzy lié à cet utilisateur");

  try {
    const tokens = await auth.api.getAccessToken({ body: { accountId: account.id, userId } });
    if (!tokens.accessToken) throw new UpstreamSessionError("Session Toolzy indisponible");
    return tokens.accessToken;
  } catch (cause) {
    if (cause instanceof UpstreamSessionError) throw cause;
    throw new UpstreamSessionError("Session Toolzy expirée ou révoquée", { cause });
  }
}

/** Identité Supabase associée au jeton amont (seul endpoint d'auth ouvert aux jetons OAuth). */
export async function getUpstreamUser(accessToken: string): Promise<UpstreamUser> {
  const env = getAuthEnv();
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}`, apikey: env.SUPABASE_ANON_KEY },
  });
  if (!response.ok) {
    throw new UpstreamSessionError(`Identité Toolzy illisible (HTTP ${response.status})`);
  }
  const profile: unknown = await response.json();
  const { sub, email } = (profile ?? {}) as { sub?: unknown; email?: unknown };
  if (typeof sub !== "string") throw new UpstreamSessionError("Identité Toolzy incomplète");
  return { id: sub, email: typeof email === "string" ? email : null };
}

/**
 * Client Supabase agissant au nom de l'utilisateur.
 *
 * Le jeton utilisé est celui que Supabase a émis à NOTRE serveur lors de la
 * liaison du compte : ce n'est jamais le jeton présenté par le client MCP.
 * La RLS s'applique comme dans l'app ; aucune clé service_role ici.
 */
export function createSupabaseForToken(accessToken: string): SupabaseClient {
  const env = getAuthEnv();
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
