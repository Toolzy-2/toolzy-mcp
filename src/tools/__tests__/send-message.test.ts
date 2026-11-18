import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserSession } from "../../lib/auth/userSession";
import { ConversationNotFoundError } from "../my-messages";
import { InvalidMessageError, LinksNotAllowedError, MESSAGE_MAX_LENGTH, sendMessage } from "../send-message";

const ME = "11111111-1111-1111-1111-111111111111";
const CONV = "33333333-3333-3333-3333-333333333333";

type Call = [method: string, ...args: unknown[]];
interface Query {
  table: string;
  calls: Call[];
}

interface Script {
  conversation?: unknown;
  inserted?: unknown;
  insertError?: { message: string };
}

/** Faux client : enregistre chaque requête, renvoie la conversation et le résultat d'insertion prévus. */
function fakeSession(script: Script) {
  const queries: Query[] = [];
  const db = {
    from(table: string) {
      const query: Query = { table, calls: [] };
      queries.push(query);
      const result = () => {
        const has = (m: string) => query.calls.some(([c]) => c === m);
        if (table === "conversations" && !has("update")) return { data: script.conversation ?? null, error: null };
        if (table === "messages" && has("insert")) {
          return script.insertError
            ? { data: null, error: script.insertError }
            : { data: script.inserted ?? null, error: null };
        }
        return { data: null, error: null };
      };
      const builder: unknown = new Proxy(
        {},
        {
          get(_t, method: string) {
            if (method === "then") return (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
            return (...args: unknown[]) => {
              query.calls.push([method, ...args]);
              return builder;
            };
          },
        },
      );
      return builder;
    },
  };
  const session: UserSession = {
    userId: ME,
    email: null,
    profile: { prenom: "Moi", role: "Admin", is_super_loueur: false },
    db: db as unknown as SupabaseClient,
  };
  return { session, queries };
}

const OWN_CONVERSATION = { id: CONV, participants: [ME, "x"] };
const inserts = (queries: Query[]) =>
  queries.filter((q) => q.table === "messages" && q.calls.some(([m]) => m === "insert"));

describe("send_message", () => {
  it("envoie le texte nettoyé dans une conversation dont l'utilisateur est participant", async () => {
    const { session, queries } = fakeSession({
      conversation: OWN_CONVERSATION,
      inserted: { id: "m-1", created_at: "2026-11-18T10:00:00Z" },
    });

    const result = await sendMessage(session, { conversationId: CONV, text: "  Bonjour, samedi 10h ?  " });

    expect(result).toMatchObject({ status: "envoyé", message_id: "m-1" });
    const lookup = queries.find((q) => q.table === "conversations") as Query;
    expect(lookup.calls).toContainEqual(["contains", "participants", [ME]]);
    const [insert] = inserts(queries);
    expect(insert.calls).toContainEqual([
      "insert",
      { conversation_id: CONV, sender_id: ME, content: "Bonjour, samedi 10h ?" },
    ]);
  });

  it("met à jour la date du dernier message, sur la conversation de l'utilisateur seulement", async () => {
    const { session, queries } = fakeSession({ conversation: OWN_CONVERSATION, inserted: { id: "m-1", created_at: "t" } });

    await sendMessage(session, { conversationId: CONV, text: "ok" });

    const update = queries.find((q) => q.table === "conversations" && q.calls.some(([m]) => m === "update")) as Query;
    expect(update.calls).toContainEqual(["eq", "id", CONV]);
    expect(update.calls).toContainEqual(["contains", "participants", [ME]]);
  });

  it("n'écrit rien dans la conversation d'un autre, même avec un compte Admin", async () => {
    const { session, queries } = fakeSession({ conversation: null });

    await expect(sendMessage(session, { conversationId: CONV, text: "coucou" })).rejects.toBeInstanceOf(
      ConversationNotFoundError,
    );
    expect(inserts(queries)).toHaveLength(0);
  });

  it("signale un doublon écarté par la base sans le présenter comme une erreur", async () => {
    const { session, queries } = fakeSession({ conversation: OWN_CONVERSATION, inserted: null });

    const result = await sendMessage(session, { conversationId: CONV, text: "ok" });

    expect(result.status).toBe("doublon_ignoré");
    expect(queries.some((q) => q.table === "conversations" && q.calls.some(([m]) => m === "update"))).toBe(false);
  });

  it("traduit le refus des liens par la base", async () => {
    const { session } = fakeSession({
      conversation: OWN_CONVERSATION,
      insertError: { message: "Les liens ne sont pas autorisés dans les messages." },
    });

    await expect(sendMessage(session, { conversationId: CONV, text: "voir toolzy.io" })).rejects.toBeInstanceOf(
      LinksNotAllowedError,
    );
  });

  it("refuse un message vide ou trop long sans toucher à la base", async () => {
    for (const text of ["   ", "x".repeat(MESSAGE_MAX_LENGTH + 1)]) {
      const { session, queries } = fakeSession({ conversation: OWN_CONVERSATION });
      await expect(sendMessage(session, { conversationId: CONV, text })).rejects.toBeInstanceOf(InvalidMessageError);
      expect(queries).toHaveLength(0);
    }
  });
});
