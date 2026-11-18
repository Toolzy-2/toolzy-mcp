import type { UserSession } from "../lib/auth/userSession";
import { firstNamesOf } from "../lib/auth/userSession";

/**
 * Retrouver ou ouvrir la conversation avec quelqu'un, mêmes règles que le site :
 *  - depuis une annonce (ContactModal) : les deux personnes + l'outil ;
 *  - depuis une réservation (findConversationForReservation) : la conversation
 *    qui référence la réservation, sinon même paire + même outil, sinon même paire.
 *
 * Toutes les requêtes sont filtrées sur l'utilisateur connecté (voir UserSession).
 */

export class ListingNotFoundError extends Error {
  constructor() {
    super("Annonce introuvable");
    this.name = "ListingNotFoundError";
  }
}

export class ReservationNotFoundError extends Error {
  constructor() {
    super("Réservation introuvable");
    this.name = "ReservationNotFoundError";
  }
}

/** On ne s'écrit pas à soi-même : c'est sa propre annonce. */
export class OwnListingError extends Error {
  constructor() {
    super("C'est votre propre annonce");
    this.name = "OwnListingError";
  }
}

/** Annonce refusée en modération ou mise en pause : pas de nouveau contact. */
export class ListingNotContactableError extends Error {
  constructor() {
    super("Annonce indisponible");
    this.name = "ListingNotContactableError";
  }
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,200}$/i;

