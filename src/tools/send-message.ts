import type { UserSession } from "../lib/auth/userSession";
import { ConversationNotFoundError } from "./my-messages";

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

export type SendMessageResult =
  | { status: "envoyé"; message_id: string; sent_at: string; note: string }
  | { status: "doublon_ignoré"; note: string };

/**
 * Envoie un message dans une conversation existante de l'utilisateur.
 *
 * Même chemin que la messagerie du site : insertion avec le jeton de
 * l'utilisateur, puis la base prend le relais (trigger guard_message_client_write :
 * expéditeur forcé, message invisible jusqu'à la modération ; masquage des
 * coordonnées ; notification du destinataire après validation ; anti-doublon 60 s).
 */
export async function sendMessage(
  session: UserSession,
  { conversationId, text }: { conversationId: string; text: string },
): Promise<SendMessageResult> {
  const content = text.trim();
  if (content.length === 0) throw new InvalidMessageError("Le message est vide.");
  if (content.length > MESSAGE_MAX_LENGTH) {
    throw new InvalidMessageError(`Le message dépasse ${MESSAGE_MAX_LENGTH} caractères.`);
  }

  // Cloisonnement explicite (voir UserSession) : jamais d'écriture dans une
  // conversation dont l'utilisateur n'est pas participant, même si la RLS
  // venait un jour à l'autoriser.
  const { data: conversation, error: lookupError } = await session.db
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .contains("participants", [session.userId])
    .maybeSingle();
  if (lookupError) throw new Error(`Lecture de la conversation refusée : ${lookupError.message}`);
  if (!conversation) throw new ConversationNotFoundError();

  const { data: inserted, error } = await session.db
    .from("messages")
    .insert({ conversation_id: conversationId, sender_id: session.userId, content })
    .select("id, created_at")
    .maybeSingle<{ id: string; created_at: string }>();
  if (error) {
    if (/liens ne sont pas autoris/i.test(error.message)) throw new LinksNotAllowedError();
    throw new Error(`Envoi du message refusé : ${error.message}`);
  }
  // Le trigger anti-doublon annule l'insertion sans erreur.
  if (!inserted) {
    return {
      status: "doublon_ignoré",
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
    message_id: inserted.id,
    sent_at: inserted.created_at,
    note:
      "Le message passe par la modération automatique de Toolzy (quelques secondes) avant d'être visible et notifié au destinataire. Les coordonnées éventuelles sont masquées.",
  };
}
