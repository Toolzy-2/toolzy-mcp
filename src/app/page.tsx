import Image from "next/image";
import type { ReactNode } from "react";
import { CopyButton } from "@/components/landing/CopyButton";
import styles from "@/components/landing/landing.module.css";
import { CONNECTED_GROUPS, PUBLIC_TOOLS, type CatalogTool } from "@/lib/toolCatalog";

const ENDPOINT = "https://mcp.toolzy.io/api/mcp";
const CLAUDE_CODE_COMMAND = `claude mcp add --transport http toolzy ${ENDPOINT}`;
const CONNECTED_APPS_URL = "https://www.toolzy.io/parametres/applications-connectees";

function ToolRows({ tools }: { tools: CatalogTool[] }) {
  return (
    <ul className={`${styles.card} ${styles.list}`}>
      {tools.map((tool) => (
        <li key={tool.name} className={styles.row}>
          <div className={styles.rowText}>
            <div className={styles.toolName}>{tool.name}</div>
            <div className={styles.rowDesc}>{tool.desc}</div>
          </div>
          {tool.write && <span className={styles.badge}>Demande votre accord</span>}
        </li>
      ))}
    </ul>
  );
}

function Section({ title, text, children }: { title: string; text?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.legend}>{title}</h2>
      {text && <p className={styles.sectionText}>{text}</p>}
      {children}
    </section>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

const GUARANTEES: ReactNode[] = [
  "Vous voyez les droits demandés et vous les acceptez sur toolzy.io, jamais dans l'assistant.",
  "L'assistant ne voit jamais votre mot de passe ni vos moyens de paiement, et ne paie rien à votre place.",
  "Avant d'envoyer un message ou de modifier une annonce, il vous montre ce qu'il va faire et attend votre accord.",
  "Les messages passent par la même modération que sur le site, et le nombre d'actions par heure est limité.",
  <>
    Vous pouvez retirer l&apos;accès d&apos;un assistant à tout moment, avec effet immédiat, depuis{" "}
    <a className={styles.link} href={CONNECTED_APPS_URL}>
      Paramètres, Applications connectées
    </a>
    .
  </>,
];

export default function Home() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <a className={styles.brand} href="https://www.toolzy.io">
          <Image className={styles.logo} src="/toolzy-icon.png" alt="Toolzy" width={40} height={40} priority />
          <span className={styles.brandName}>
            Toolzy MCP
            <span className={styles.brandTag}>Location d&apos;outils entre particuliers</span>
          </span>
        </a>
        <a className={`${styles.button} ${styles.primary}`} href="https://www.toolzy.io">
          Aller sur toolzy.io
        </a>
      </header>

      <main className={styles.main}>
        <div className={styles.hero}>
          <h1>Toolzy dans votre assistant IA</h1>
          <p>
            Le serveur MCP officiel de Toolzy. Sans compte, un assistant peut chercher des outils et vérifier leurs
            disponibilités. Avec votre compte Toolzy, il peut aussi suivre vos réservations, lire et envoyer vos
            messages et gérer le tarif de vos annonces.
          </p>
        </div>

        <Section
          title="Adresse du serveur"
          text="Transport Streamable HTTP. Les outils publics fonctionnent sans connexion ; ceux de votre compte demandent une connexion OAuth à Toolzy."
        >
          <div className={`${styles.card} ${styles.cardBody}`}>
            <div className={styles.endpoint}>
              <code className={styles.code}>{ENDPOINT}</code>
              <CopyButton text={ENDPOINT} />
            </div>
          </div>
        </Section>

        <Section title="Outils publics" text="Utilisables sans connexion.">
          <ToolRows tools={PUBLIC_TOOLS} />
        </Section>

        <Section
          title="Outils de votre compte"
          text="Disponibles une fois votre compte connecté. L'assistant n'accède qu'à vos propres données."
        >
          {CONNECTED_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className={styles.groupTitle}>{group.title}</h3>
              <ToolRows tools={group.tools} />
            </div>
          ))}
        </Section>

        <Section
          title="Connecter votre assistant"
          text="À la première utilisation d'un outil de votre compte, une fenêtre s'ouvre sur toolzy.io : vous vous connectez comme d'habitude (Google ou e-mail), puis vous choisissez d'autoriser l'assistant."
        >
          <ul className={`${styles.card} ${styles.list}`}>
            <li className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.stepTitle}>Claude Code</div>
                <div className={styles.rowDesc}>
                  Lancez la commande, puis <code>/mcp</code>, choisissez <code>toolzy</code> et « Authenticate ».
                </div>
                <div className={styles.endpoint} style={{ marginTop: 8 }}>
                  <code className={styles.code}>{CLAUDE_CODE_COMMAND}</code>
                  <CopyButton text={CLAUDE_CODE_COMMAND} variant="dark" />
                </div>
              </div>
            </li>
            <li className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.stepTitle}>Claude (claude.ai)</div>
                <div className={styles.rowDesc}>
                  Dans les réglages des connecteurs, ajoutez un connecteur personnalisé avec l&apos;adresse du serveur.
                </div>
              </div>
            </li>
            <li className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.stepTitle}>ChatGPT</div>
                <div className={styles.rowDesc}>
                  Dans les réglages des applications et connecteurs, ajoutez un connecteur avec l&apos;adresse du
                  serveur.
                </div>
              </div>
            </li>
          </ul>
        </Section>

        <Section title="Vos données restent sous votre contrôle">
          <ul className={`${styles.card} ${styles.list}`}>
            {GUARANTEES.map((item, index) => (
              <li key={index} className={styles.row} style={{ alignItems: "center" }}>
                <span className={styles.tile}>
                  <CheckIcon />
                </span>
                <div className={`${styles.rowText} ${styles.rowDesc}`} style={{ marginTop: 0, color: "#2b2b3d" }}>
                  {item}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      </main>

      <footer className={styles.footer}>
        © 2026 Toolzy ·{" "}
        <a className={styles.link} href="https://www.toolzy.io">
          toolzy.io
        </a>
      </footer>
    </div>
  );
}
