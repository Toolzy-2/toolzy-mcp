import type { CSSProperties, ReactNode } from "react";
import { CONNECTED_GROUPS, PUBLIC_TOOLS, type CatalogTool } from "@/lib/toolCatalog";

const ENDPOINT = "https://mcp.toolzy.io/api/mcp";
const ORANGE = "#F26F0A";
const CONNECTED_APPS_URL = "https://www.toolzy.io/parametres/applications-connectees";

const codeBlock: CSSProperties = {
  background: "#0d1f52",
  padding: 16,
  borderRadius: 8,
  overflowX: "auto",
  fontSize: 14,
};
const muted: CSSProperties = { opacity: 0.7, fontSize: 14, lineHeight: 1.6 };
const h2: CSSProperties = { fontSize: 22, marginTop: 48, marginBottom: 8 };
const h3: CSSProperties = { fontSize: 16, marginTop: 24, marginBottom: 4, opacity: 0.9 };
const link: CSSProperties = { color: ORANGE };

function ToolList({ tools }: { tools: CatalogTool[] }) {
  return (
    <ul style={{ lineHeight: 1.7, paddingLeft: 20, marginTop: 4 }}>
      {tools.map((tool) => (
        <li key={tool.name}>
          <code style={{ color: ORANGE }}>{tool.name}</code> : {tool.desc}
          {tool.write && (
            <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.75 }}>(demande votre accord)</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <h3 style={h3}>{title}</h3>
      {children}
    </>
  );
}

export default function Home() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "64px 24px" }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>
        <span style={{ color: ORANGE }}>Toolzy</span> MCP Server
      </h1>
      <p style={{ fontSize: 18, opacity: 0.85, marginTop: 0, lineHeight: 1.6 }}>
        Le serveur Model Context Protocol officiel de{" "}
        <a href="https://www.toolzy.io" style={link}>
          Toolzy
        </a>
        , la marketplace de location d&apos;outils entre particuliers. Sans compte, un assistant IA peut chercher
        des outils et vérifier leurs disponibilités. Avec votre compte Toolzy, il peut aussi suivre vos
        réservations, lire et envoyer vos messages et gérer le tarif de vos annonces.
      </p>

      <h2 style={h2}>Adresse du serveur</h2>
      <pre style={codeBlock}>
        <code>{ENDPOINT}</code>
      </pre>
      <p style={muted}>
        Transport Streamable HTTP. Les outils publics fonctionnent sans connexion ; les outils liés à votre compte
        demandent une connexion OAuth 2.1 à votre compte Toolzy.
      </p>

      <h2 style={h2}>Outils publics, sans connexion</h2>
      <ToolList tools={PUBLIC_TOOLS} />

      <h2 style={h2}>Outils de votre compte Toolzy</h2>
      <p style={muted}>
        Disponibles une fois votre compte connecté. L&apos;assistant n&apos;accède qu&apos;à vos propres données.
      </p>
      {CONNECTED_GROUPS.map((group) => (
        <div key={group.title}>
          <h3 style={h3}>{group.title}</h3>
          <ToolList tools={group.tools} />
        </div>
      ))}

      <h2 style={h2}>Connecter votre assistant</h2>
      <Step title="Claude Code">
        <pre style={codeBlock}>
          <code>{`claude mcp add --transport http toolzy ${ENDPOINT}`}</code>
        </pre>
        <p style={muted}>
          Puis <code>/mcp</code>, choisissez <code>toolzy</code> et « Authenticate ».
        </p>
      </Step>
      <Step title="Claude (claude.ai)">
        <p style={muted}>
          Dans les réglages des connecteurs, ajoutez un connecteur personnalisé avec l&apos;adresse du serveur.
        </p>
      </Step>
      <Step title="ChatGPT">
        <p style={muted}>
          Dans les réglages des applications et connecteurs, ajoutez un connecteur avec l&apos;adresse du serveur.
        </p>
      </Step>
      <p style={muted}>
        À la première utilisation d&apos;un outil de votre compte, une fenêtre s&apos;ouvre sur toolzy.io : vous vous
        connectez comme d&apos;habitude (Google ou e-mail), puis vous choisissez d&apos;autoriser l&apos;assistant.
      </p>

      <h2 style={h2}>Vos données restent sous votre contrôle</h2>
      <ul style={{ lineHeight: 1.7, paddingLeft: 20 }}>
        <li>Vous voyez les droits demandés et vous les acceptez sur toolzy.io, jamais dans l&apos;assistant.</li>
        <li>L&apos;assistant ne voit jamais votre mot de passe ni vos moyens de paiement, et ne paie rien à votre place.</li>
        <li>Avant d&apos;envoyer un message ou de modifier une annonce, il vous montre ce qu&apos;il va faire et attend votre accord.</li>
        <li>Les messages passent par la même modération que sur le site. Le nombre d&apos;actions par heure est limité.</li>
        <li>
          Vous pouvez retirer l&apos;accès d&apos;un assistant à tout moment, avec effet immédiat, depuis{" "}
          <a href={CONNECTED_APPS_URL} style={link}>
            Paramètres, Applications connectées
          </a>
          .
        </li>
      </ul>

      <p style={{ opacity: 0.5, fontSize: 13, marginTop: 56 }}>
        © {"2026"} Toolzy ·{" "}
        <a href="https://www.toolzy.io" style={{ color: "inherit" }}>
          toolzy.io
        </a>
      </p>
    </main>
  );
}
