/**
 * Identité d'un utilisateur côté serveur d'autorisation (Better Auth).
 *
 * L'identité est le `sub` Supabase (UUID du compte Toolzy), jamais l'e-mail :
 * Better Auth rattache un nouveau compte amont à un utilisateur existant qui a
 * le même e-mail. Si X change d'e-mail et que Y reprend l'ancien, Y serait
 * rattaché à l'utilisateur AS de X et agirait avec le jeton Supabase de X.
 * L'e-mail enregistré est donc une adresse technique unique par `sub` ;
 * l'e-mail réel n'est gardé que comme nom affiché.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Domaine réservé (RFC 2606) : aucune adresse de ce domaine ne peut recevoir de courrier. */
const TECHNICAL_DOMAIN = "users.toolzy-mcp.invalid";

export const technicalEmailFor = (sub: string): string => `${sub.toLowerCase()}@${TECHNICAL_DOMAIN}`;

export interface MappedProfile {
  [key: string]: unknown;
  id: string;
  email: string;
  emailVerified: true;
  name: string;
}

export function mapSupabaseProfile(profile: unknown): MappedProfile | null {
  const { sub, email } = (profile ?? {}) as { sub?: unknown; email?: unknown };
  if (typeof sub !== "string" || !UUID.test(sub)) return null;
  return {
    id: sub,
    email: technicalEmailFor(sub),
    // Adresse technique : rien à vérifier, et elle ne sert jamais à un envoi.
    emailVerified: true,
    name: typeof email === "string" && email.trim() !== "" ? email.trim() : "Compte Toolzy",
  };
}
