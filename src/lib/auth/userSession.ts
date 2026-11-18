import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountAccess } from "./accountAccess";
import { checkGrant, getGrantsDb, type GrantState } from "./grants";
import { createSupabaseForToken, getUpstreamAccessToken, getUpstreamUser, UpstreamSessionError } from "./upstream";

/**
 * L'utilisateur a révoqué l'accès de ce client (ou le client a été désactivé)
 * alors que son jeton MCP, vérifié localement, n'a pas encore expiré.
 * Hérite d'UpstreamSessionError : à défaut de traduction dédiée, l'appelant
 * invite à se reconnecter.
 */
export class ConsentRevokedError extends UpstreamSessionError {
  constructor(readonly reason: Exclude<GrantState, "active">) {
    super(`Accès révoqué (${reason})`);
    this.name = "ConsentRevokedError";
  }
}

/**
 * Révocation immédiate : le jeton MCP est un JWT valable 300 s, vérifié sans
 * aller en base. On relit donc l'autorisation à chaque appel d'outil.
 */
async function assertGrantActive(userId: string, clientId: string, issuedAt: unknown): Promise<void> {
  const iat = typeof issuedAt === "number" && Number.isFinite(issuedAt) ? issuedAt : undefined;
  const state = await checkGrant(getGrantsDb(), userId, clientId, iat);
  if (state !== "active") throw new ConsentRevokedError(state);
}

/** Le compte existe mais n'a pas le droit d'être piloté par un agent. */
export class AccountNotAllowedError extends Error {
  constructor(readonly reason: string) {
    super(`Compte non autorisé (${reason})`);
    this.name = "AccountNotAllowedError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Session d'un outil connecté.
 *
 * RÈGLE : chaque requête faite avec `db` doit être filtrée explicitement sur
 * `userId` (ou sur des lignes déjà filtrées ainsi). La RLS seule ne suffit
 * pas : elle ouvre aux comptes Admin la lecture et l'écriture des données de
 * tous les utilisateurs, et le MCP ne doit exposer aucun de ces droits.
 */
export interface UserSession {
  readonly userId: string;
  readonly email: string | null;
  readonly profile: { prenom: string | null; role: string | null; is_super_loueur: boolean | null };
  /** Client Supabase porteur du jeton de l'utilisateur : toutes les lectures passent par la RLS. */
  readonly db: SupabaseClient;
}

/**
 * Point d'entrée unique de tout outil connecté. Vérifie que l'autorisation
 * (utilisateur, client) est toujours active, récupère le jeton Supabase
 * détenu par le serveur, relit le profil et applique les exclusions (comptes
 * mairie, bloqués) avant de rendre la main. Aucun outil ne doit lire la
 * base sans passer par ici.
 */
export async function openUserSession(authInfo: AuthInfo): Promise<UserSession> {
  const userId = authInfo.extra?.userId;
  if (typeof userId !== "string") throw new Error("Identité absente du jeton");
  if (!authInfo.clientId) throw new Error("Client absent du jeton");
  await assertGrantActive(userId, authInfo.clientId, authInfo.extra?.issuedAt);

  const accessToken = await getUpstreamAccessToken(userId);
  const user = await getUpstreamUser(accessToken);
  // L'identifiant entre dans des filtres PostgREST : on n'accepte qu'un UUID.
  if (!UUID.test(user.id)) throw new Error("Identifiant utilisateur invalide");
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
