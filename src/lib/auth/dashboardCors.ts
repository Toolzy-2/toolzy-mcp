/**
 * CORS de l'API « applications connectées », appelée depuis toolzy.io.
 * Authentification par en-tête Authorization uniquement : jamais de credentials.
 */
export const DEFAULT_DASHBOARD_ORIGINS: readonly string[] = Object.freeze([
  "https://www.toolzy.io",
  "https://toolzy.io",
]);

/** Une entrée n'est retenue que si c'est une origine http(s) nue (sans chemin). */
function asOrigin(entry: string): string | null {
  try {
    const url = new URL(entry);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function parseDashboardOrigins(raw: string | undefined): readonly string[] {
  if (!raw || raw.trim() === "") return DEFAULT_DASHBOARD_ORIGINS;
  return raw
    .split(",")
    .map((entry) => asOrigin(entry.trim()))
    .filter((origin): origin is string => origin !== null);
}

export function corsHeadersFor(origin: string | null, allowed: readonly string[]): Record<string, string> {
  const base = { Vary: "Origin" };
  if (!origin || !allowed.includes(origin)) return base;
  return {
    ...base,
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization",
    "Access-Control-Max-Age": "600",
  };
}
