import { jwtVerify, type JWTPayload, type JWTVerifyGetKey, type CryptoKey, type KeyObject } from "jose";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

/** Jeton présent mais inacceptable : la requête doit recevoir un 401, jamais un accès anonyme. */
export class InvalidTokenError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InvalidTokenError";
  }
}

type KeyResolver = JWTVerifyGetKey | (() => Promise<CryptoKey | KeyObject>);

export interface TokenVerifierOptions {
  /** Émetteur attendu : notre serveur d'autorisation. */
  issuer: string;
  /** Audience attendue : l'URL canonique de ce serveur MCP (RFC 8707). */
  audience: string;
  /** Résolution de la clé publique de signature (JWKS). */
  getKey: KeyResolver;
}

const clientIdOf = (payload: JWTPayload): string | undefined => {
  const candidate = payload.azp ?? payload.client_id;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
};

const scopesOf = (payload: JWTPayload): string[] =>
  typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [];

/**
 * Construit le vérificateur de jetons du serveur MCP.
 *
 * - Sans jeton : `undefined` (les outils anonymes restent accessibles).
 * - Avec un jeton : signature, émetteur, audience, expiration et sujet sont
 *   exigés. Toute anomalie lève `InvalidTokenError`.
 */
export function createTokenVerifier(options: TokenVerifierOptions) {
  return async (bearer: string | undefined): Promise<AuthInfo | undefined> => {
    if (bearer === undefined) return undefined;

    let payload: JWTPayload;
    try {
      const verified = await jwtVerify(bearer, options.getKey as JWTVerifyGetKey, {
        issuer: options.issuer,
        audience: options.audience,
        requiredClaims: ["exp", "sub"],
      });
      payload = verified.payload;
    } catch (cause) {
      throw new InvalidTokenError("Jeton d'accès invalide", { cause });
    }

    const clientId = clientIdOf(payload);
    if (!payload.sub || !payload.exp || !clientId) {
      throw new InvalidTokenError("Jeton d'accès incomplet");
    }

    return {
      token: bearer,
      clientId,
      scopes: scopesOf(payload),
      expiresAt: payload.exp,
      resource: new URL(options.audience),
      extra: { userId: payload.sub, issuedAt: payload.iat },
    };
  };
}
