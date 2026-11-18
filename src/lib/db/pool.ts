import { Pool } from "pg";

/**
 * Pool Postgres partagé du schéma `mcp_auth` (serveur d'autorisation, limite
 * de débit, journal d'audit). Sur Vercel chaque instance serverless garde son
 * propre pool : on le garde petit pour ne pas saturer le pooler Supabase.
 */
const POOL_MAX_CONNECTIONS = 3;
const IDLE_TIMEOUT_MS = 10_000;
const CONNECTION_TIMEOUT_MS = 5_000;

let pool: Pool | null = null;

/** Pool paresseux : rien n'est lu ni connecté au moment du build ou de l'import. */
export function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.MCP_AUTH_DATABASE_URL;
  if (!connectionString) throw new Error("Variable d'environnement manquante : MCP_AUTH_DATABASE_URL");
  const created = new Pool({
    connectionString,
    max: POOL_MAX_CONNECTIONS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  });
  // Sans écouteur, l'erreur d'une connexion inactive ferait tomber le processus.
  created.on("error", (error) => console.error("[db] connexion inactive en erreur", error.message));
  pool = created;
  return pool;
}
