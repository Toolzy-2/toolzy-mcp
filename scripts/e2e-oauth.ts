/**
 * Déroule le flux OAuth complet sans navigateur, contre la pile Supabase locale :
 *   client MCP -> AS Toolzy (Better Auth) -> Supabase OAuth Server -> retour
 * puis appelle l'outil protégé `whoami` et rejoue les contre-épreuves de sécurité
 * (jeton MCP refusé par PostgREST, rejeu de code, mauvais verifier, refresh tourné).
 *
 * Usage : npx tsx --env-file=.env.spike-local scripts/e2e-oauth.ts <email> <mot de passe>
 */
import { createHash, randomBytes } from "node:crypto";
import { getAuth } from "../src/lib/auth/auth";

const [email, password] = process.argv.slice(2);
if (!email || !password) throw new Error("Usage : e2e-oauth.ts <email> <mot de passe>");

const APP = process.env.BETTER_AUTH_URL as string;
const RESOURCE = process.env.MCP_RESOURCE_URL as string;
const SUPABASE = process.env.SUPABASE_URL as string;
const ANON = process.env.SUPABASE_ANON_KEY as string;
// Avec E2E_CIMD_CLIENT_ID, le client n'est pas pré-enregistré : son identifiant
// est l'URL de son document de métadonnées (CIMD), que l'AS va chercher lui-même.
const CIMD_CLIENT_ID = process.env.E2E_CIMD_CLIENT_ID;
const REDIRECT = process.env.E2E_REDIRECT ?? "http://127.0.0.1:9876/callback";
const SCOPE = "profile:read offline_access";

const jar = new Map<string, string>();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
const remember = (response: Response) => {
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const index = pair.indexOf("=");
    jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
};
const app = async (url: string, init: RequestInit = {}) => {
  // Une requête GET simule une navigation du navigateur, un POST un appel fetch de la page.
  const navigation = (init.method ?? "GET") === "GET";
  const response = await fetch(url, {
    ...init,
    redirect: "manual",
    headers: {
      Cookie: cookieHeader(),
      ...(navigation ? { Accept: "text/html", "Sec-Fetch-Mode": "navigate" } : { Origin: APP }),
      ...(init.headers ?? {}),
    },
  });
  remember(response);
  return response;
};
/**
 * Better Auth répond par un 302 à une navigation et par { redirect, url } à un
 * appel fetch. Node interdit de forcer `Sec-Fetch-Mode: navigate`, donc ce
 * script est toujours vu comme un fetch : l'URL du corps fait foi quand elle existe.
 */
const locationOf = async (response: Response): Promise<string | null> => {
  const body = (await response.clone().json().catch(() => null)) as { url?: string } | null;
  return body?.url ?? response.headers.get("location");
};
const step = (label: string, detail: unknown = "") => console.log(`✓ ${label}`, detail);
const b64url = (buffer: Buffer) => buffer.toString("base64url");

const supa = async (path: string, init: RequestInit, bearer?: string) => {
  const response = await fetch(`${SUPABASE}/auth/v1${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: ANON,
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Supabase ${path} -> ${response.status} ${JSON.stringify(data)}`);
  return data;
};

/**
 * Connexion à l'AS via Supabase. Renvoie la première redirection qui quitte
 * le chemin /api/auth (page de l'AS ou retour au client).
 */
async function signInThroughSupabase(oauthQuery: string | undefined, callbackURL: string): Promise<URL> {
  const social = await app(`${APP}/api/auth/sign-in/social`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "supabase", callbackURL, ...(oauthQuery ? { oauth_query: oauthQuery } : {}) }),
  });
  const { url: upstreamAuthorize } = (await social.json()) as { url: string };
  const upstream = new URL(upstreamAuthorize);
  step("départ vers Supabase", `${upstream.pathname} scope=${upstream.searchParams.get("scope")} pkce=${upstream.searchParams.get("code_challenge_method")}`);

  const fromSupabase = await fetch(upstreamAuthorize, { redirect: "manual" });
  let back = new URL(fromSupabase.headers.get("location") ?? "");
  const authorizationId = back.searchParams.get("authorization_id");
  if (authorizationId) {
    step("Supabase renvoie vers sa page de consentement", back.pathname);
    const session = await supa("/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
    const userSession = String(session.access_token);
    const details = await supa(`/oauth/authorizations/${authorizationId}`, { method: "GET" }, userSession);
    if (details.redirect_url) {
      step("Supabase : consentement déjà donné, approbation automatique");
      back = new URL(String(details.redirect_url));
    } else {
      step("Supabase : détails de l'autorisation", JSON.stringify({ client: (details.client as { name?: string })?.name, scope: details.scope }));
      const approved = await supa(`/oauth/authorizations/${authorizationId}/consent`, { method: "POST", body: JSON.stringify({ action: "approve" }) }, userSession);
      back = new URL(String(approved.redirect_url));
    }
  } else {
    step("Supabase a redirigé sans page de consentement", `${back.origin}${back.pathname}`);
  }

  let next = back.toString();
  for (let hop = 0; hop < 8; hop += 1) {
    const response = await app(next);
    const location = await locationOf(response);
    if (!location) throw new Error(`Redirections interrompues (${response.status}) sur ${next}: ${(await response.text()).slice(0, 200)}`);
    const target = new URL(location, APP);
    if (!target.pathname.startsWith("/api/auth")) return target;
    next = target.toString();
  }
  throw new Error("Trop de redirections");
}

