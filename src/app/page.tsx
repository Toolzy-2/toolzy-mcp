const ENDPOINT = "https://mcp.toolzy.io/api/mcp";

const TOOLS = [
  {
    name: "search_tools",
    desc: "Rechercher des outils à louer par texte, ville, code postal, prix, livraison.",
  },
  {
    name: "get_tool_details",
    desc: "Détails complets d'une annonce (prix, caractéristiques, photos).",
  },
  {
    name: "check_availability",
    desc: "Vérifier la disponibilité pour des dates et calculer le prix total.",
  },
];

export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "64px 24px" }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>
        <span style={{ color: "#F26F0A" }}>Toolzy</span> MCP Server
      </h1>
      <p style={{ fontSize: 18, opacity: 0.85, marginTop: 0 }}>
        Serveur Model Context Protocol officiel de{" "}
        <a href="https://www.toolzy.io" style={{ color: "#F26F0A" }}>
          Toolzy
        </a>{" "}
        — la marketplace française de location d'outils entre particuliers.
        Permet aux assistants IA de rechercher des outils, consulter les
        annonces et vérifier les disponibilités.
      </p>

      <h2 style={{ fontSize: 20, marginTop: 40 }}>Endpoint</h2>
      <pre
        style={{
          background: "#0d1f52",
          padding: 16,
          borderRadius: 8,
          overflowX: "auto",
        }}
      >
        <code>{ENDPOINT}</code>
      </pre>
      <p style={{ opacity: 0.7, fontSize: 14 }}>
        Transport : Streamable HTTP (stateless). Aucune authentification requise
        (lecture seule des annonces publiques).
      </p>

      <h2 style={{ fontSize: 20, marginTop: 40 }}>Tools disponibles</h2>
      <ul style={{ lineHeight: 1.7, paddingLeft: 20 }}>
        {TOOLS.map((t) => (
          <li key={t.name}>
            <code style={{ color: "#F26F0A" }}>{t.name}</code> — {t.desc}
          </li>
        ))}
      </ul>

      <p style={{ opacity: 0.5, fontSize: 13, marginTop: 48 }}>
        © {"2026"} Toolzy · <a href="https://www.toolzy.io" style={{ color: "inherit" }}>toolzy.io</a>
      </p>
    </main>
  );
}
