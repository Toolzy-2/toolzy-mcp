# Toolzy MCP Server

Serveur **Model Context Protocol** officiel de [Toolzy](https://www.toolzy.io) — la marketplace française de **location d'outils entre particuliers**.

Il permet aux assistants IA (ChatGPT, Claude, Cursor, agents MCP…) de **rechercher des outils à louer, consulter les annonces et vérifier les disponibilités** en langage naturel.

> _Official MCP server for Toolzy, France's peer-to-peer tool rental marketplace. Lets AI assistants search tools, read listings and check availability._

- **Endpoint distant** : `https://mcp.toolzy.io/api/mcp` (Streamable HTTP, stateless)
- **Auth** : aucune — lecture seule des annonces publiques
- **Registre officiel** : [`io.toolzy/toolzy`](https://registry.modelcontextprotocol.io)

## Tools

| Tool | Description |
|------|-------------|
| `search_tools` | Recherche d'outils par texte, ville, code postal, catégorie, prix max, livraison, accompagnement. |
| `get_tool_details` | Détails complets d'une annonce à partir de son URL (prix, caractéristiques, photos). |
| `check_availability` | Disponibilité pour une période + calcul du prix total (loyer + frais de service). |

## Connexion

### Client MCP distant (recommandé)

Ajoutez simplement l'URL du serveur distant à votre client MCP :

```
https://mcp.toolzy.io/api/mcp
```

### Claude Desktop (via le proxy `mcp-remote`)

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

### Cursor / autres clients

Pointez le client sur l'URL distante ci-dessus (transport Streamable HTTP).

## Exemple

> _« Je cherche une perceuse à louer à Bordeaux ce week-end »_

→ l'assistant appelle `search_tools`, puis `get_tool_details` et `check_availability`, et renvoie les annonces avec prix et lien direct vers [toolzy.io](https://www.toolzy.io).

## À propos

Développé et maintenu par [Toolzy](https://www.toolzy.io). Le serveur expose en lecture seule les annonces publiques modérées de la marketplace.

## Licence

[MIT](./LICENSE) © Toolzy
