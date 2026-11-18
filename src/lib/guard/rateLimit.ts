import { GLOBAL_RULE, RATE_LIMIT_RULES, type RateLimitRule } from "./config";
import type { Queryable } from "./types";

export interface RuleCount {
  readonly rule: RateLimitRule;
  readonly windowStart: Date;
  readonly count: number;
}

export type RateDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly rule: RateLimitRule; readonly retryAfterSeconds: number };

/** Règle globale d'abord, puis celles propres à l'outil. */
export const rulesFor = (tool: string): readonly RateLimitRule[] => [GLOBAL_RULE, ...(RATE_LIMIT_RULES[tool] ?? [])];

/** Début de la fenêtre fixe contenant `now`, aligné sur l'époque UTC. */
export function windowStartOf(now: Date, windowSeconds: number): Date {
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

// Une seule instruction pour tous les compteurs de l'appel : l'incrément est
// atomique même sous appels concurrents (verrou de ligne de ON CONFLICT).
const INCREMENT_SQL = `
insert into mcp_auth.mcp_rate_counters as c (user_id, bucket, window_start, count)
select $1, t.bucket, t.window_start, 1
from unnest($2::text[], $3::timestamptz[]) as t(bucket, window_start)
on conflict (user_id, bucket, window_start) do update set count = c.count + 1
returning c.bucket, c.count`;

const parseRow = (row: unknown): { bucket: string; count: number } => {
  const { bucket, count } = (row ?? {}) as { bucket?: unknown; count?: unknown };
  const parsed = typeof count === "string" ? Number(count) : count;
  if (typeof bucket !== "string" || typeof parsed !== "number" || !Number.isInteger(parsed)) {
    throw new Error("Réponse inattendue du compteur de débit");
  }
  return { bucket, count: parsed };
};

/** Incrémente les compteurs de l'appel et renvoie leur nouvelle valeur. */
export async function incrementCounters(
  db: Queryable,
  userId: string,
  rules: readonly RateLimitRule[],
  now: Date,
): Promise<RuleCount[]> {
  const windows = rules.map((rule) => windowStartOf(now, rule.windowSeconds));
  const { rows } = await db.query(INCREMENT_SQL, [
    userId,
    rules.map((rule) => rule.bucket),
    windows.map((w) => w.toISOString()),
  ]);
  const counts = new Map(rows.map(parseRow).map((r) => [r.bucket, r.count]));
  return rules.map((rule, i) => {
    const count = counts.get(rule.bucket);
    if (count === undefined) throw new Error(`Compteur de débit absent : ${rule.bucket}`);
    return { rule, windowStart: windows[i], count };
  });
}

/** Refuse si un seuil est dépassé ; l'attente retenue est la plus longue. */
export function evaluateCounts(counts: readonly RuleCount[], now: Date): RateDecision {
  const exceeded = counts
    .filter(({ rule, count }) => count > rule.max)
    .map(({ rule, windowStart }) => ({
      rule,
      retryAfterSeconds: Math.max(1, Math.ceil((windowStart.getTime() + rule.windowSeconds * 1000 - now.getTime()) / 1000)),
    }))
    .sort((a, b) => b.retryAfterSeconds - a.retryAfterSeconds);
  if (exceeded.length === 0) return { allowed: true };
  return { allowed: false, ...exceeded[0] };
}