/** Slug d'une annonce à partir de son URL toolzy.io ou du slug lui-même. */
export function parseListingSlug(ref: string): string | null {
  const trimmed = ref.trim();
  const fromUrl = trimmed.match(/\/listings\/([^/?#]+)/)?.[1];
  let slug: string;
  try {
    slug = decodeURIComponent(fromUrl ?? trimmed);
  } catch {
    return null;
  }
  return SLUG.test(slug) ? slug : null;
}

export interface Counterpart {
  /** L'autre personne de la conversation. */
  userId: string;
  toolId: string | null;
  toolName: string | null;
  reservationId: string | null;
  /** Une nouvelle conversation est-elle permise si aucune n'existe ? */
  canStart: boolean;
  /** Raison du refus quand `canStart` vaut false. */
  blockedBy?: "listing_unavailable";
}

interface ConversationMatchRow {
  id: string;
  participants: string[] | null;
  tool_id: string | null;
  reservation_ids: string[] | null;
  last_message_at: string | null;
}

export type ConversationTarget =
  | { listingUrl: string; reservationId?: undefined }
  | { reservationId: string; listingUrl?: undefined };

/** Propriétaire de l'annonce : la personne à contacter. */
async function counterpartFromListing(session: UserSession, listingUrl: string): Promise<Counterpart> {
  const slug = parseListingSlug(listingUrl);
  if (!slug) throw new ListingNotFoundError();
  const { data: tool, error } = await session.db
    .from("tools")
    .select("id, owner, name, moderation, paused_by_user")
    .eq("slug", slug)
    .maybeSingle<{ id: string; owner: string | null; name: string | null; moderation: string | null; paused_by_user: boolean | null }>();
  if (error) throw new Error(`Lecture de l'annonce refusée : ${error.message}`);
  if (!tool?.owner) throw new ListingNotFoundError();
  if (tool.owner === session.userId) throw new OwnListingError();

  const contactable = tool.moderation === "validated" && tool.paused_by_user !== true;
  return {
    userId: tool.owner,
    toolId: tool.id,
    toolName: tool.name,
    reservationId: null,
    canStart: contactable,
    ...(contactable ? {} : { blockedBy: "listing_unavailable" as const }),
  };
}

/** L'autre partie d'une réservation de l'utilisateur (locataire ou propriétaire). */
async function counterpartFromReservation(session: UserSession, reservationId: string): Promise<Counterpart> {
  const { data: reservation, error } = await session.db
    .from("reservations")
    .select("id, user_id, owner_id, tool_id, annonce_title")
    .eq("id", reservationId)
    .or(`user_id.eq.${session.userId},owner_id.eq.${session.userId}`)
    .maybeSingle<{ id: string; user_id: string | null; owner_id: string | null; tool_id: string | null; annonce_title: string | null }>();
  if (error) throw new Error(`Lecture de la réservation refusée : ${error.message}`);
  if (!reservation) throw new ReservationNotFoundError();

  const other = reservation.user_id === session.userId ? reservation.owner_id : reservation.user_id;
  if (!other || other === session.userId) throw new ReservationNotFoundError();
  return {
    userId: other,
    toolId: reservation.tool_id,
    toolName: reservation.annonce_title,
    reservationId: reservation.id,
    canStart: true,
  };
}

export function resolveCounterpart(session: UserSession, target: ConversationTarget): Promise<Counterpart> {
  return target.listingUrl !== undefined
    ? counterpartFromListing(session, target.listingUrl)
    : counterpartFromReservation(session, target.reservationId);
}

/** Choisit la conversation existante selon les règles du site. */
export function pickConversation(rows: ConversationMatchRow[], counterpart: Counterpart): ConversationMatchRow | undefined {
  if (counterpart.reservationId) {
    const byReservation = rows.find((c) => c.reservation_ids?.includes(counterpart.reservationId as string));
    if (byReservation) return byReservation;
  }
  const sameTool = rows.find((c) => counterpart.toolId !== null && c.tool_id === counterpart.toolId);
  if (sameTool) return sameTool;
  // Depuis une annonce, le site exige le même outil ; depuis une réservation, la paire suffit.
  return counterpart.reservationId ? rows[0] : undefined;
}

/** Conversation existante entre l'utilisateur et `counterpart`, s'il y en a une. */
export async function findExistingConversation(session: UserSession, counterpart: Counterpart): Promise<string | null> {
  const { data, error } = await session.db
    .from("conversations")
    .select("id, participants, tool_id, reservation_ids, last_message_at")
    .contains("participants", [session.userId, counterpart.userId])
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(50)
    .returns<ConversationMatchRow[]>();
  if (error) throw new Error(`Lecture des conversations refusée : ${error.message}`);
  return pickConversation(data ?? [], counterpart)?.id ?? null;
}

export interface FindConversationResult {
  exists: boolean;
  conversation_id: string | null;
  with: string;
  tool: string | null;
  /** Si aucune conversation n'existe : send_message peut-il en ouvrir une ? */
  can_start_new: boolean;
  note: string;
}

/** Vérifie s'il existe déjà une conversation, sans rien écrire. */
export async function findConversation(session: UserSession, target: ConversationTarget): Promise<FindConversationResult> {
  const counterpart = await resolveCounterpart(session, target);
  const [conversationId, names] = await Promise.all([
    findExistingConversation(session, counterpart),
    firstNamesOf(session.db, [counterpart.userId]),
  ]);
  const base = {
    with: names.get(counterpart.userId) ?? "un utilisateur Toolzy",
    tool: counterpart.toolName,
  };
  if (conversationId) {
    return {
      ...base,
      exists: true,
      conversation_id: conversationId,
      can_start_new: false,
      note: "Une conversation existe : lisez-la avec get_conversation_messages, répondez avec send_message et ce conversation_id.",
    };
  }
  return {
    ...base,
    exists: false,
    conversation_id: null,
    can_start_new: counterpart.canStart,
    note: counterpart.canStart
      ? "Aucune conversation pour l'instant. send_message avec la même annonce ou réservation en ouvrira une."
      : "Aucune conversation, et cette annonce n'accepte pas de nouveau contact (en pause ou indisponible).",
  };
}

/**
 * Conversation à utiliser pour écrire : l'existante, sinon une nouvelle,
 * créée comme le fait le site. Renvoie aussi de quoi annuler la création.
 */
export async function openConversation(
  session: UserSession,
  target: ConversationTarget,
): Promise<{ conversationId: string; created: boolean }> {
  const counterpart = await resolveCounterpart(session, target);
  const existing = await findExistingConversation(session, counterpart);
  if (existing) return { conversationId: existing, created: false };
  if (!counterpart.canStart) throw new ListingNotContactableError();

  const { data, error } = await session.db
    .from("conversations")
    .insert({
      participants: [session.userId, counterpart.userId],
      tool_id: counterpart.toolId,
      ...(counterpart.reservationId ? { reservation_ids: [counterpart.reservationId] } : {}),
      last_message_at: new Date().toISOString(),
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) throw new Error(`Création de la conversation refusée : ${error?.message ?? "aucune ligne"}`);
  return { conversationId: data.id, created: true };
}

/** Supprime une conversation qu'on vient de créer quand le premier message n'a pas pu partir. */
export async function discardConversation(session: UserSession, conversationId: string): Promise<void> {
  const { error } = await session.db
    .from("conversations")
    .delete()
    .eq("id", conversationId)
    .contains("participants", [session.userId]);
  if (error) console.error("[conversations] conversation vide non supprimée", conversationId, error.message);
}
