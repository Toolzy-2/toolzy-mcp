/**
 * Liste blanche des hôtes autorisés à se présenter comme client OAuth via un
 * document de métadonnées (CIMD). Sans elle, n'importe quel site pourrait
 * demander un accès au compte d'un utilisateur ; fermée par défaut.
 */
export function parseAllowedHosts(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);
}

/** Longueur maximale d'un client_id, partagée avec /api/connected-apps et la page toolzy.io. */
export const MAX_CLIENT_ID_LENGTH = 2048;

export function isAllowedClientMetadataUrl(
  clientIdUrl: string,
  allowedHosts: readonly string[],
): boolean {
  if (clientIdUrl.length > MAX_CLIENT_ID_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(clientIdUrl);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    allowedHosts.includes(url.hostname.toLowerCase())
  );
}
