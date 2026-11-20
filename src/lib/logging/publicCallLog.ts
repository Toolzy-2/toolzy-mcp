import { resolveDb, type DbSource } from "../guard/types";
import { currentRequestMeta } from "./requestMeta";

/**
 * Journal des appels d'outils publics dans `public.mcp_logs`, la table lue par
 * la page « MCP logs » de l'admin. Même format que l'ancien serveur
 * (www.toolzy.io/api/mcp), avec `endpoint` pour distinguer les deux.
 * Les outils du compte ne passent pas ici : ils ont leur journal d'audit
 * (mcp_auth.mcp_audit_log), sans arguments.
 */
export const MCP_ENDPOINT = "mcp.toolzy.io";

interface ToolResult {
  readonly content?: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
  readonly isError?: boolean;
}

const INSERT_SQL = `
  insert into public.mcp_logs
    (tool_name, params, result_count, duration_ms, client_ip, user_agent, origin, error, endpoint)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
`;

const firstText = (result: ToolResult): string | undefined =>
  result.content?.find((part) => part.type === "text")?.text;

const parseJson = (text: string | undefined): unknown => {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** Nombre de résultats, calculé comme l'ancien serveur pour garder des statistiques comparables. */
export function resultCountOf(tool: string, result: ToolResult): number | null {
  if (result.isError) return 0;
  const payload = parseJson(firstText(result));
  if (typeof payload !== "object" || payload === null) return 0;
  if (tool === "search_tools") {
    const results = (payload as { results?: unknown }).results;
    return Array.isArray(results) ? results.length : 0;
  }
  if (tool === "get_tool_details") return 1;
  if (tool === "check_availability") return (payload as { available?: unknown }).available === true ? 1 : 0;
  return null;
}

const errorOf = (result: ToolResult): string | null => (result.isError ? (firstText(result) ?? "Erreur") : null);

/**
 * Enveloppe le gestionnaire d'un outil public : mesure la durée, puis écrit une
 * ligne dans mcp_logs sans attendre. Un échec d'écriture ne touche jamais la réponse.
 */
export function withPublicCallLog<Args extends object, R extends ToolResult>(
  tool: string,
  source: DbSource,
  handler: (args: Args) => Promise<R>,
): (args: Args) => Promise<R> {
  return async (args) => {
    const startedAt = Date.now();
    const meta = currentRequestMeta();
    const write = (result: R | null, thrown: unknown) => {
      const values = [
        tool,
        JSON.stringify(args ?? {}),
        result ? resultCountOf(tool, result) : null,
        Date.now() - startedAt,
        meta.clientIp,
        meta.userAgent,
        meta.origin,
        thrown !== undefined ? String(thrown) : result ? errorOf(result) : null,
        MCP_ENDPOINT,
      ];
      void Promise.resolve()
        .then(() => resolveDb(source).query(INSERT_SQL, values))
        .catch((error: unknown) => console.error("[mcp_logs] écriture impossible", (error as Error)?.message));
    };
    try {
      const result = await handler(args);
      write(result, undefined);
      return result;
    } catch (error) {
      write(null, error);
      throw error;
    }
  };
}
