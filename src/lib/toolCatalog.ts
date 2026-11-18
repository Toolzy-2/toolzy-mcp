/**
 * Catalogue des outils présenté sur la page d'accueil de mcp.toolzy.io.
 * Un test vérifie qu'il couvre exactement les outils enregistrés : tout nouvel
 * outil doit être décrit ici.
 */

export interface CatalogTool {
  name: string;
  desc: string;
  /** Outil d'écriture : l'assistant demande votre accord avant de l'utiliser. */
  write?: true;
}

export interface CatalogGroup {
  title: string;
  tools: CatalogTool[];
}

export const PUBLIC_TOOLS: CatalogTool[] = [
  { name: "search_tools", desc: "Rechercher des outils à louer près d'une ville, avec la distance de chaque annonce." },
  { name: "get_tool_details", desc: "Consulter une annonce : prix, caution, caractéristiques, photos." },
  { name: "check_availability", desc: "Vérifier les disponibilités sur des dates et calculer le prix total." },
];

export const CONNECTED_GROUPS: CatalogGroup[] = [
  {
    title: "Votre compte",
    tools: [{ name: "whoami", desc: "Prénom, type de compte et statut Loueur de Confiance." }],
  },
  {
    title: "Réservations",
    tools: [
      {
        name: "list_my_reservations",
        desc: "Vos locations comme locataire et comme propriétaire : à venir, en cours, passées.",
      },
    ],
  },
  {
    title: "Messagerie",
    tools: [
      { name: "list_my_conversations", desc: "Vos conversations récentes et vos messages non lus." },
      { name: "get_conversation_messages", desc: "Lire une conversation, sans marquer les messages comme lus." },
      {
        name: "find_conversation",
        desc: "Retrouver la conversation avec le propriétaire d'une annonce ou l'autre partie d'une réservation.",
      },
      {
        name: "send_message",
        desc: "Envoyer un message, ou contacter le propriétaire d'une annonce. Modération Toolzy appliquée.",
        write: true,
      },
    ],
  },
  {
    title: "Vos annonces",
    tools: [
      { name: "list_my_listings", desc: "Vos annonces avec leur statut, leur tarif et leur nombre de vues." },
      {
        name: "update_my_listing",
        desc: "Modifier le prix par jour, la caution, la livraison, l'accompagnement ou la remise longue durée.",
        write: true,
      },
    ],
  },
];

export const CATALOG_TOOL_NAMES: string[] = [
  ...PUBLIC_TOOLS.map((tool) => tool.name),
  ...CONNECTED_GROUPS.flatMap((group) => group.tools.map((tool) => tool.name)),
];
