import { WRITE_TOOLS } from "./config";
import { evaluateCounts, incrementCounters, rulesFor } from "./rateLimit";
import { resolveDb, type DbSource } from "./types";

export type GuardDecision =
  | { readonly kind: "allow" }
  | { readonly kind: "rate_limited"; readonly message: string; readonly retryAfterSeconds: number }
  | { readonly kind: "unavailable"; readonly message: string };

const UNAVAILABLE_MESSAGE =
  "Cette action est momentanément indisponible depuis un assistant. Réessayez dans quelques minutes.";

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

/** Durée d'attente lisible : « 45 secondes », « 43 minutes », « 13 h 43 min ». */
export function formatWait(seconds: number): string {
  if (seconds < 60) return plural(seconds, "seconde");
  const minutes = Math.ceil(seconds / 60);
  if (minutes <= 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * Compte l'appel et décide s'il peut avoir lieu. Base indisponible :
 * refus pour les outils d'écriture (fail-closed), passage pour la lecture
 * (fail-open). Chaque tentative compte, même refusée.
 */
export async function checkRateLimit(
  source: DbSource,
  userId: string,
  tool: string,
  now: Date = new Date(),
): Promise<GuardDecision> {
  try {
    const counts = await incrementCounters(resolveDb(source), userId, rulesFor(tool), now);
    const decision = evaluateCounts(counts, now);
    if (decision.allowed) return { kind: "allow" };
    return {
      kind: "rate_limited",
      retryAfterSeconds: decision.retryAfterSeconds,
      message:
        `Limite atteinte : ${decision.rule.label} depuis un assistant. ` +
        `Réessayez dans ${formatWait(decision.retryAfterSeconds)}.`,
    };
  } catch (error) {
    const failClosed = WRITE_TOOLS.has(tool);
    console.error(
      `[guard] limite de débit invérifiable pour ${tool} (${failClosed ? "refus" : "appel laissé passer"})`,
      error instanceof Error ? error.message : error,
    );
    return failClosed ? { kind: "unavailable", message: UNAVAILABLE_MESSAGE } : { kind: "allow" };
  }
}
