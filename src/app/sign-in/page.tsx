"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AuthCard, authStyles as styles } from "@/components/auth/AuthCard";
import { authClient } from "@/lib/auth/client";

/**
 * Point d'entrée de la connexion côté AS. Une seule méthode existe : le compte
 * Toolzy. On part donc directement vers l'écran de connexion Toolzy, sans clic
 * intermédiaire. Le plugin client transmet la demande d'autorisation signée.
 */
export default function SignInPage() {
  const [error, setError] = useState(false);
  const started = useRef(false);

  const start = useCallback(async () => {
    setError(false);
    const { error: failure } = await authClient.signIn.social({
      provider: "supabase",
      callbackURL: "/consent",
    });
    if (failure) setError(true);
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
  }, [start]);

  return (
    <AuthCard>
      <h1 className={styles.title}>Se connecter</h1>
      {error ? (
        <>
          <p className={styles.error} role="alert" style={{ marginBottom: 16 }}>
            Connexion impossible pour le moment.
          </p>
          <button id="connexion" className={styles.primary} onClick={start}>
            <span>Réessayer</span>
          </button>
        </>
      ) : (
        <p className={styles.subtitle}>Redirection vers la connexion Toolzy...</p>
      )}
    </AuthCard>
  );
}
