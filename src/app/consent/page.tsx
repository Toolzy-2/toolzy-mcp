import type { Metadata } from "next";
import { headers } from "next/headers";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { AuthCard, authStyles as styles } from "@/components/auth/AuthCard";
import { getAuth } from "@/lib/auth/auth";
import { describeApp, describeRedirect, readConsentRequest, SCOPE_LABELS } from "@/lib/auth/consentRequest";
import { getAuthEnv } from "@/lib/auth/env";
import { ConsentForm } from "./ConsentForm";

// Demande d'autorisation propre à chaque visite : jamais pré-générée au build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Autoriser une application | Toolzy",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Reconstruit la chaîne de requête telle que reçue, paramètres répétés compris. */
function toQueryString(params: Record<string, string | string[] | undefined>): string {
  const entries = Object.entries(params).flatMap(([key, value]) =>
    (Array.isArray(value) ? value : value === undefined ? [] : [value]).map((v) => [key, v]),
  );
  return new URLSearchParams(entries).toString();
}

function Invalid() {
  return (
    <AuthCard>
      <h1 className={styles.title}>Demande expirée</h1>
      <p className={styles.subtitle}>
        Ce lien d&apos;autorisation n&apos;est plus valable. Relancez la connexion depuis votre assistant.
      </p>
    </AuthCard>
  );
}

/**
 * Écran de consentement de l'AS. Tout ce qui est affiché vient d'une demande
 * dont la signature a été vérifiée ici, côté serveur, et d'une session valide.
 */
export default async function ConsentPage({ searchParams }: { searchParams: SearchParams }) {
  const query = toQueryString(await searchParams);
  const { BETTER_AUTH_SECRET } = getAuthEnv();
  const request = await readConsentRequest(query, (query) =>
    verifyOAuthQueryParams(query, BETTER_AUTH_SECRET),
  );
  if (!request.ok) return <Invalid />;

  const auth = getAuth();
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) return <Invalid />;

  const client = await auth.api
    .getOAuthClientPublic({ query: { client_id: request.clientId }, headers: requestHeaders })
    .catch((error: unknown) => {
      console.error("[consent] client OAuth introuvable", error);
      return null;
    });
  if (!client) return <Invalid />;

  const appName = describeApp(request.clientId, client.client_name);

  return (
    <AuthCard>
      <h1 className={styles.title}>Autoriser l&apos;accès</h1>
      <p className={styles.app}>
        <strong>{appName}</strong> souhaite accéder à votre compte
        Toolzy ({session.user.name}) pour :
      </p>
      <ul className={styles.scopes}>
        {request.scopes.map((scope) => (
          <li key={scope}>{SCOPE_LABELS[scope]}</li>
        ))}
      </ul>
      <p className={styles.note}>{describeRedirect(request.redirectHost, appName)}</p>
      <ConsentForm />
    </AuthCard>
  );
}
