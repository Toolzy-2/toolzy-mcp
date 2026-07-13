import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchTools } from "../tools/search-tools";
import { getToolDetails } from "../tools/get-tool-details";
import { checkAvailability } from "../tools/check-availability";

/**
 * Enregistre les 3 tools read-only de Toolzy sur une instance McpServer.
 *
 * Source de vérité unique, partagée par les deux transports :
 *  - HTTP (Streamable HTTP) via src/app/api/[transport]/route.ts (déploiement Vercel)
 *  - stdio via src/server.ts (usage local / npx)
 */
export function registerToolzyTools(server: McpServer): void {
  server.registerTool(
    "search_tools",
    {
      title: "Rechercher des outils",
      description:
        "Recherche d'outils et équipements disponibles à la location sur Toolzy. Utilisez ce tool quand l'utilisateur cherche un outil, veut louer du matériel, ou demande ce qui est disponible près de chez lui (ex: 'perceuse à Bordeaux', 'tondeuse à gazon', 'outils de bricolage').",
      inputSchema: {
        query: z.string().optional().describe("Recherche textuelle (nom d'outil, marque, type)"),
        city: z.string().optional().describe("Ville pour filtrer les résultats"),
        zipcode: z.string().optional().describe("Code postal (filtre par préfixe)"),
        category: z.string().optional().describe("Catégorie d'outils"),
        price_max: z.number().optional().describe("Prix maximum par jour en euros"),
        delivery: z.boolean().optional().describe("Filtrer sur livraison disponible"),
        coaching: z.boolean().optional().describe("Filtrer sur accompagnement disponible"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Nombre max de résultats (défaut: 10, max: 20)"),
      },
    },
    async (args) => searchTools(args),
  );

  server.registerTool(
    "get_tool_details",
    {
      title: "Détails d'un outil",
      description:
        "Récupère les informations détaillées d'un outil sur Toolzy : prix, caractéristiques, photos. Utilisez ce tool quand l'utilisateur veut en savoir plus sur un outil spécifique après avoir vu les résultats de recherche.",
      inputSchema: {
        tool_url: z
          .string()
          .describe("URL de l'annonce Toolzy (ex: https://www.toolzy.io/listings/perceuse-makita)"),
      },
    },
    async (args) => getToolDetails(args),
  );

  server.registerTool(
    "check_availability",
    {
      title: "Vérifier la disponibilité",
      description:
        "Vérifie si un outil est disponible pour des dates données et calcule le prix total. Utilisez ce tool quand l'utilisateur demande la disponibilité, veut savoir le prix pour une période, ou demande 'est-ce disponible ce weekend ?'.",
      inputSchema: {
        tool_url: z
          .string()
          .describe("URL de l'annonce Toolzy (ex: https://www.toolzy.io/listings/perceuse-makita)"),
        start_date: z.string().describe("Date de début (YYYY-MM-DD)"),
        end_date: z.string().describe("Date de fin (YYYY-MM-DD)"),
      },
    },
    async (args) => checkAvailability(args),
  );
}
