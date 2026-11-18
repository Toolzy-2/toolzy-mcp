import type { ReactNode } from "react";
import { Figtree } from "next/font/google";

const figtree = Figtree({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

export const metadata = {
  title: "Toolzy MCP Server",
  description:
    "Serveur MCP officiel de Toolzy : recherche et location d'outils entre particuliers, réservations, messages et annonces avec votre compte.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className={figtree.className} style={{ margin: 0, background: "#f5f5f7", color: "#2b2b3d" }}>
        {children}
      </body>
    </html>
  );
}
