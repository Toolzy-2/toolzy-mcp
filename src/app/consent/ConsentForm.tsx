"use client";

import { useState } from "react";
import { authStyles as styles } from "@/components/auth/AuthCard";
import { authClient } from "@/lib/auth/client";

/**
 * Boutons de réponse. Le plugin client joint lui-même la demande signée
 * (oauth_query) lue dans l'URL ; le serveur la vérifie à nouveau.
 */
export function ConsentForm() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const answer = async (accept: boolean) => {
    setError(false);
    setLoading(true);
    const { error: failure } = await authClient.oauth2.consent({ accept });
    if (failure) {
      setError(true);
      setLoading(false);
    }
  };

  return (
    <>
      <button id="autoriser" className={styles.primary} onClick={() => answer(true)} disabled={loading}>
        <span>Autoriser</span>
      </button>
      <button id="refuser" className={styles.secondary} onClick={() => answer(false)} disabled={loading}>
        <span>Refuser</span>
      </button>
      {error && (
        <p className={styles.error} role="alert" style={{ marginTop: 16 }}>
          Réponse impossible pour le moment. Réessayez.
        </p>
      )}
    </>
  );
}
