import type { UserSession } from "../lib/auth/userSession";
import { ConversationNotFoundError } from "./my-messages";
import { discardConversation, openConversation, type ConversationTarget } from "./conversations";

export const MESSAGE_MAX_LENGTH = 2000;

export class InvalidMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMessageError";
  }
}

/** La base refuse les liens dans les messages (trigger block_message_urls). */
export class LinksNotAllowedError extends Error {
  constructor() {
    super("Les liens ne sont pas autorisés dans les messages.");
    this.name = "LinksNotAllowedError";
  }
}

/** Destinataire : une conversation connue, ou l'annonce / la réservation concernée. */
export type MessageTarget = { conversationId: string } | ConversationTarget;

export type SendMessageResult =
  | { status: "envoyé"; conversation_id: string; new_conversation: boolean; message_id: string; sent_at: string; note: string }
  | { status: "doublon_ignoré"; conversation_id: string; note: string };

function validateText(text: string): string {
  const content = text.trim();
  if (content.length === 0) throw new InvalidMessageError("Le message est vide.");
  if (content.length > MESSAGE_MAX_LENGTH) {
    throw new InvalidMessageError(`Le message dépasse ${MESSAGE_MAX_LENGTH} caractères.`);
  }
  return content;
}

/** Conversation existante de l'utilisateur, vérifiée par ses participants. */
async function ownConversation(session: UserSession, conversationId: string): Promise<string> {
  const { data, error } = await session.db
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .contains("participants", [session.userId])
    .maybeSingle();
  if (error) throw new Error(`Lecture de la conversation refusée : ${error.message}`);
  if (!data) throw new ConversationNotFoundError();
  return conversationId;
}

/**
 * Envoie un message au nom de l'utilisateur.
 *
 * Avec une annonce ou une réservation, la conversation existante est réutilisée
 * (mêmes règles que le site), sinon une nouvelle est ouverte. Ensuite, même
 * chemin que la messagerie : insertion avec le jeton de l'utilisateur, la base
 * applique le reste (expéditeur forcé, modération avant visibilité, masquage
 * des coordonnées, notification après validation, anti-doublon 60 s).
 */
export async function sendMessage(
  session: UserSession,
  { target, text }: { target: MessageTarget; text: string },
): Promise<SendMessageResult> {
  const content = validateText(text);

  const { conversationId, created } =
    "conversationId" in target
      ? { conversationId: await ownConversation(session, target.conversationId), created: false }
      : await openConversation(session, target);

  const { data: inserted, error } = await session.db
    .from("messages")
    .insert({ conversation_id: conversationId, sender_id: session.userId, content })
    .select("id, created_at")
    .maybeSingle<{ id: string; created_at: string }>();

  if (error || !inserted) {
    // Pas de conversation vide laissée derrière un premier message refusé.
    if (created) await discardConversation(session, conversationId);
    if (error) {
      if (/liens ne sont pas autoris/i.test(error.message)) throw new LinksNotAllowedError();
      throw new Error(`Envoi du message refusé : ${error.message}`);
    }
  }
  // Le trigger anti-doublon annule l'insertion sans erreur.
  if (!inserted) {
    return {
      status: "doublon_ignoré",
      conversation_id: conversationId,
      note: "Ce message identique a déjà été envoyé dans cette conversation il y a moins d'une minute.",
    };
  }

  const { error: touchError } = await session.db
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversationId)
    .contains("participants", [session.userId]);
  // Le message est parti : un échec ici ne fait que retarder son tri dans la liste.
  if (touchError) console.error("[send_message] mise à jour de last_message_at", touchError.message);

  return {
    status: "envoyé",
    conversation_id: conversationId,
    new_conversation: created,
    message_id: inserted.id,
    sent_at: inserted.created_at,
    note:
      "Le message passe par la modération automatique de Toolzy (quelques secondes) avant d'être visible et notifié au destinataire. Les coordonnées éventuelles sont masquées.",
  };
}
