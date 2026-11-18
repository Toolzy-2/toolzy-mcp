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

export function isAllowedClientMetadataUrl(
  clientIdUrl: string,
  allowedHosts: readonly string[],
): boolean {
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
