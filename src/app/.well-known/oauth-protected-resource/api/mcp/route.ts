import { getAuth } from "@/lib/auth/auth";

export const runtime = "nodejs";
// Dépend de la configuration et de la base : jamais évaluée au build.
export const dynamic = "force-dynamic";

// RFC 9728 : le plugin mcp() sert ce document dès que la requête atteint le handler.
export const GET = (request: Request) => getAuth().handler(request);
