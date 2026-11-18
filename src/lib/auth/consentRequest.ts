import type { TOOLZY_SCOPES } from "./env";

type ToolzyScope = (typeof TOOLZY_SCOPES)[number];

/** Libellé affiché à l'utilisateur pour chaque scope Toolzy. */
export const SCOPE_LABELS: Readonly<Record<ToolzyScope, string>> = Object.freeze({
  "profile:read": "Voir votre profil",
  "reservations:read": "Voir vos réservations",
  "reservations:write": "Gérer vos réservations",
  "messages:read": "Lire vos messages",
  "messages:write": "Envoyer des messages en votre nom",
  "listings:read": "Voir vos annonces",
  "listings:write": "Modifier vos annonces",
});

export type ConsentRequest =
  | { ok: true; clientId: string; redirectHost: string; scopes: ToolzyScope[] }
  | { ok: false };

const isToolzyScope = (scope: string): scope is ToolzyScope => Object.hasOwn(SCOPE_LABELS, scope);

/**
 * Lit la demande d'autorisation transmise à l'écran de consentement.
 *
 * L'AS signe ces paramètres avant de rediriger vers l'écran. On n'affiche rien
 * tant que la signature n'est pas vérifiée côté serveur : sans cela, un lien
 * forgé pourrait montrer une application ou des droits différents de ceux
 * réellement demandés.
 */
export async function readConsentRequest(
  search: string,
  verifySignature: (query: string) => Promise<boolean>,
): Promise<ConsentRequest> {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(query);
  if (!params.has("sig")) return { ok: false };
  if (!(await verifySignature(query))) return { ok: false };

  const clientId = params.get("client_id");
  const redirectHost = hostOf(params.get("redirect_uri"));
  if (!clientId || !redirectHost) return { ok: false };

  const scopes = (params.get("scope") ?? "").split(" ").filter(isToolzyScope);
  return { ok: true, clientId, redirectHost, scopes };
}

function hostOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname || null;
  } catch {
    return null;
  }
}

/** Nom lisible de l'application : son nom déclaré, sinon l'hôte de son identifiant CIMD. */
export function describeApp(clientId: string, clientName: string | undefined): string {
  const name = clientName?.trim();
  if (name) return name;
  return hostOf(clientId) ?? "Une application";
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Phrase indiquant où l'utilisateur sera renvoyé après son choix. Une adresse
 * locale (application installée, comme Claude Code) est décrite en clair ; un
 * domaine en ligne est affiché tel quel pour repérer une application qui se
 * ferait passer pour une autre.
 */
export function describeRedirect(redirectHost: string, appName: string): string {
  return LOOPBACK_HOSTS.has(redirectHost.toLowerCase())
    ? `Vous serez ensuite renvoyé vers ${appName} sur cet ordinateur.`
    : `Vous serez ensuite renvoyé vers ${redirectHost}.`;
}
