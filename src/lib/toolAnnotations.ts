import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

/**
 * Annotations exigées par les annuaires (Claude : `title` + `readOnlyHint`
 * ou `destructiveHint` sur chaque outil). Elles pilotent aussi les
 * autorisations : un outil en lecture peut s'exécuter sans confirmation,
 * un outil d'écriture demande toujours l'accord de l'utilisateur.
 */

/** Outil qui ne fait que lire des données Toolzy. */
export function readOnlyTool(title: string): ToolAnnotations {
  return { title, readOnlyHint: true, destructiveHint: false, openWorldHint: false };
}

/**
 * Outil qui écrit au nom de l'utilisateur. Marqué destructif pour que
 * l'assistant demande systématiquement l'accord avant l'appel.
 */
export function writeTool(
  title: string,
  options: { idempotent: boolean; reachesOthers: boolean },
): ToolAnnotations {
  return {
    title,
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: options.idempotent,
    openWorldHint: options.reachesOthers,
  };
}
