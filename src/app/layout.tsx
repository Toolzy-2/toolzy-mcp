import type { ReactNode } from "react";

export const metadata = {
  title: "Toolzy MCP Server",
  description:
    "Serveur MCP officiel de Toolzy — recherche et location d'outils entre particuliers en France.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          fontFamily:
            "Figtree, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#091747",
          color: "#f6f8fb",
        }}
      >
        {children}
      </body>
    </html>
  );
}
