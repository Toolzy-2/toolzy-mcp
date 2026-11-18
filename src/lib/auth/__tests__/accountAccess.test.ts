import { describe, it, expect } from "vitest";
import { accountAccess } from "../accountAccess";

describe("comptes autorisés à utiliser le MCP", () => {
  it("accepte les particuliers et les pros", () => {
    expect(accountAccess({ role: "Owner", is_blocked: false })).toEqual({ allowed: true });
    expect(accountAccess({ role: "OwnerPro", is_blocked: false })).toEqual({ allowed: true });
    expect(accountAccess({ role: null, is_blocked: null })).toEqual({ allowed: true });
  });

  it("refuse les comptes Admin et Mairie, quelle que soit la casse", () => {
    for (const role of ["Admin", "admin", "Mairie", "MAIRIE"]) {
      expect(accountAccess({ role, is_blocked: false })).toEqual({ allowed: false, reason: "role" });
    }
  });

  it("refuse un compte bloqué", () => {
    expect(accountAccess({ role: "Owner", is_blocked: true })).toEqual({ allowed: false, reason: "blocked" });
  });

  it("refuse quand le profil est introuvable", () => {
    expect(accountAccess(null)).toEqual({ allowed: false, reason: "missing" });
  });
});
