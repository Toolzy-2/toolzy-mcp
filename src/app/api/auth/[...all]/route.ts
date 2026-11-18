import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth/auth";

export const runtime = "nodejs";
// Dépend de la configuration et de la base : jamais évaluée au build.
export const dynamic = "force-dynamic";

const handlers = () => toNextJsHandler(getAuth());

export const GET = (request: Request) => handlers().GET(request);
export const POST = (request: Request) => handlers().POST(request);
