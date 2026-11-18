import type { UserSession } from "../lib/auth/userSession";
import { firstNamesOf } from "../lib/auth/userSession";

export interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  /** Texte déjà masqué (coordonnées retirées). `raw_content` n'est jamais lu. */
  content: string | null;
  read: boolean | null;
  is_visible: boolean | null;
  created_at: string;
}

export interface ConversationRow {
  id: string;
  participants: string[] | null;
  last_message_at: string | null;
  tools: { name: string | null; slug: string | null } | null;
}

export interface MessageView {
  from: string;
  from_me: boolean;
  text: string;
  sent_at: string;
  read: boolean;
  hidden_by_moderation?: true;
}

export interface ConversationView {
  conversation_id: string;
  with: string;
  tool: string | null;
  last_message_at: string | null;
  unread_count: number;
  last_message: MessageView | null;
}

const MESSAGE_COLUMNS = "id, conversation_id, sender_id, content, read, is_visible, created_at";

export function toMessageView(row: MessageRow, userId: string, names: ReadonlyMap<string, string>): MessageView {
  const fromMe = row.sender_id === userId;
  const from = fromMe
    ? "moi"
    : row.sender_id
      ? (names.get(row.sender_id) ?? "un utilisateur Toolzy")
      : "compte supprimé";
  return {
    from,
    from_me: fromMe,
    text: row.content ?? "",
    sent_at: row.created_at,
    read: row.read === true,
    // La RLS ne laisse voir un message non visible qu'à son auteur.
    ...(row.is_visible === false ? { hidden_by_moderation: true as const } : {}),
  };
}

const otherParticipants = (row: ConversationRow, userId: string): string[] =>
  (row.participants ?? []).filter((id) => id !== userId);

export function toConversationView(
  row: ConversationRow,
  userId: string,
  names: ReadonlyMap<string, string>,
  lastMessage: MessageRow | undefined,
  unreadCount: number,
): ConversationView {
  const others = otherParticipants(row, userId)
    .map((id) => names.get(id))
    .filter((name): name is string => Boolean(name));
  return {
    conversation_id: row.id,
    with: others.length > 0 ? others.join(", ") : "un utilisateur Toolzy",
    tool: row.tools?.name ?? null,
    last_message_at: row.last_message_at,
    unread_count: unreadCount,
    last_message: lastMessage ? toMessageView(lastMessage, userId, names) : null,
  };
}

/** Conversations de l'utilisateur, les plus récentes d'abord, avec leurs non-lus. */
export async function listMyConversations(
  session: UserSession,
  { limit = 10, unreadOnly = false }: { limit?: number; unreadOnly?: boolean },
): Promise<{ count: number; conversations: ConversationView[] }> {
  const { data, error } = await session.db
    .from("conversations")
    .select("id, participants, last_message_at, tools(name, slug)")
    .contains("participants", [session.userId])
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(limit)
    .returns<ConversationRow[]>();
  if (error) throw new Error(`Lecture des conversations refusée : ${error.message}`);
  const rows = data ?? [];
  if (rows.length === 0) return { count: 0, conversations: [] };
  const ids = rows.map((r) => r.id);

  const [unread, lastMessages, names] = await Promise.all([
    unreadCounts(session, ids),
    Promise.all(ids.map((id) => lastMessageOf(session, id))),
    firstNamesOf(session.db, rows.flatMap((r) => otherParticipants(r, session.userId))),
  ]);

  const conversations = rows
    .map((row, i) => toConversationView(row, session.userId, names, lastMessages[i], unread.get(row.id) ?? 0))
    .filter((c) => !unreadOnly || c.unread_count > 0);
  return { count: conversations.length, conversations };
}

async function unreadCounts(session: UserSession, conversationIds: string[]): Promise<Map<string, number>> {
  const { data, error } = await session.db
    .from("messages")
    .select("conversation_id")
    .in("conversation_id", conversationIds)
    .eq("read", false)
    .neq("sender_id", session.userId)
    .limit(1000);
  if (error) throw new Error(`Lecture des messages non lus refusée : ${error.message}`);
  return (data ?? []).reduce(
    (counts, { conversation_id: id }) => new Map(counts).set(id, (counts.get(id) ?? 0) + 1),
    new Map<string, number>(),
  );
}

async function lastMessageOf(session: UserSession, conversationId: string): Promise<MessageRow | undefined> {
  const { data, error } = await session.db
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .returns<MessageRow[]>();
  if (error) throw new Error(`Lecture du dernier message refusée : ${error.message}`);
  return data?.[0];
}

export class ConversationNotFoundError extends Error {
  constructor() {
    super("Conversation introuvable");
    this.name = "ConversationNotFoundError";
  }
}

/**
 * Messages d'une conversation, du plus ancien au plus récent. Lecture seule :
 * les messages ne sont PAS marqués comme lus, l'utilisateur garde ses
 * notifications intactes dans l'app.
 */
export async function getConversationMessages(
  session: UserSession,
  { conversationId, limit = 30 }: { conversationId: string; limit?: number },
): Promise<{ conversation: ConversationView; messages: MessageView[] }> {
  const { data: conversation, error } = await session.db
    .from("conversations")
    .select("id, participants, last_message_at, tools(name, slug)")
    .eq("id", conversationId)
    .contains("participants", [session.userId])
    .maybeSingle<ConversationRow>();
  if (error) throw new Error(`Lecture de la conversation refusée : ${error.message}`);
  // Filtrée sur les participants : une conversation d'autrui est introuvable,
  // y compris pour un compte Admin.
  if (!conversation) throw new ConversationNotFoundError();

  const { data: rows, error: messagesError } = await session.db
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<MessageRow[]>();
  if (messagesError) throw new Error(`Lecture des messages refusée : ${messagesError.message}`);

  const recentFirst = rows ?? [];
  const names = await firstNamesOf(session.db, otherParticipants(conversation, session.userId));
  const unread = recentFirst.filter((m) => m.read === false && m.sender_id !== session.userId).length;
  return {
    conversation: toConversationView(conversation, session.userId, names, recentFirst[0], unread),
    messages: [...recentFirst].reverse().map((m) => toMessageView(m, session.userId, names)),
  };
}
