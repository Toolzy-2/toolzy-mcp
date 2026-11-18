import { afterEach, describe, expect, it, vi } from "vitest";
import { errorKindOf, writeAudit, type AuditEntry } from "../audit";
import { createFakePool } from "./fakePool";

afterEach(() => vi.restoreAllMocks());

const ENTRY: AuditEntry = {
  userId: "u1",
  clientId: "https://claude.ai/oauth/claude-code-client-metadata",
  tool: "send_message",
  status: "ok",
  durationMs: 42,
  errorKind: null,
};

describe("writeAudit", () => {
  it("écrit exactement les six champs autorisés, dans mcp_auth.mcp_audit_log", async () => {
    const fake = createFakePool();
    await writeAudit(fake.pool, ENTRY);
    const [row] = fake.auditRows();
    expect(row.text).toMatch(/insert into mcp_auth\.mcp_audit_log/i);
    expect(row.values).toEqual(["u1", ENTRY.clientId, "send_message", "ok", 42, null]);
  });

  it("borne la durée à un entier positif", async () => {
    const fake = createFakePool();
    await writeAudit(fake.pool, { ...ENTRY, durationMs: -3.7 });
    await writeAudit(fake.pool, { ...ENTRY, durationMs: 12.6 });
    expect(fake.auditRows().map((r) => r.values[4])).toEqual([0, 13]);
  });

  it("tronque un client_id démesuré", async () => {
    const fake = createFakePool();
    await writeAudit(fake.pool, { ...ENTRY, clientId: "x".repeat(5000) });
    expect(String(fake.auditRows()[0].values[1]).length).toBeLessThanOrEqual(512);
  });

  it("ne lève jamais si l'écriture échoue (console.error)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = createFakePool({ failOn: "mcp_audit_log" });
    await expect(writeAudit(fake.pool, ENTRY)).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalled();
  });

  it("ne lève jamais si le pool ne peut pas être créé", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const getPool = () => {
      throw new Error("pas de base");
    };
    await expect(writeAudit(getPool, ENTRY)).resolves.toBeUndefined();
  });
});

describe("errorKindOf", () => {
  class ListingNotFoundError extends Error {}
  class NamedError extends Error {
    constructor() {
      super("Bonjour, voici mon numéro 06 12 34 56 78");
      this.name = "NamedError";
    }
  }

  it("donne le nom de la classe d'erreur, jamais son message", () => {
    expect(errorKindOf(new ListingNotFoundError("texte secret"))).toBe("ListingNotFoundError");
    expect(errorKindOf(new NamedError())).toBe("NamedError");
    expect(errorKindOf(new Error("texte secret"))).toBe("Error");
  });

  it("n'accepte qu'un identifiant comme nom", () => {
    const weird = new Error("x");
    weird.name = "Bonjour voici mon message";
    expect(errorKindOf(weird)).toBe("Error");
    expect(errorKindOf("une chaîne")).toBe("NonError");
  });
});
