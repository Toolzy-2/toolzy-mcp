import { describe, it, expect } from "vitest";
import { decideAccess, PROTECTED_TOOLS } from "../protectedTools";

const appel = (name: string) => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name } });

describe("contrôle d'accès par outil", () => {
  it("whoami est protégé par profile:read", () => {
    expect(PROTECTED_TOOLS.whoami).toEqual(["profile:read"]);
  });

  it("laisse passer initialize et tools/list sans jeton", () => {
    expect(decideAccess({ jsonrpc: "2.0", id: 1, method: "tools/list" }, undefined)).toEqual({ kind: "allow" });
    expect(decideAccess({ jsonrpc: "2.0", id: 1, method: "initialize" }, undefined)).toEqual({ kind: "allow" });
  });

  it("laisse passer un outil public sans jeton", () => {
    expect(decideAccess(appel("search_tools"), undefined)).toEqual({ kind: "allow" });
  });

  it("exige une connexion pour un outil protégé appelé sans jeton", () => {
    expect(decideAccess(appel("whoami"), undefined)).toEqual({
      kind: "unauthenticated",
      scopes: ["profile:read"],
    });
  });

  it("signale les scopes manquants quand le jeton ne les porte pas", () => {
    expect(decideAccess(appel("whoami"), ["messages:read"])).toEqual({
      kind: "insufficient_scope",
      scopes: ["profile:read"],
    });
  });

  it("autorise un outil protégé quand le jeton porte le scope", () => {
    expect(decideAccess(appel("whoami"), ["profile:read"])).toEqual({ kind: "allow" });
  });

  it("applique la règle la plus stricte sur un lot de requêtes", () => {
    expect(decideAccess([appel("search_tools"), appel("whoami")], undefined)).toEqual({
      kind: "unauthenticated",
      scopes: ["profile:read"],
    });
  });

  it("ignore un corps illisible (le serveur MCP répondra l'erreur de protocole)", () => {
    expect(decideAccess(null, undefined)).toEqual({ kind: "allow" });
    expect(decideAccess("texte", undefined)).toEqual({ kind: "allow" });
  });
});
