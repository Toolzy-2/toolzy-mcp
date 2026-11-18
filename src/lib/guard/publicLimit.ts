import { createHash } from "node:crypto";
import { PUBLIC_TOOLS } from "../toolCatalog";
import { PUBLIC_RULES, PUBLIC_TOOL_RULES } from "./config";
import { checkRateLimit, type GuardDecision } from "./guard";
import type { DbSource } from "./types";

/**
 * Limite de débit des outils publics (sans connexion), par adresse IP.
 * Appliquée dans la route, avant le serveur MCP : un client qui dépasse
 * reçoit un 429 sans que l'outil ne touche la base.
 */

const PUBLIC_TOOL_NAMES: ReadonlySet<string> = new Set(PUBLIC_TOOLS.map((tool) => tool.name));

/**
 * Clé de comptage d'un client : empreinte de son IP, jamais l'IP en clair.
 * Sur Vercel, `x-real-ip` est posé par la plateforme et ne peut pas être
 * forgé par le client. Sans IP, tous les appels partagent un compteur commun.
 */
export function clientKey(headers: Headers): string {
  const ip = headers.get("x-real-ip")?.trim() || headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (!ip) return "ip:inconnue";
  return `ip:${createHash("sha256").update(ip).digest("hex").slice(0, 32)}`;
}

const toolCallName = (message: unknown): string | undefined => {
  if (typeof message !== "object" || message === null) return undefined;
  const { method, params } = message as { method?: unknown; params?: unknown };
  if (method !== "tools/call" || typeof params !== "object" || params === null) return undefined;
  const { name } = params as { name?: unknown };
  return typeof name === "string" ? name : undefined;
};

/** Noms des outils publics appelés par la requête (un par appel, lots compris). */
export function publicToolCalls(body: unknown): string[] {
  const messages = Array.isArray(body) ? body : [body];
  return messages
    .map(toolCallName)
    .filter((name): name is string => name !== undefined && PUBLIC_TOOL_NAMES.has(name));
}

/**
 * Compte chaque appel public et s'arrête au premier refus. Base de comptage
 * indisponible : appel laissé passer (lecture seule), voir checkRateLimit.
 */
export async function checkPublicCalls(
  source: DbSource,
  key: string,
  tools: readonly string[],
  now: Date = new Date(),
): Promise<GuardDecision> {
  for (const tool of tools) {
    const rules = [...PUBLIC_RULES, ...(PUBLIC_TOOL_RULES[tool] ?? [])];
    const decision = await checkRateLimit(source, key, tool, now, rules);
    if (decision.kind !== "allow") return decision;
  }
  return { kind: "allow" };
}

const idOf = (message: unknown): unknown =>
  typeof message === "object" && message !== null && "id" in message ? (message as { id: unknown }).id : null;

/** 429 avec Retry-After et une erreur JSON-RPC par message, que l'assistant peut relayer. */
export function rateLimitedResponse(body: unknown, decision: Exclude<GuardDecision, { kind: "allow" }>): Response {
  const errorFor = (message: unknown) => ({
    jsonrpc: "2.0",
    id: idOf(message),
    error: { code: -32000, message: decision.message },
  });
  const payload = Array.isArray(body) ? body.map(errorFor) : errorFor(body);
  const retryAfter = decision.kind === "rate_limited" ? String(decision.retryAfterSeconds) : "60";
  return new Response(JSON.stringify(payload), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": retryAfter },
  });
}
