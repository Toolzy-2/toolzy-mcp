import { betterAuth } from "better-auth";
import { genericOAuth, jwt } from "better-auth/plugins";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { getPool } from "../db/pool";
import { isAllowedClientMetadataUrl, parseAllowedHosts } from "./clientAllowlist";
import { mapSupabaseProfile } from "./upstreamProfile";
import { getAuthEnv, TOOLZY_SCOPES, UPSTREAM_PROVIDER_ID, type AuthEnv } from "./env";

/**
 * Serveur d'autorisation Toolzy pour le MCP.
 *
 * - Vu des clients MCP : AS OAuth 2.1 (PKCE, RFC 8707, CIMD) qui émet des
 *   jetons dont l'audience est l'URL du serveur MCP.
 * - Vu de Supabase : un unique client OAuth confidentiel. Le jeton Supabase de
 *   l'utilisateur reste côté serveur ; il n'est jamais remis au client MCP.
 */
const ACCESS_TOKEN_TTL_SECONDS = 300;

async function fetchSupabaseProfile(env: AuthEnv, accessToken: string | undefined) {
  if (!accessToken) return null;
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}`, apikey: env.SUPABASE_ANON_KEY },
  });
  if (!response.ok) {
    console.error(`[auth] userinfo Supabase a répondu ${response.status}`);
    return null;
  }
  // Identité = sub Supabase, jamais l'e-mail : voir upstreamProfile.ts.
  return mapSupabaseProfile(await response.json());
}

function createAuth() {
  const env = getAuthEnv();
  const supabaseAuth = `${env.SUPABASE_URL}/auth/v1`;
  const allowedClientHosts = parseAllowedHosts(process.env.MCP_ALLOWED_CLIENT_HOSTS);

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    // Pool partagé avec la limite de débit et le journal d'audit (même MCP_AUTH_DATABASE_URL).
    database: getPool(),
    disabledPaths: ["/token"],
    account: {
      encryptOAuthTokens: true,
      // Jamais de rattachement d'un compte Supabase à un utilisateur existant
      // par e-mail : un utilisateur AS = un sub Supabase (voir upstreamProfile.ts).
      accountLinking: { enabled: false, disableImplicitLinking: true },
    },
    plugins: [
      jwt({ disableSettingJwtHeader: true }),
      genericOAuth({
        config: [
          {
            providerId: UPSTREAM_PROVIDER_ID,
            clientId: env.SUPABASE_OAUTH_CLIENT_ID,
            clientSecret: env.SUPABASE_OAUTH_CLIENT_SECRET,
            // Supabase refuse toute autre méthode que celle déclarée à l'enregistrement du client.
            tokenEndpointAuth: { method: "client_secret_basic" },
            authorizationUrl: `${supabaseAuth}/oauth/authorize`,
            tokenUrl: `${supabaseAuth}/oauth/token`,
            userInfoUrl: `${supabaseAuth}/oauth/userinfo`,
            scopes: ["email"],
            pkce: true,
            getUserInfo: (tokens) => fetchSupabaseProfile(env, tokens.accessToken),
          },
        ],
      }),
      mcp({
        loginPage: "/sign-in",
        consentPage: "/consent",
        resource: env.MCP_RESOURCE_URL,
        scopes: ["offline_access", ...TOOLZY_SCOPES],
        // Pas de fenêtre de rejeu d'un refresh token déjà tourné.
        refreshTokenReuseInterval: 0,
        // Un jeton d'accès JWT ne peut pas être révoqué : sa durée de vie borne
        // le délai pendant lequel une révocation reste sans effet.
        accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
      }),
      cimd({
        fetchClientMetadataResource,
        metadataProfile: "mcp-2026-07-28",
        isMetadataDocumentUrlAllowed: (clientIdUrl) =>
          isAllowedClientMetadataUrl(clientIdUrl, allowedClientHosts),
      }),
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;
let instance: Auth | null = null;

/** Instance paresseuse : rien n'est lu ni connecté au moment du build. */
export function getAuth(): Auth {
  if (!instance) instance = createAuth();
  return instance;
}
