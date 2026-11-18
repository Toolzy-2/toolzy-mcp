import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const created: Array<{ options: Record<string, unknown> }> = [];

vi.mock("pg", () => ({
  Pool: class {
    constructor(readonly options: Record<string, unknown>) {
      created.push(this as unknown as { options: Record<string, unknown> });
    }
    on() {
      return this;
    }
  },
}));

const ORIGINAL = process.env.MCP_AUTH_DATABASE_URL;

beforeEach(() => {
  created.length = 0;
  vi.resetModules();
});

afterEach(() => {
  process.env.MCP_AUTH_DATABASE_URL = ORIGINAL;
});

describe("getPool", () => {
  it("est paresseux : rien n'est créé à l'import", async () => {
    process.env.MCP_AUTH_DATABASE_URL = "postgresql://u:p@localhost:5432/db";
    await import("../pool");
    expect(created).toHaveLength(0);
  });

  it("crée un seul pool de 3 connexions au plus, sur MCP_AUTH_DATABASE_URL", async () => {
    process.env.MCP_AUTH_DATABASE_URL = "postgresql://u:p@localhost:5432/db";
    const { getPool } = await import("../pool");
    expect(getPool()).toBe(getPool());
    expect(created).toHaveLength(1);
    expect(created[0].options).toMatchObject({ connectionString: "postgresql://u:p@localhost:5432/db", max: 3 });
  });

  it("échoue explicitement sans MCP_AUTH_DATABASE_URL", async () => {
    delete process.env.MCP_AUTH_DATABASE_URL;
    const { getPool } = await import("../pool");
    expect(() => getPool()).toThrow(/MCP_AUTH_DATABASE_URL/);
  });
});
