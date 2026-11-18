/**
 * Comptes qu'un agent a le droit de piloter.
 *
 * - Mairie : hors périmètre du MCP, compte refusé.
 * - Admin : accepté, mais traité comme un utilisateur classique. La RLS donne
 *   aux admins des droits étendus (lecture de tous les profils, écriture sur
 *   toutes les annonces...) : chaque requête des outils est donc filtrée
 *   explicitement sur l'utilisateur connecté, sans jamais s'en remettre à la
 *   seule RLS. Voir `openUserSession`.
 */
const EXCLUDED_ROLES = new Set(["mairie"]);

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