// 0. Client public pré-enregistré (tient lieu du client MCP). La création
//    exige une session : on lie d'abord le compte une première fois.
let clientId: string;
if (CIMD_CLIENT_ID) {
  clientId = CIMD_CLIENT_ID;
  step("client CIMD (aucun enregistrement préalable)", clientId);
} else {
  await signInThroughSupabase(undefined, "/");
  const client = await getAuth().api.adminCreateOAuthClient({
    headers: new Headers({ cookie: cookieHeader() }),
    body: {
      client_name: "Spike MCP client",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      application_type: "native",
      resources: [RESOURCE],
      scope: SCOPE,
    },
  });
  clientId = client.client_id as string;
  step("client enregistré", clientId);
}
jar.clear(); // le flux testé repart sans session sur l'AS

// 1. Demande d'autorisation (PKCE S256 + resource).
const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash("sha256").update(verifier).digest());
const authorize = new URL(`${APP}/api/auth/oauth2/authorize`);
authorize.search = new URLSearchParams({
  response_type: "code",
  client_id: clientId,
  redirect_uri: REDIRECT,
  scope: SCOPE,
  state: "etat-e2e",
  code_challenge: challenge,
  code_challenge_method: "S256",
  resource: RESOURCE,
}).toString();
const toLogin = await app(authorize.toString());
const loginUrl = new URL((await locationOf(toLogin)) ?? "", APP);
if (loginUrl.pathname !== "/sign-in") {
  throw new Error(`Attendu /sign-in, reçu ${toLogin.status} ${toLogin.headers.get("location")} ${(await toLogin.text()).slice(0, 300)}`);
}
step("sans session : redirigé vers la page de connexion de l'AS");

// 2-6. Connexion via Supabase, puis consentement sur l'AS (sauté s'il est déjà mémorisé).
const afterLogin = await signInThroughSupabase(loginUrl.search.slice(1), "/consent");
let backToClient: string;
if (afterLogin.pathname === "/consent") {
  step("session AS créée, consentement demandé", `scope=${afterLogin.searchParams.get("scope")}`);
  const consent = await app(`${APP}/api/auth/oauth2/consent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accept: true, oauth_query: afterLogin.search.slice(1) }),
  });
  backToClient = ((await consent.json()) as { url: string }).url;
} else if (afterLogin.origin === new URL(REDIRECT).origin) {
  step("session AS créée, consentement déjà mémorisé pour ce client");
  backToClient = afterLogin.toString();
} else {
  throw new Error(`Étape inattendue après la connexion : ${afterLogin}`);
}
const callback = new URL(backToClient);
const code = callback.searchParams.get("code");
if (!code) throw new Error(`Pas de code : ${backToClient}`);
step("code reçu", `iss=${callback.searchParams.get("iss")} state=${callback.searchParams.get("state")}`);

// 7. Échange du code (PKCE) contre un jeton lié à la ressource.
const token = async (params: Record<string, string>) => {
  const response = await fetch(`${APP}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, resource: RESOURCE, ...params }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};
const issued = await token({
  grant_type: "authorization_code",
  code,
  redirect_uri: REDIRECT,
  code_verifier: verifier,
});
if (issued.status !== 200) throw new Error(`Échange refusé : ${JSON.stringify(issued.body)}`);
const accessToken = String(issued.body.access_token);
const claims = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString());
step("jeton MCP émis", JSON.stringify({ iss: claims.iss, aud: claims.aud, scope: claims.scope, azp: claims.azp, exp_dans_s: claims.exp - Math.floor(Date.now() / 1000), refresh: Boolean(issued.body.refresh_token) }));

// 8. Appel de l'outil protégé.
const mcp = async (bearer: string | undefined, name: string) => {
  const response = await fetch(RESOURCE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } }),
  });
  const text = await response.text();
  const data = text.split("\n").find((line) => line.startsWith("data: "));
  return { status: response.status, wwwAuth: response.headers.get("www-authenticate"), payload: data ? JSON.parse(data.slice(6)) : text };
};
const who = await mcp(accessToken, "whoami");
console.log("→ whoami :", who.status, who.payload?.result?.content?.[0]?.text ?? JSON.stringify(who.payload));

// 9. Contre-épreuves.
const rest = await fetch(`${SUPABASE}/rest/v1/?select=*`, {
  headers: { apikey: ANON, Authorization: `Bearer ${accessToken}` },
});
console.log("→ jeton MCP présenté directement à PostgREST :", rest.status, (await rest.text()).slice(0, 120));

if (issued.body.refresh_token) {
  const refreshed = await token({ grant_type: "refresh_token", refresh_token: String(issued.body.refresh_token) });
  console.log("→ rafraîchissement :", refreshed.status, refreshed.status === 200 ? "nouveau jeton" : refreshed.body.error);
  const reuse = await token({ grant_type: "refresh_token", refresh_token: String(issued.body.refresh_token) });
  console.log("→ réutilisation de l'ancien refresh token :", reuse.status, reuse.body.error);
}
const replay = await token({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: verifier });
console.log("→ rejeu du code d'autorisation :", replay.status, replay.body.error);

const wrongVerifier = await token({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: "mauvais" });
console.log("→ mauvais code_verifier :", wrongVerifier.status, wrongVerifier.body.error);


// Après un rejeu du code, les jetons issus de ce code doivent être révoqués côté AS.
const afterReplay = await mcp(accessToken, "whoami");
console.log("→ whoami avec le jeton d'accès initial après rejeu du code :", afterReplay.status, afterReplay.payload?.result?.isError ? "refusé par l'outil" : "encore accepté (JWT vérifié localement jusqu'à exp)");

const anonymous = await mcp(undefined, "whoami");
console.log("→ whoami sans jeton :", anonymous.status, anonymous.wwwAuth);
process.exit(0);
