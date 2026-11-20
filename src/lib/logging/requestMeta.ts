import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Informations sur la requête HTTP en cours, transmises aux outils MCP sans
 * passer par leurs arguments. Posées par la route, lues par le journal des
 * appels publics.
 */
export interface RequestMeta {
  readonly clientIp: string | null;
  readonly userAgent: string | null;
  readonly origin: string | null;
}

const storage = new AsyncLocalStorage<RequestMeta>();

/** Lit les en-têtes utiles. `x-real-ip` est posé par Vercel et ne peut pas être forgé. */
export function requestMetaOf(headers: Headers): RequestMeta {
  const ip = headers.get("x-real-ip")?.trim() || headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  return {
    clientIp: ip,
    userAgent: headers.get("user-agent"),
    origin: headers.get("origin"),
  };
}

export function runWithRequestMeta<T>(meta: RequestMeta, fn: () => T): T {
  return storage.run(meta, fn);
}

/** Métadonnées de la requête en cours, ou des valeurs vides hors requête (tests, stdio). */
export function currentRequestMeta(): RequestMeta {
  return storage.getStore() ?? { clientIp: null, userAgent: null, origin: null };
}
