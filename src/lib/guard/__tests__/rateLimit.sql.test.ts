import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { writeAudit } from "../audit";
import { checkRateLimit } from "../guard";
import { incrementCounters, rulesFor } from "../rateLimit";

/**
 * Test contre une vraie base où la migration 20261119000000_mcp_guard.sql est
 * appliquée. Jamais la prod : à lancer avec la base locale, par exemple
 * MCP_GUARD_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres
 */
const url = process.env.MCP_GUARD_TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 5 }) : null;
const userId = `test-guard-${Date.now()}-${Math.random().toString(36).slice(2)}`;

afterAll(async () => {
  if (!pool) return;
  await pool.query("delete from mcp_auth.mcp_rate_counters where user_id = $1", [userId]);
  await pool.query("delete from mcp_auth.mcp_audit_log where user_id = $1", [userId]);
  await pool.end();
});

describe.skipIf(!pool)("garde contre Postgres réel", () => {
  it("incrément atomique sous 30 appels concurrents", async () => {
    const now = new Date();
    const results = await Promise.all(
      Array.from({ length: 30 }, () => incrementCounters(pool!, userId, rulesFor("update_my_listing"), now)),
    );
    const finalCounts = results.map((r) => r[1].count).sort((a, b) => a - b);
    expect(finalCounts).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it("31e modification de l'heure refusée", async () => {
    const decision = await checkRateLimit(pool!, userId, "update_my_listing");
    expect(decision.kind).toBe("rate_limited");
  });

  it("écrit une ligne d'audit conforme aux contraintes", async () => {
    await writeAudit(pool!, { userId, clientId: "client", tool: "whoami", status: "ok", durationMs: 5, errorKind: null });
    const { rows } = await pool!.query("select tool, status from mcp_auth.mcp_audit_log where user_id = $1", [userId]);
    expect(rows).toEqual([{ tool: "whoami", status: "ok" }]);
  });

  it("la base refuse un statut inconnu", async () => {
    await expect(
      pool!.query("insert into mcp_auth.mcp_audit_log (user_id, tool, status) values ($1, 'x', 'autre')", [userId]),
    ).rejects.toThrow();
  });
});
