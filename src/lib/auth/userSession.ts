import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountAccess } from "./accountAccess";
import { createSupabaseForToken, getUpstreamAccessToken, getUpstreamUser } from "./upstream";

/** Le compte existe mais n'a pas le droit d'être piloté par un agent. */
export class AccountNotAllowedError extends Error {
  constructor(readonly reason: string) {
    super(`Compte non autorisé (${reason})`);
    this.name = "AccountNotAllowedError";
  }
}

export interface UserSession {
  readonly userId: string;
  readonly email: string | null;
  readonly profile: { prenom: string | null; role: string | null; is_super_loueur: boolean | null };
  /** Client Supabase porteur du jeton de l'utilisateur : toutes les lectures passent par la RLS. */
  readonly db: SupabaseClient;
}

/**
 * Point d'entrée unique de tout outil connecté. Récupère le jeton Supabase
 * détenu par le serveur, relit le profil et applique les exclusions (comptes
 * admin, mairie, bloqués) avant de rendre la main. Aucun outil ne doit lire la
 * base sans passer par ici.
 */
export async function openUserSession(authInfo: AuthInfo): Promise<UserSession> {
  const userId = authInfo.extra?.userId;
  if (typeof userId !== "string") throw new Error("Identité absente du jeton");

  const accessToken = await getUpstreamAccessToken(userId);
  const user = await getUpstreamUser(accessToken);
  const db = createSupabaseForToken(accessToken);
  const { data: profile, error } = await db
    .from("users")
    .select("prenom, role, is_blocked, is_super_loueur")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw new Error(`Lecture du profil refusée : ${error.message}`);

  const access = accountAccess(profile);
  if (!access.allowed) throw new AccountNotAllowedError(access.reason);

  return {
    userId: user.id,
    email: user.email,
    profile: {
      prenom: profile?.prenom ?? null,
      role: profile?.role ?? null,
      is_super_loueur: profile?.is_super_loueur ?? null,
    },
    db,
  };
}

/** Prénoms des utilisateurs donnés, tels que la RLS autorise à les lire. */
export async function firstNamesOf(db: SupabaseClient, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data, error } = await db.from("users").select("id, prenom").in("id", unique);
  if (error) {
    console.error("[userSession] lecture des prénoms refusée", error.message);
    return new Map();
  }
  return new Map(
    (data ?? [])
      .filter((u): u is { id: string; prenom: string } => typeof u.prenom === "string" && u.prenom.trim() !== "")
      .map((u) => [u.id, u.prenom.trim()]),
  );
}
