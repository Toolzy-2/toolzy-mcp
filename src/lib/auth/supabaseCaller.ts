/**
 * Authentifie un appel venant d'une page de toolzy.io par le jeton d'accès
 * Supabase de l'utilisateur connecté (en-tête Authorization, jamais de cookie).
 * Le jeton est validé par Supabase lui-même (GET /auth/v1/user).
 */
export interface SupabaseCallerConfig {
  readonly supabaseUrl: string;
  readonly anonKey: string;
}

export type CallerResult = { readonly ok: true; readonly sub: string } | { readonly ok: false };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMEOUT_MS = 5000;
const REFUSED: CallerResult = Object.freeze({ ok: false });

/** Jeton d'un en-tête `Bearer <jeton>`, ou null si l'en-tête est absent ou mal formé. */
export function bearerFromHeader(header: string | null): string | null {
  if (!header) return null;
  const parts = header.trim().split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer" || parts[1] === "") return null;
  return parts[1];
}

/**
 * Un jeton émis par Supabase OAuth Server à une application tierce porte un
 * `client_id`. Il ne doit pas permettre de gérer les applications connectées :
 * seule une vraie session toolzy.io le peut. Le contenu n'est que lu ici, la
 * signature est vérifiée ensuite par Supabase.
 */
function isThirdPartyToken(token: string): boolean {
  const payload = token.split(".")[1];
  if (!payload) return false;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof claims === "object" && claims !== null && "client_id" in claims;
  } catch {
    return false;
  }
}

export async function authenticateSupabaseCaller(
  authorization: string | null,
  config: SupabaseCallerConfig,
): Promise<CallerResult> {
  const token = bearerFromHeader(authorization);
  if (!token || isThirdPartyToken(token)) return REFUSED;

  let response: Response;
  try {
    response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: config.anonKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.error("[supabaseCaller] Supabase injoignable", error instanceof Error ? error.message : error);
    return REFUSED;
  }
  if (!response.ok) return REFUSED;

  const body: unknown = await response.json().catch(() => null);
  const id = (body as { id?: unknown } | null)?.id;
  return typeof id === "string" && UUID.test(id) ? { ok: true, sub: id } : REFUSED;
}
