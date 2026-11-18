/**
 * Outils qui exigent une connexion, avec les scopes requis.
 * Tout outil absent de cette table est public.
 */
export const PROTECTED_TOOLS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  whoami: ["profile:read"],
  list_my_reservations: ["reservations:read"],
  list_my_conversations: ["messages:read"],
  get_conversation_messages: ["messages:read"],
});

export type AccessDecision =
  | { kind: "allow" }
  | { kind: "unauthenticated"; scopes: string[] }
  | { kind: "insufficient_scope"; scopes: string[] };

const calledToolName = (message: unknown): string | undefined => {
  if (typeof message !== "object" || message === null) return undefined;
  const { method, params } = message as { method?: unknown; params?: unknown };
  if (method !== "tools/call" || typeof params !== "object" || params === null) return undefined;
  const { name } = params as { name?: unknown };
  return typeof name === "string" ? name : undefined;
};

/**
 * Décide du sort d'une requête JSON-RPC (ou d'un lot) avant de la confier au
 * serveur MCP. `grantedScopes` vaut `undefined` quand aucun jeton n'est fourni.
 */
export function decideAccess(
  body: unknown,
  grantedScopes: readonly string[] | undefined,
): AccessDecision {
  const messages = Array.isArray(body) ? body : [body];
  const required = [
    ...new Set(
      messages
        .map(calledToolName)
        .flatMap((name) => (name && PROTECTED_TOOLS[name] ? PROTECTED_TOOLS[name] : [])),
    ),
  ];
  if (required.length === 0) return { kind: "allow" };
  if (grantedScopes === undefined) return { kind: "unauthenticated", scopes: required };

  const missing = required.filter((scope) => !grantedScopes.includes(scope));
  return missing.length === 0 ? { kind: "allow" } : { kind: "insufficient_scope", scopes: missing };
}
