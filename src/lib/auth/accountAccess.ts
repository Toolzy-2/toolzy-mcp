/**
 * Comptes qu'un agent a le droit de piloter. Les fonctionnalités Admin et
 * Mairie sont hors périmètre du MCP : un jeton d'agent sur un compte
 * d'administration ouvrirait bien plus que les outils exposés.
 */
const EXCLUDED_ROLES = new Set(["admin", "mairie"]);

export interface AccountProfile {
  role: string | null;
  is_blocked: boolean | null;
}

export type AccountAccess =
  | { allowed: true }
  | { allowed: false; reason: "missing" | "role" | "blocked" };

export function accountAccess(profile: AccountProfile | null): AccountAccess {
  if (!profile) return { allowed: false, reason: "missing" };
  if (profile.role && EXCLUDED_ROLES.has(profile.role.toLowerCase())) {
    return { allowed: false, reason: "role" };
  }
  if (profile.is_blocked === true) return { allowed: false, reason: "blocked" };
  return { allowed: true };
}
