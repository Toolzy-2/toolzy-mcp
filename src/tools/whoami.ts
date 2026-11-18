import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { openUserSession } from "../lib/auth/userSession";

export type AccountType = "particulier" | "professionnel";

export interface WhoAmIResult {
  user_id: string;
  email: string | null;
  first_name: string | null;
  account_type: AccountType;
  trusted_owner: boolean;
  client_id: string;
  scopes: string[];
}

/**
 * Type de compte vu par l'agent. Le rôle interne n'est jamais exposé : un
 * compte Admin apparaît comme un particulier, car le MCP ne lui ouvre aucun
 * droit d'administration.
 */
export const accountTypeOf = (role: string | null): AccountType =>
  role?.toLowerCase() === "ownerpro" ? "professionnel" : "particulier";

/**
 * Identité du compte Toolzy connecté. Le profil est lu dans `users` sous RLS,
 * avec le jeton Supabase détenu par le serveur : aucune clé service_role.
 */
export async function whoami(authInfo: AuthInfo): Promise<WhoAmIResult> {
  const session = await openUserSession(authInfo);
  return {
    user_id: session.userId,
    email: session.email,
    first_name: session.profile.prenom,
    account_type: accountTypeOf(session.profile.role),
    trusted_owner: session.profile.is_super_loueur === true,
    client_id: authInfo.clientId,
    scopes: [...authInfo.scopes],
  };
}
