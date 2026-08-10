import { getSupabase } from "../lib/supabase";

/**
 * Rayon par défaut autour de la ville demandée, en km.
 *
 * Aligné sur le bloc « Aussi disponible près de {ville} » des pages ville de
 * toolzy.io (`NEARBY_RADIUS_KM`). Le site et ce serveur MCP doivent décrire le
 * même périmètre, sans quoi un assistant annonce des annonces introuvables sur
 * le site — ou l'inverse.
 */
const DEFAULT_RADIUS_KM = 15;
const MAX_RADIUS_KM = 100;

interface SearchParams {
  query?: string;
  city?: string;
  zipcode?: string;
  category?: string;
  price_max?: number;
  delivery?: boolean;
  coaching?: boolean;
  radius_km?: number;
  country?: string;
  limit?: number;
}

interface SearchRow {
  name: string;
  slug: string;
  city: string | null;
  zip_code: string | null;
  base_price: number | null;
  delivery_yn: boolean | null;
  training_yn: boolean | null;
  tool_type_name: string | null;
  category_name: string | null;
  image_url: string | null;
  owner_role: string | null;
  owner_is_super_loueur: boolean | null;
  distance_m: number | null;
  is_local: boolean | null;
  center_country: string | null;
}

function clampRadiusKm(radiusKm: number | undefined): number {
  if (radiusKm == null || !Number.isFinite(radiusKm)) return DEFAULT_RADIUS_KM;
  return Math.min(MAX_RADIUS_KM, Math.max(1, Math.round(radiusKm)));
}

/**
 * Distance en mètres → km affichables : 1 décimale sous 10 km, entier au-delà.
 * Même règle que les cartes du site, pour que « 4,6 km » soit « 4,6 km » partout.
 */
function distanceToKm(distanceM: number | null): number | null {
  if (distanceM == null || !Number.isFinite(distanceM) || distanceM < 0) return null;
  const km = distanceM / 1000;
  return km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
}

export async function searchTools(params: SearchParams) {
  const supabase = getSupabase();
  const limit = Math.min(params.limit ?? 10, 20);
  const radiusKm = clampRadiusKm(params.radius_km);

  // Toute la recherche est faite par `mcp_search_tools` : filtres, périmètre
  // géographique et classement `proximité → pro → Loueur de Confiance → boost`.
  //
  // L'implémentation précédente interrogeait `tools` en direct : `ilike` sur le
  // seul nom (ni synonymes ni plein texte), `ilike` sur la ville (donc aucune
  // commune voisine, alors que 309 des 487 communes n'ont rien dans leur propre
  // code postal), tri par date de création, et surtout AUCUN filtre
  // `paused_by_user` — le serveur MCP proposait des annonces mises en pause.
  const { data, error } = await supabase.rpc("mcp_search_tools", {
    p_query: params.query ?? null,
    p_city: params.city ?? null,
    p_zipcode: params.zipcode ?? null,
    p_category: params.category ?? null,
    p_price_max: params.price_max ?? null,
    p_delivery: params.delivery ?? null,
    p_coaching: params.coaching ?? null,
    p_limit: limit,
    p_radius_m: radiusKm * 1000,
    p_country: params.country ?? null,
  });

  if (error) {
    return {
      content: [{ type: "text" as const, text: "Une erreur est survenue lors de la recherche." }],
      isError: true,
    };
  }

  const rows = (data ?? []) as SearchRow[];

  const results = rows.map((tool) => ({
    name: tool.name,
    city: tool.city,
    price: tool.base_price,
    delivery: tool.delivery_yn ?? false,
    coaching: tool.training_yn ?? false,
    category: tool.tool_type_name,
    url: `https://www.toolzy.io/listings/${tool.slug}`,
    image: tool.image_url,
    // Champs de proximité : sans eux, un assistant présente une annonce à 12 km
    // comme si elle était dans la ville demandée.
    distance_km: distanceToKm(tool.distance_m),
    is_local: tool.is_local === true,
    is_pro: tool.owner_role === "OwnerPro",
    is_super_loueur: tool.owner_is_super_loueur === true,
  }));

  if (results.length === 0) {
    const near = params.city ? ` ni à moins de ${radiusKm} km de ${params.city}` : "";
    return {
      content: [{ type: "text" as const, text: `Aucun outil trouvé pour cette recherche${near}.` }],
    };
  }

  const payload = {
    search_area: {
      city: params.city ?? null,
      radius_km: radiusKm,
      local_count: results.filter((r) => r.is_local).length,
      nearby_count: results.filter((r) => !r.is_local).length,
      // Marché retenu quand la commune est homonyme (Bruges existe en Belgique
      // et en Gironde) : le pays le mieux fourni l'emporte.
      country: rows[0]?.center_country ?? null,
    },
    results,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}
