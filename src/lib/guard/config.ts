/**
 * Limites de débit des outils connectés du MCP, par utilisateur, en fenêtres
 * fixes alignées sur l'époque UTC (minute, heure, jour). Seule source de ces
 * valeurs.
 */
export interface RateLimitRule {
  /** Nom du compteur en base (unique). */
  readonly bucket: string;
  readonly windowSeconds: number;
  /** Nombre d'appels autorisés dans la fenêtre, inclus. */
  readonly max: number;
  /** Fin de phrase montrée à l'utilisateur : « Limite atteinte : {label} ». */
  readonly label: string;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Tous les outils connectés confondus. */
export const GLOBAL_RULE: RateLimitRule = Object.freeze({
  bucket: "connected:minute",
  windowSeconds: MINUTE,
  max: 120,
  label: "120 appels par minute",
});

/** Limites propres à certains outils, en plus de la règle globale. */
export const RATE_LIMIT_RULES: Readonly<Record<string, readonly RateLimitRule[]>> = Object.freeze({
  send_message: Object.freeze([
    Object.freeze({ bucket: "send_message:hour", windowSeconds: HOUR, max: 20, label: "20 messages par heure" }),
    Object.freeze({ bucket: "send_message:day", windowSeconds: DAY, max: 100, label: "100 messages par jour" }),
  ]),
  update_my_listing: Object.freeze([
    Object.freeze({
      bucket: "update_my_listing:hour",
      windowSeconds: HOUR,
      max: 30,
      label: "30 modifications d'annonce par heure",
    }),
  ]),
});

/**
 * Outils d'écriture : si la limite ne peut pas être vérifiée (base
 * indisponible), ils sont refusés (fail-closed). Les autres passent (fail-open).
 */
export const WRITE_TOOLS: ReadonlySet<string> = new Set(["send_message", "update_my_listing"]);

/**
 * Outils publics (sans connexion), par adresse IP, tous outils publics
 * confondus. Bornent l'aspiration du catalogue par un même client ; une
 * conversation normale fait une dizaine d'appels.
 */
export const PUBLIC_RULES: readonly RateLimitRule[] = Object.freeze([
  Object.freeze({ bucket: "public:minute", windowSeconds: MINUTE, max: 30, label: "30 recherches par minute" }),
  Object.freeze({ bucket: "public:hour", windowSeconds: HOUR, max: 300, label: "300 recherches par heure" }),
  Object.freeze({ bucket: "public:day", windowSeconds: DAY, max: 1000, label: "1 000 recherches par jour" }),
]);

/** Limites plus strictes sur la fiche détaillée d'une annonce, en plus des règles publiques. */
export const PUBLIC_TOOL_RULES: Readonly<Record<string, readonly RateLimitRule[]>> = Object.freeze({
  get_tool_details: Object.freeze([
    Object.freeze({
      bucket: "get_tool_details:hour",
      windowSeconds: HOUR,
      max: 100,
      label: "100 fiches d'annonce par heure",
    }),
    Object.freeze({
      bucket: "get_tool_details:day",
      windowSeconds: DAY,
      max: 300,
      label: "300 fiches d'annonce par jour",
    }),
  ]),
});
