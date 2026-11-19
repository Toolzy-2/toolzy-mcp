import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerToolzyTools } from "../register";
import { registerAuthenticatedTools } from "../registerAuthenticated";
import { PROTECTED_TOOLS } from "../auth/protectedTools";
import { CATALOG_TOOL_NAMES, CONNECTED_GROUPS, PUBLIC_TOOLS } from "../toolCatalog";

const registeredNames = (register: (server: McpServer) => void) => {
  const names: string[] = [];
  register({ registerTool: (name: string) => names.push(name) } as unknown as McpServer);
  return names;
};

describe("catalogue de la page d'accueil", () => {
  it("décrit exactement les outils enregistrés, ni plus ni moins", () => {
    const registered = [...registeredNames(registerToolzyTools), ...registeredNames(registerAuthenticatedTools)];
    expect([...CATALOG_TOOL_NAMES].sort()).toEqual(registered.sort());
  });

  it("range chaque outil du bon côté : public sans connexion, connecté avec", () => {
    for (const tool of PUBLIC_TOOLS) expect(PROTECTED_TOOLS[tool.name]).toBeUndefined();
    for (const tool of CONNECTED_GROUPS.flatMap((group) => group.tools)) {
      expect(PROTECTED_TOOLS[tool.name]).toBeDefined();
    }
  });

  it("signale comme écriture exactement les outils qui exigent un droit :write", () => {
    for (const tool of CONNECTED_GROUPS.flatMap((group) => group.tools)) {
      const writes = PROTECTED_TOOLS[tool.name].some((scope) => scope.endsWith(":write"));
      expect(tool.write === true, tool.name).toBe(writes);
    }
  });

  it("annote chaque outil comme l'exigent les annuaires : titre, lecture seule ou destructif", () => {
    const annotations = new Map<string, { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean }>();
    const capture = (register: (server: McpServer) => void) =>
      register({
        registerTool: (name: string, config: { annotations?: object }) =>
          annotations.set(name, config.annotations ?? {}),
      } as unknown as McpServer);
    capture(registerToolzyTools);
    capture(registerAuthenticatedTools);

    for (const [name, hint] of annotations) {
      expect(hint.title, name).toBeTruthy();
      const writes = (PROTECTED_TOOLS[name] ?? []).some((scope) => scope.endsWith(":write"));
      expect(hint.readOnlyHint, name).toBe(!writes);
      expect(hint.destructiveHint, name).toBe(writes);
    }
  });

  it("n'utilise pas de tiret cadratin dans les textes affichés", () => {
    const texts = [...PUBLIC_TOOLS, ...CONNECTED_GROUPS.flatMap((group) => group.tools)].map((tool) => tool.desc);
    for (const text of texts) expect(text).not.toMatch(/[—–]/);
  });
});
