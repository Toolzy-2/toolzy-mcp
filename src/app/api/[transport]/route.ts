import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { createRemoteJWKSet } from "jose";
import { registerToolzyTools } from "@/lib/register";
import { registerAuthenticatedTools } from "@/lib/registerAuthenticated";
import { getAuthEnv } from "@/lib/auth/env";
import { decideAccess } from "@/lib/auth/protectedTools";
import { createTokenVerifier, InvalidTokenError } from "@/lib/auth/verifyToken";
import { getPool } from "@/lib/db/pool";
import { checkPublicCalls, clientKey, publicToolCalls, rateLimitedResponse } from "@/lib/guard/publicLimit";

// supabase-js et pg ont besoin du runtime Node.js (pas Edge).
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Endpoint MCP Streamable HTTP (stateless).
 *
 * `initialize`, `tools/list` et les outils publics restent accessibles sans
 * connexion. Un outil protégé appelé sans jeton reçoit un 401 qui pointe vers
 * les métadonnées de la ressource (RFC 9728) ; un jeton sans le bon scope
 * reçoit un 403 `insufficient_scope`.
 */
const mcpHandler = createMcpHandler(
  (server) => {
    registerToolzyTools(server);
    registerAuthenticatedTools(server);
  },
  { serverInfo: { name: "toolzy", version: "0.2.0" } },
  { basePath: "/api", maxDuration: 60, disableSse: true, verboseLogs: false },
);

const PRM_PATH = "/.well-known/oauth-protected-resource/api/mcp";

let verifier: ReturnType<typeof createTokenVerifier> | null = null;
const getVerifier = () => {
  if (!verifier) {
    const env = getAuthEnv();
    const issuer = `${env.BETTER_AUTH_URL}/api/auth`;
    verifier = createTokenVerifier({
      issuer,
      audience: env.MCP_RESOURCE_URL,
      getKey: createRemoteJWKSet(new URL(`${issuer}/jwks`)),
    });
  }
  return verifier;
};

const bearerOf = (request: Request): string | undefined => {
  const header = request.headers.get("authorization");
  if (!header) return undefined;
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : "";
};

const challenge = (status: 401 | 403, params: Record<string, string>): Response => {
  const env = getAuthEnv();
  const origin = new URL(env.MCP_RESOURCE_URL).origin;
  const all = { ...params, resource_metadata: `${origin}${PRM_PATH}` };
  const header = `Bearer ${Object.entries(all)
    .map(([key, value]) => `${key}="${value}"`)
    .join(", ")}`;
  return new Response(JSON.stringify({ error: params.error ?? "unauthorized" }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": header,
      "Access-Control-Expose-Headers": "WWW-Authenticate",
    },
  });
};

const authedHandler = withMcpAuth(
  mcpHandler,
  async (_request, bearer) => getVerifier()(bearer),
  { required: false, resourceMetadataPath: PRM_PATH },
);

async function handle(request: Request): Promise<Response> {
  const bearer = bearerOf(request);

  let grantedScopes: readonly string[] | undefined;
  if (bearer !== undefined) {
    try {
      grantedScopes = (await getVerifier()(bearer))?.scopes ?? [];
    } catch (error) {
      if (!(error instanceof InvalidTokenError)) throw error;
      return challenge(401, { error: "invalid_token" });
    }
  }

  if (request.method === "POST") {
    const body: unknown = await request
      .clone()
      .json()
      .catch(() => null);
    const decision = decideAccess(body, grantedScopes);
    if (decision.kind === "unauthenticated") {
      return challenge(401, { scope: decision.scopes.join(" ") });
    }
    if (decision.kind === "insufficient_scope") {
      return challenge(403, { error: "insufficient_scope", scope: decision.scopes.join(" ") });
    }

    // Outils publics : limite par IP contre l'aspiration du catalogue.
    const publicCalls = publicToolCalls(body);
    if (publicCalls.length > 0) {
      const limit = await checkPublicCalls(getPool, clientKey(request.headers), publicCalls);
      if (limit.kind !== "allow") return rateLimitedResponse(body, limit);
    }
  }

  return authedHandler(request);
}

export { handle as GET, handle as POST };
