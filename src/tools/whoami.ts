import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { openUserSession } from "../lib/auth/userSession";

export interface WhoAmIResult {
  user_id: string;
  email: string | null;
  first_name: string | null;
  role: string | null;
  trusted_owner: boolean;
  client_id: string;
  scopes: string[];
}

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
    role: session.profile.role,
    trusted_owner: session.profile.is_super_loueur === true,
    client_id: authInfo.clientId,
    scopes: [...authInfo.scopes],
  };
}
