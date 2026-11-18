import { getPool } from "../db/pool";
import { writeAudit, type AuditEntry } from "./audit";
import { checkRateLimit, type GuardDecision } from "./guard";

export { errorKindOf, type AuditEntry, type AuditStatus } from "./audit";
export type { GuardDecision } from "./guard";

/** Limite de débit d'un appel d'outil connecté, sur le pool partagé. */
export const guardCall = (userId: string, tool: string): Promise<GuardDecision> =>
  checkRateLimit(getPool, userId, tool);

/** Journal d'audit d'un appel d'outil connecté, sur le pool partagé. Ne lève jamais. */
export const auditCall = (entry: AuditEntry): Promise<void> => writeAudit(getPool, entry);
