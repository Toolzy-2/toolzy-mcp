# Toolzy MCP Server

Serveur **Model Context Protocol** officiel de [Toolzy](https://www.toolzy.io) — la marketplace française de **location d'outils entre particuliers**.

Il permet aux assistants IA (ChatGPT, Claude, Cursor, agents MCP…) de **rechercher des outils à louer, consulter les annonces et vérifier les disponibilités** en langage naturel.

> _Official MCP server for Toolzy, France's peer-to-peer tool rental marketplace. Lets AI assistants search tools, read listings and check availability._

- **Endpoint distant** : `https://mcp.toolzy.io/api/mcp` (Streamable HTTP, stateless)
- **Auth** : aucune — lecture seule des annonces publiques
- **Données** : annonces modérées (`validated`) de toolzy.io

## Tools

| Tool | Description |
|------|-------------|
| `search_tools` | Recherche d'outils par texte, ville, code postal, catégorie, prix max, livraison, accompagnement. |
| `get_tool_details` | Détails complets d'une annonce à partir de son URL (prix, caractéristiques, photos). |
| `check_availability` | Disponibilité pour une période + calcul du prix total (loyer + frais de service). |

## Utilisation

### Client distant (recommandé)

Ajoutez le serveur distant à votre client MCP :

```
https://mcp.toolzy.io/api/mcp
```

### Claude Desktop (via le proxy stdio `mcp-remote`)

```jsonc
{
  "mcpServers": {
    "toolzy": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.toolzy.io/api/mcp"]
    }
  }
}
```

### En local (stdio)

```bash
cp .env.example .env   # renseigner SUPABASE_URL et SUPABASE_ANON_KEY
npm install
npm run stdio          # démarre le serveur MCP sur stdio
```

Puis pointez un client stdio (ex. Claude Desktop) sur `npm run stdio`, ou testez avec le
[MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) :

```bash
npx @modelcontextprotocol/inspector npm run stdio
```

## Développement

```bash
npm install
npm run dev            # http://localhost:3005/api/mcp
npm run build          # build de production (Next.js)
```

Tester l'endpoint HTTP local avec l'Inspector :

```bash
npx @modelcontextprotocol/inspector
# Transport: Streamable HTTP → URL: http://localhost:3005/api/mcp
```

## Architecture

- **Next.js (App Router)** déployé sur **Vercel**.
- Endpoint HTTP : `src/app/api/[transport]/route.ts` via [`mcp-handler`](https://github.com/vercel/mcp-handler) (Streamable HTTP + SSE).
- Entrée stdio : `src/server.ts` (usage local / `npx`).
- Les 3 tools sont définis **une seule fois** dans `src/lib/register.ts` et partagés par les deux transports.
- Données lues depuis **Supabase** (clé anon, RLS) via `src/lib/supabase.ts`.

## Variables d'environnement

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | URL du projet Supabase Toolzy |
| `SUPABASE_ANON_KEY` | Clé anonyme (publique, protégée par RLS) |

> ⚠️ Ne jamais committer de `.env` ni utiliser la clé `service_role`.

## Déploiement (Vercel)

1. Importer le repo dans Vercel.
2. Définir `SUPABASE_URL` et `SUPABASE_ANON_KEY` (Environment Variables).
3. Brancher le domaine `mcp.toolzy.io`.
4. L'endpoint est alors disponible sur `https://mcp.toolzy.io/api/mcp`.

## Publication dans les registres MCP

- **Registre officiel** : valider et publier `server.json` — voir le namespace `io.toolzy` (vérif DNS TXT sur `toolzy.io`).
  ```bash
  mcp-publisher init          # génère le server.json au schéma courant (à fusionner avec le nôtre)
  mcp-publisher publish --dry-run
  mcp-publisher login dns --domain toolzy.io
  mcp-publisher publish
  ```
- **Smithery** : `smithery mcp publish https://mcp.toolzy.io/api/mcp -n toolzy/toolzy`
- **Glama / PulseMCP** : crawl automatique du repo public → « claim » de la fiche.
- **MCP.so** : soumission via https://mcp.so/submit (repo GitHub public).
- **awesome-mcp-servers** : PR ajoutant l'entrée dans la bonne catégorie.

## Licence

[MIT](./LICENSE) © Toolzy
