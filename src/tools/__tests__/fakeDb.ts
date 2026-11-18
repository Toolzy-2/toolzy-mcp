import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserSession } from "../../lib/auth/userSession";

export const ME = "11111111-1111-1111-1111-111111111111";

export type Call = [method: string, ...args: unknown[]];
export interface Query {
  table: string;
  calls: Call[];
}

export const has = (query: Query, method: string) => query.calls.some(([m]) => m === method);
export const operation = (query: Query) =>
  (["insert", "update", "delete"] as const).find((m) => has(query, m)) ?? "select";

export type Resolver = (query: Query) => { data: unknown; error: { message: string } | null };

/**
 * Faux client Supabase : chaque requête construite est enregistrée, et sa
 * réponse est donnée par `resolve`. Sert à vérifier le cloisonnement des
 * requêtes sans base réelle.
 */
export function fakeSession(resolve: Resolver, role = "Admin") {
  const queries: Query[] = [];
  const db = {
    from(table: string) {
      const query: Query = { table, calls: [] };
      queries.push(query);
      const builder: unknown = new Proxy(
        {},
        {
          get(_t, method: string) {
            if (method === "then") {
              return (resolveThen: (v: unknown) => unknown) => Promise.resolve(resolve(query)).then(resolveThen);
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
    email: null,
    profile: { prenom: "Moi", role, is_super_loueur: false },
    db: db as unknown as SupabaseClient,
  };
  return { session, queries };
}
