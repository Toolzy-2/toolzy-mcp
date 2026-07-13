import { createMcpHandler } from "mcp-handler";
import { registerToolzyTools } from "@/lib/register";

// supabase-js a besoin du runtime Node.js (pas Edge).
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Endpoint MCP Streamable HTTP (stateless — pas de Redis requis).
 *
 * Routes exposées par mcp-handler (basePath "/api", segment [transport]) :
 *   POST/GET  https://mcp.toolzy.io/api/mcp   → Streamable HTTP
 *   GET       https://mcp.toolzy.io/api/sse   → SSE (legacy, optionnel)
 *
 * `initialize` et `tools/list` sont publics (aucune auth) : indispensable
 * pour que les registres MCP et les clients IA découvrent le serveur.
 */
const handler = createMcpHandler(
  (server) => {
    registerToolzyTools(server);
  },
  {
    // Identité renvoyée dans le handshake `initialize`.
    serverInfo: { name: "toolzy", version: "0.1.0" },
  },
  {
    basePath: "/api",
    maxDuration: 60,
    verboseLogs: process.env.NODE_ENV !== "production",
  },
);

export { handler as GET, handler as POST };
