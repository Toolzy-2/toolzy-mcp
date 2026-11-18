import { getAuth } from "@/lib/auth/auth";

export const runtime = "nodejs";

// RFC 9728 : le plugin mcp() sert ce document dès que la requête atteint le handler.
export const GET = (request: Request) => getAuth().handler(request);
