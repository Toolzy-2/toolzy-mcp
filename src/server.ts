/**
 * Toolzy MCP Server — entrée stdio (usage local / npx / Claude Desktop).
 *
 * Pour le déploiement distant (mcp.toolzy.io), voir src/app/api/[transport]/route.ts
 * qui expose les mêmes tools en Streamable HTTP via mcp-handler.
 *
 * Les 3 tools sont définis une seule fois dans src/lib/register.ts.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerToolzyTools } from "./lib/register";

const server = new McpServer({
  name: "toolzy",
  version: "0.1.0",
});

registerToolzyTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Toolzy MCP Server running on stdio");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
