import { describe, expect, it } from "vitest";
import { ConversationNotFoundError } from "../my-messages";
import { ListingNotContactableError } from "../conversations";
import { InvalidMessageError, LinksNotAllowedError, MESSAGE_MAX_LENGTH, sendMessage } from "../send-message";
import { fakeSession, has, ME, operation, type Query } from "./fakeDb";

const CONV = "33333333-3333-3333-3333-333333333333";
const OWNER = "22222222-2222-2222-2222-222222222222";
const TOOL = "44444444-4444-4444-4444-444444444444";

interface Script {
  conversation?: unknown;
  existing?: unknown[];
  tool?: unknown;
  created?: unknown;
  inserted?: unknown;
  insertError?: { message: string };
}

/** Réponses prévues selon la table et l'opération. */
const scripted = (script: Script) =>
  fakeSession((query: Query) => {
    const op = operation(query);
    if (query.table === "tools") return { data: script.tool ?? null, error: null };
    if (query.table === "conversations") {
      if (op === "insert") return { data: script.created ?? null, error: null };
      if (op !== "select") return { data: null, error: null };
      return has(query, "maybeSingle")
        ? { data: script.conversation ?? null, error: null }
        : { data: script.existing ?? [], error: null };
    }
    if (query.table === "messages" && op === "insert") {
      return script.insertError ? { data: null, error: script.insertError } : { data: script.inserted ?? null, error: null };
    }
    return { data: null, error: null };
  });

const OWN_CONVERSATION = { id: CONV };
const INSERTED = { id: "m-1", created_at: "2026-11-18T10:00:00Z" };
const LISTING = { id: TOOL, owner: OWNER, name: "Perceuse", moderation: "validated", paused_by_user: false };
const byOp = (queries: Query[], table: string, op: string) => queries.filter((q) => q.table === table && operation(q) === op);

describe("send_message dans une conversation connue", () => {
  it("envoie le texte nettoyé dans une conversation dont l'utilisateur est participant", async () => {
    const { session, queries } = scripted({ conversation: OWN_CONVERSATION, inserted: INSERTED });

    const result = await sendMessage(session, { target: { conversationId: CONV }, text: "  Bonjour, samedi 10h ?  " });

    expect(result).toMatchObject({ status: "envoyé", message_id: "m-1", conversation_id: CONV, new_conversation: false });
    expect(queries.find((q) => q.table === "conversations")?.calls).toContainEqual(["contains", "participants", [ME]]);
    expect(byOp(queries, "messages", "insert")[0].calls).toContainEqual([
      "insert",
      { conversation_id: CONV, sender_id: ME, content: "Bonjour, samedi 10h ?" },
    ]);
  });

  it("met à jour la date du dernier message, sur la conversation de l'utilisateur seulement", async () => {
    const { session, queries } = scripted({ conversation: OWN_CONVERSATION, inserted: INSERTED });

    await sendMessage(session, { target: { conversationId: CONV }, text: "ok" });

    const [update] = byOp(queries, "conversations", "update");
    expect(update.calls).toContainEqual(["eq", "id", CONV]);
    expect(update.calls).toContainEqual(["contains", "participants", [ME]]);
  });

  it("n'écrit rien dans la conversation d'un autre, même avec un compte Admin", async () => {
    const { session, queries } = scripted({ conversation: null });

    await expect(sendMessage(session, { target: { conversationId: CONV }, text: "coucou" })).rejects.toBeInstanceOf(
      ConversationNotFoundError,
    );
    expect(byOp(queries, "messages", "insert")).toHaveLength(0);
  });

  it("signale un doublon écarté par la base sans le présenter comme une erreur", async () => {
    const { session, queries } = scripted({ conversation: OWN_CONVERSATION, inserted: null });

    const result = await sendMessage(session, { target: { conversationId: CONV }, text: "ok" });

    expect(result.status).toBe("doublon_ignoré");
    expect(byOp(queries, "conversations", "update")).toHaveLength(0);
  });

  it("traduit le refus des liens par la base", async () => {
    const { session } = scripted({
      conversation: OWN_CONVERSATION,
      insertError: { message: "Les liens ne sont pas autorisés dans les messages." },
    });

    await expect(sendMessage(session, { target: { conversationId: CONV }, text: "voir toolzy.io" })).rejects.toBeInstanceOf(
      LinksNotAllowedError,
    );
  });

  it("refuse un message vide ou trop long sans toucher à la base", async () => {
    for (const text of ["   ", "x".repeat(MESSAGE_MAX_LENGTH + 1)]) {
      const { session, queries } = scripted({ conversation: OWN_CONVERSATION });
      await expect(sendMessage(session, { target: { conversationId: CONV }, text })).rejects.toBeInstanceOf(
        InvalidMessageError,
      );
      expect(queries).toHaveLength(0);
    }
  });
});

describe("send_message depuis une annonce", () => {
  const listingUrl = "https://www.toolzy.io/listings/perceuse-bosch";

  it("réutilise la conversation existante sur cette annonce au lieu d'en créer une", async () => {
    const { session, queries } = scripted({
      tool: LISTING,
      existing: [{ id: CONV, participants: [ME, OWNER], tool_id: TOOL, reservation_ids: null, last_message_at: null }],
      inserted: INSERTED,
    });

    const result = await sendMessage(session, { target: { listingUrl }, text: "Dispo samedi ?" });

    expect(result).toMatchObject({ status: "envoyé", conversation_id: CONV, new_conversation: false });
    expect(byOp(queries, "conversations", "insert")).toHaveLength(0);
  });

  it("ouvre une conversation comme le site quand il n'y en a pas", async () => {
    const { session, queries } = scripted({ tool: LISTING, existing: [], created: { id: "c-new" }, inserted: INSERTED });

    const result = await sendMessage(session, { target: { listingUrl }, text: "Dispo samedi ?" });

    expect(result).toMatchObject({ status: "envoyé", conversation_id: "c-new", new_conversation: true });
    const [insert] = byOp(queries, "conversations", "insert");
    expect(insert.calls[0][0]).toBe("insert");
    expect(insert.calls[0][1]).toMatchObject({ participants: [ME, OWNER], tool_id: TOOL });
  });

  it("supprime la conversation créée si le premier message est refusé", async () => {
    const { session, queries } = scripted({
      tool: LISTING,
      existing: [],
      created: { id: "c-new" },
      insertError: { message: "Les liens ne sont pas autorisés dans les messages." },
    });

    await expect(sendMessage(session, { target: { listingUrl }, text: "www.ailleurs.fr" })).rejects.toBeInstanceOf(
      LinksNotAllowedError,
    );
    const [removal] = byOp(queries, "conversations", "delete");
    expect(removal.calls).toContainEqual(["eq", "id", "c-new"]);
    expect(removal.calls).toContainEqual(["contains", "participants", [ME]]);
  });

  it("n'ouvre pas de conversation sur une annonce en pause", async () => {
    const { session, queries } = scripted({ tool: { ...LISTING, paused_by_user: true }, existing: [] });

    await expect(sendMessage(session, { target: { listingUrl }, text: "Dispo ?" })).rejects.toBeInstanceOf(
      ListingNotContactableError,
    );
    expect(byOp(queries, "conversations", "insert")).toHaveLength(0);
    expect(byOp(queries, "messages", "insert")).toHaveLength(0);
  });
});
