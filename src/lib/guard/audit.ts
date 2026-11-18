import { resolveDb, type DbSource } from "./types";

export type AuditStatus = "ok" | "error" | "rate_limited" | "denied";

/**
 * Ligne du journal d'audit. Volontairement fermée : AUCUN contenu de message,
 * AUCUN argument d'outil, AUCUN jeton. Ne pas y ajouter de champ libre.
 */
export interface AuditEntry {
  readonly userId: string;
  readonly clientId: string | null;
  readonly tool: string;
  readonly status: AuditStatus;
  readonly durationMs: number;
  /** Nom de la classe d'erreur (jamais son message). */
  readonly errorKind: string | null;
}

const MAX_CLIENT_ID_LENGTH = 512;
const MAX_TOOL_LENGTH = 64;
const MAX_DURATION_MS = 2_147_483_647;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

const INSERT_SQL = `
insert into mcp_auth.mcp_audit_log (user_id, client_id, tool, status, duration_ms, error_kind)
values ($1, $2, $3, $4, $5, $6)`;

/**
 * Nom de la classe d'erreur, sans son message. Un nom qui n'est pas un simple
 * identifiant est remplacé par « Error » : rien de libre n'entre au journal.
 */
export function errorKindOf(error: unknown): string {
  if (!(error instanceof Error)) return "NonError";
  const candidates = [error.name, error.constructor?.name];
  const specific = candidates.find((name) => typeof name === "string" && name !== "Error" && IDENTIFIER.test(name));
  return specific ?? "Error";
}

const safeErrorKind = (kind: string | null) => (kind === null ? null : IDENTIFIER.test(kind) ? kind : "Error");

const clampDuration =(ms: number) => Math.min(MAX_DURATION_MS, Math.max(0, Math.round(Number.isFinite(ms) ? ms : 0)));

/** Écrit une ligne d'audit. Ne lève jamais : un échec est seulement journalisé. */
export async function writeAudit(source: DbSource, entry: AuditEntry): Promise<void> {
  try {
    await resolveDb(source).query(INSERT_SQL, [
      entry.userId,
      entry.clientId === null ? null : entry.clientId.slice(0, MAX_CLIENT_ID_LENGTH),
      entry.tool.slice(0, MAX_TOOL_LENGTH),
      entry.status,
      clampDuration(entry.durationMs),
      safeErrorKind(entry.errorKind),
    ]);
  } catch (error) {
    console.error(
      `[audit] écriture impossible (${entry.tool}, ${entry.status})`,
      error instanceof Error ? error.message : error,
    );
  }
}
