import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { getAuth } from "@/lib/auth/auth";

export const runtime = "nodejs";
// Dépend de la configuration et de la base : jamais évaluée au build.
export const dynamic = "force-dynamic";

// Métadonnées publiques : lisibles depuis n'importe quelle origine, sans identifiants.
export const GET = (request: Request) =>
  oauthProviderAuthServerMetadata(getAuth(), {
    headers: { "Access-Control-Allow-Origin": "*" },
  })(request);
