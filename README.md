# Toolzy MCP Server

Serveur **Model Context Protocol** officiel de [Toolzy](https://www.toolzy.io), la marketplace française de **location d'outils entre particuliers**.

Sans compte, un assistant IA (Claude, ChatGPT, Cursor, agents MCP…) peut **rechercher des outils à louer, consulter les annonces et vérifier les disponibilités**. Avec le compte Toolzy de l'utilisateur, il peut aussi **suivre ses réservations, lire et envoyer ses messages, et gérer le tarif de ses annonces**.

> _Official MCP server for Toolzy, France's peer-to-peer tool rental marketplace. Without an account, AI assistants can search tools, read listings and check availability. Signed in with OAuth, they can also follow the user's bookings, read and send messages, and manage listing prices._

- **Endpoint distant** : `https://mcp.toolzy.io/api/mcp` (Streamable HTTP)
- **Auth** : aucune pour les outils publics ; OAuth 2.1 (PKCE) avec le compte Toolzy pour les outils du compte
- **Registre officiel** : [`io.toolzy/toolzy`](https://registry.modelcontextprotocol.io)
- **Présentation** : [mcp.toolzy.io](https://mcp.toolzy.io)

## Outils publics (sans connexion)

| Outil | Description |
|------|-------------|
| `search_tools` | Recherche d'outils près d'une ville (rayon de 15 km), avec la distance de chaque annonce. Filtres : texte, code postal, catégorie, prix max, livraison, accompagnement. |
| `get_tool_details` | Détails d'une annonce à partir de son URL : prix, caution, caractéristiques, photos. |
| `check_availability` | Disponibilité sur des dates et prix total (loyer, frais de plateforme, Garantie Casse & Vol). |

## Outils du compte (connexion OAuth)

| Outil | Droit demandé | Description |
|------|------|-------------|
| `whoami` | `profile:read` | Prénom, type de compte et statut Loueur de Confiance. |
| `list_my_reservations` | `reservations:read` | Locations comme locataire et comme propriétaire : à venir, en cours, passées. |
| `list_my_conversations` | `messages:read` | Conversations récentes et messages non lus. |
| `get_conversation_messages` | `messages:read` | Lire une conversation, sans marquer les messages comme lus. |
| `find_conversation` | `messages:read` | Retrouver la conversation avec le propriétaire d'une annonce ou l'autre partie d'une réservation. |
| `send_message` ✍️ | `messages:write` | Envoyer un message ou contacter le propriétaire d'une annonce. Modération Toolzy appliquée. |
| `list_my_listings` | `listings:read` | Annonces de l'utilisateur avec statut, tarif et vues. |
| `update_my_listing` ✍️ | `listings:write` | Modifier le prix par jour, la caution, la livraison, l'accompagnement ou la remise longue durée. |

✍️ Outil d'écriture : l'assistant montre l'action et attend l'accord de l'utilisateur avant de l'exécuter.

## Connexion

### Claude Code

```bash
claude mcp add --transport http toolzy https://mcp.toolzy.io/api/mcp
```

Puis `/mcp`, choisir `toolzy` et « Authenticate » pour les outils du compte.

### Claude (claude.ai) et ChatGPT

Ajouter un connecteur personnalisé avec l'URL `https://mcp.toolzy.io/api/mcp`.

### Autres clients (Cursor, Claude Desktop via `mcp-remote`…)

Pointer le client sur l'URL distante (transport Streamable HTTP). Les outils publics fonctionnent partout ; les outils du compte sont ouverts aux clients pris en charge par le serveur d'autorisation (Claude et ChatGPT à ce jour).

## Authentification et sécurité

- **OAuth 2.1** conforme à la spécification MCP : métadonnées de ressource protégée (RFC 9728), PKCE S256, jetons liés à l'URL du serveur (RFC 8707), clients identifiés par leur document de métadonnées (CIMD), pas d'enregistrement dynamique.
- L'utilisateur se connecte et donne son consentement **sur toolzy.io**, droit par droit. L'assistant ne voit jamais son mot de passe ni ses moyens de paiement, et ne paie rien.
- Chaque requête est limitée aux données de l'utilisateur connecté. Les messages passent par la même modération que sur le site, et le nombre d'actions par heure est limité.
- L'accès se retire à tout moment, avec effet immédiat, depuis [Paramètres, Applications connectées](https://www.toolzy.io/parametres/applications-connectees).

## Exemples

> _« Je cherche une perceuse à louer à Bordeaux ce week-end »_

L'assistant appelle `search_tools`, puis `get_tool_details` et `check_availability`, et renvoie les annonces avec leur prix et un lien vers [toolzy.io](https://www.toolzy.io).

> _« Ai-je des messages non lus sur Toolzy ? Réponds au propriétaire que je passe samedi à 10 h. »_

L'assistant appelle `list_my_conversations`, lit la conversation, propose le texte, puis `send_message` après accord.

## À propos

Développé et maintenu par [Toolzy](https://www.toolzy.io).

## Licence

[MIT](./LICENSE) © Toolzy
