import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAuthenticatedTools } from "../registerAuthenticated";
import { registerToolzyTools } from "../register";
import { PROTECTED_TOOLS } from "../auth/protectedTools";

type Handler = (args: unknown, extra: { authInfo?: unknown }) => Promise<{ isError?: boolean }>;

const capture = (register: (server: McpServer) => void) => {
  const tools = new Map<string, { annotations?: { readOnlyHint?: boolean }; handler: Handler }>();
  const server = {
    registerTool: (name: string, config: { annotations?: { readOnlyHint?: boolean } }, handler: Handler) => {
      tools.set(name, { annotations: config.annotations, handler });
    },
  } as unknown as McpServer;
  register(server);
  return tools;
};

describe("outils connectés", () => {
  const tools = capture(registerAuthenticatedTools);

  it("chaque outil connecté exige un scope dans la table de contrôle d'accès", () => {
    for (const name of tools.keys()) {
      expect(PROTECTED_TOOLS[name], `${name} absent de PROTECTED_TOOLS`).toBeDefined();
      expect(PROTECTED_TOOLS[name].length).toBeGreaterThan(0);
    }
  });

  it("la table ne protège aucun outil fantôme", () => {
    expect(Object.keys(PROTECTED_TOOLS).sort()).toEqual([...tools.keys()].sort());
  });

  it("aucun outil public ne figure parmi les outils protégés", () => {
    const publicTools = capture(registerToolzyTools);
    for (const name of publicTools.keys()) expect(PROTECTED_TOOLS[name]).toBeUndefined();
  });

  it("les outils de lecture sont annotés en lecture seule", () => {
    for (const [name, tool] of tools) expect(tool.annotations?.readOnlyHint, name).toBe(true);
  });

  it("refuse un appel sans identité sans toucher à la base", async () => {
    for (const [, tool] of tools) {
      const result = await tool.handler({}, {});
      expect(result.isError).toBe(true);
    }
  });
});
