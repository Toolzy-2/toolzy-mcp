import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Client Supabase lazy (créé à la première utilisation, pas à l'import).
 *
 * Important : l'initialisation paresseuse évite un crash au build Next.js /
 * au démarrage stdio quand les variables d'env ne sont pas encore résolues.
 * On utilise la clé ANON (jamais la service_role) : la lecture publique des
 * annonces `moderation = validated` est protégée par les RLS Supabase.
 */
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required");
  }

  client = createClient(url, key);
  return client;
}
