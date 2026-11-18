import type { Queryable } from "../types";

export interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

/**
 * Faux pool pg en mémoire : simule l'incrément atomique des compteurs
 * (INSERT ... ON CONFLICT DO UPDATE RETURNING) et enregistre les écritures
 * du journal d'audit. `failOn` fait échouer les requêtes qui le contiennent.
 */
export function createFakePool(options: { failOn?: string } = {}) {
  const counters = new Map<string, number>();
  const queries: RecordedQuery[] = [];

  const incrementCounters = (values: readonly unknown[]) => {
    const [userId, buckets, windows] = values as [string, string[], string[]];
    return buckets.map((bucket, i) => {
      const key = `${userId}|${bucket}|${windows[i]}`;
      const count = (counters.get(key) ?? 0) + 1;
      counters.set(key, count);
      return { bucket, window_start: new Date(windows[i]), count };
    });
  };

  const pool: Queryable = {
    async query(text: string, values: unknown[] = []) {
      queries.push({ text, values: [...values] });
      if (options.failOn && text.includes(options.failOn)) throw new Error("connexion refusée");
      if (text.includes("mcp_rate_counters")) return { rows: incrementCounters(values) };
      return { rows: [] };
    },
  };

  const auditRows = () => queries.filter((q) => q.text.includes("mcp_audit_log"));
  return { pool, queries, counters, auditRows };
}
