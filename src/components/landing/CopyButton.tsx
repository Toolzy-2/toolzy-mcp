"use client";

import { useState } from "react";
import styles from "./landing.module.css";

/** Copie un texte dans le presse-papiers ; échec silencieux pour l'utilisateur, l'adresse reste visible. */
export function CopyButton({ text, variant = "primary" }: { text: string; variant?: "primary" | "dark" }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("[landing] copie impossible", error);
    }
  };

  return (
    <button type="button" className={`${styles.button} ${styles[variant]}`} onClick={copy}>
      {copied ? "Copié" : "Copier"}
    </button>
  );
}
