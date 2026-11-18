import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserSession } from "../../lib/auth/userSession";
import { listMyReservations, RESERVATION_ROLES } from "../my-reservations";
import { ConversationNotFoundError, getConversationMessages, listMyConversations } from "../my-messages";
import { accountTypeOf } from "../whoami";

// ── Cloisonnement par utilisateur ─────────────────────────────────────────────
//
// La RLS donne aux comptes Admin la lecture des données de tous les
// utilisateurs. Le MCP traite un admin comme un utilisateur classique : chaque
// requête doit donc porter elle-même un filtre sur l'utilisateur connecté.

const ME = "11111111-1111-1111-1111-111111111111";

type Call = [method: string, ...args: unknown[]];
interface Query {
  table: string;
  calls: Call[];
}

/** Faux client : enregistre chaque requête et renvoie les lignes prévues par table. */
function fakeDb(rowsByTable: Record<string, unknown[]> = {}) {
  const queries: Query[] = [];
  const db = {
    from(table: string) {
      const query: Query = { table, calls: [] };
      queries.push(query);
      const result = () => {
        const rows = rowsByTable[table] ?? [];
        const single = query.calls.some(([m]) => m === "maybeSingle");
        return { data: single ? (rows[0] ?? null) : rows, error: null };
      };
      const builder: unknown = new Proxy(
        {},
        {
          get(_target, method: string) {
            if (method === "then") {
              return (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
            }
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
    email: "moi@example.com",
    profile: { prenom: "Moi", role: "Admin", is_super_loueur: false },
    db: db as unknown as SupabaseClient,
  };
  return { session, queries };
}

const filtersOn = (query: Query) =>
  query.calls.filter(([m]) => ["eq", "or", "contains", "in"].includes(m));

const isScopedToMe = (query: Query) =>
  filtersOn(query).some(([method, column, value]) => {
    if (method === "eq") return (column === "user_id" || column === "owner_id" || column === "id") && value === ME;
    if (method === "or") return column === `user_id.eq.${ME},owner_id.eq.${ME}`;
    if (method === "contains") return column === "participants" && Array.isArray(value) && value.includes(ME);
    return false;
  });

describe("list_my_reservations — toujours filtré sur l'utilisateur", () => {
  for (const role of RESERVATION_ROLES) {
    it(`rôle « ${role} »`, async () => {
      const { session, queries } = fakeDb();
      await listMyReservations(session, { role });

      const reservations = queries.filter((q) => q.table === "reservations");
      expect(reservations).toHaveLength(1);
      expect(isScopedToMe(reservations[0])).toBe(true);
    });
  }
});

describe("list_my_conversations — toujours filtré sur l'utilisateur", () => {
  it("ne liste que les conversations dont il est participant", async () => {
    const { session, queries } = fakeDb({
      conversations: [{ id: "c-1", participants: [ME, "x"], last_message_at: null, tools: null }],
    });
    await listMyConversations(session, {});

    const conversations = queries.filter((q) => q.table === "conversations");
    expect(conversations.every(isScopedToMe)).toBe(true);
    // Les messages ne sont lus que pour les conversations déjà filtrées.
    for (const q of queries.filter((q) => q.table === "messages")) {
      const scope = filtersOn(q).find(([m, column]) => column === "conversation_id" && (m === "eq" || m === "in"));
      expect(scope).toBeDefined();
      const ids = scope?.[0] === "in" ? (scope[2] as string[]) : [scope?.[2]];
      expect(ids).toEqual(["c-1"]);
    }
  });
});

describe("get_conversation_messages — conversation d'autrui introuvable", () => {
  it("filtre la conversation sur les participants", async () => {
    const { session, queries } = fakeDb({
      conversations: [{ id: "c-1", participants: [ME], last_message_at: null, tools: null }],
    });
    await getConversationMessages(session, { conversationId: "c-1" });

    expect(isScopedToMe(queries.find((q) => q.table === "conversations") as Query)).toBe(true);
  });

  it("ne lit aucun message quand la conversation n'est pas la sienne", async () => {
    const { session, queries } = fakeDb({ conversations: [] });

    await expect(getConversationMessages(session, { conversationId: "c-2" })).rejects.toBeInstanceOf(
      ConversationNotFoundError,
    );
    expect(queries.some((q) => q.table === "messages")).toBe(false);
  });
});

describe("whoami — le rôle interne n'est pas exposé", () => {
  it("présente un admin comme un particulier", () => {
    expect(accountTypeOf("Admin")).toBe("particulier");
    expect(accountTypeOf("Owner")).toBe("particulier");
    expect(accountTypeOf("Renter")).toBe("particulier");
    expect(accountTypeOf(null)).toBe("particulier");
    expect(accountTypeOf("OwnerPro")).toBe("professionnel");
  });
});
