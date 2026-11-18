import { MAX_CLIENT_ID_LENGTH } from "@/lib/auth/clientAllowlist";
import { getAuthEnv, getDashboardOrigins } from "@/lib/auth/env";
import { corsHeadersFor } from "@/lib/auth/dashboardCors";
import { getGrantsDb, listConnectedApps, revokeConnectedApp } from "@/lib/auth/grants";
import { authenticateSupabaseCaller } from "@/lib/auth/supabaseCaller";

// pg a besoin du runtime Node.js ; réponse propre à chaque utilisateur, jamais en cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Applications connectées de l'utilisateur, appelée par une page de toolzy.io.
 *
 * - GET    : liste des clients MCP autorisés par l'utilisateur.
 * - DELETE : ?client_id=<id>, révoque l'accès de ce client pour cet utilisateur.
 *
 * L'utilisateur est identifié uniquement par son jeton d'accès Supabase
 * (Authorization: Bearer), validé par Supabase. Aucun cookie, aucun
 * identifiant lu dans la requête.
 */

const json = (request: Request, status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeadersFor(request.headers.get("origin"), getDashboardOrigins()),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

const unauthorized = (request: Request) => json(request, 401, { error: "Connexion requise" });

const serverError = (request: Request, action: string, error: unknown) => {
  console.error(`[connected-apps] ${action} en échec`, error instanceof Error ? error.message : error);
  return json(request, 500, { error: "Erreur serveur, réessayez plus tard" });
};

/**
 * Identité de l'appelant. Une configuration manquante devient une 500 propre
 * (en-têtes CORS compris) au lieu d'une exception nue.
 */
async function identify(request: Request): Promise<{ sub: string | null } | { failure: Response }> {
  try {
    return { sub: await callerSub(request) };
  } catch (error) {
    return { failure: serverError(request, "authentification", error) };
  }
}

async function callerSub(request: Request): Promise<string | null> {
  const env = getAuthEnv();
  const result = await authenticateSupabaseCaller(request.headers.get("authorization"), {
    supabaseUrl: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
  });
  return result.ok ? result.sub : null;
}

export async function OPTIONS(request: Request): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeadersFor(request.headers.get("origin"), getDashboardOrigins()),
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  const caller = await identify(request);
  if ("failure" in caller) return caller.failure;
  const { sub } = caller;
  if (!sub) return unauthorized(request);
  try {
    const apps = await listConnectedApps(getGrantsDb(), sub);
    return json(request, 200, { apps });
  } catch (error) {
    return serverError(request, "liste", error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const caller = await identify(request);
  if ("failure" in caller) return caller.failure;
  const { sub } = caller;
  if (!sub) return unauthorized(request);

  const clientId = new URL(request.url).searchParams.get("client_id")?.trim() ?? "";
  if (clientId === "" || clientId.length > MAX_CLIENT_ID_LENGTH) {
    return json(request, 400, { error: "Paramètre client_id manquant ou invalide" });
  }
  try {
    const result = await revokeConnectedApp(getGrantsDb(), sub, clientId);
    return result === "revoked"
      ? json(request, 200, { revoked: true })
      : json(request, 404, { error: "Application introuvable" });
  } catch (error) {
    return serverError(request, "révocation", error);
  }
}
