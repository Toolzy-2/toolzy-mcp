import { getSupabase } from "../lib/supabase";

/**
 * Rayon de recherche des alternatives autour d'une fiche, en mètres.
 * Aligné sur le carrousel « annonces similaires » de toolzy.io.
 */
const SIMILAR_RADIUS_M = 20_000;
const SIMILAR_FETCH_LIMIT = 50;
const SIMILAR_MAX_RESULTS = 6;

interface GetToolDetailsParams {
  tool_url: string;
}

function extractSlug(url: string): string {
  const match = url.match(/\/listings\/([^/?#]+)/);
  return match?.[1] ?? url;
}

/** Distance en mètres → km affichables : 1 décimale sous 10 km, entier au-delà. */
function distanceToKm(distanceM: number | null): number | null {
  if (distanceM == null || !Number.isFinite(distanceM) || distanceM < 0) return null;
  const km = distanceM / 1000;
  return km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
}

/** Rang de mise en avant : pro → Loueur de Confiance → tout le monde. */
function ownerRank(role: string | null, isSuperLoueur: boolean): number {
  if (role === "OwnerPro") return 0;
  if (isSuperLoueur) return 1;
  return 2;
}

/**
 * Alternatives : même catégorie, autour de la fiche, propriétaire courant exclu.
 *
 * Classement identique à la fiche annonce du site :
 * `proximité (tranche de 1 km) → pro → Loueur de Confiance → distance exacte`.
 * Sans la tranche, les distances étant au mètre il n'y a jamais d'ex æquo et le
 * rang propriétaire ne s'appliquerait jamais.
 *
 * Ne lève jamais : une fiche doit rester consultable si les alternatives échouent.
 */
async function fetchSimilar(
  supabase: ReturnType<typeof getSupabase>,
  tool: {
    id: string;
    category_id: string | null;
    city_slug: string | null;
    latitude: number | null;
    longitude: number | null;
    country: string | null;
    owner_id: string | null;
  },
) {
  if (!tool.category_id) return [];

  try {
    const { data, error } = await supabase.rpc("search_tools_similar_v2", {
      p_category_id: tool.category_id,
      p_city_slug: tool.city_slug,
      p_lat: tool.latitude,
      p_lon: tool.longitude,
      p_radius_m: SIMILAR_RADIUS_M,
      p_exclude_ids: [tool.id],
      p_limit: SIMILAR_FETCH_LIMIT,
      p_country: tool.country,
    });

    if (error || !Array.isArray(data)) return [];

    return (data as any[])
      // Le propriétaire de la fiche est exclu en entier : proposer ses propres
      // annonces comme « alternative » n'aide pas à comparer.
      .filter((row) => row.owner?.id !== tool.owner_id)
      .filter((row) => row.price_policy?.base_price != null)
      .map((row) => ({
        name: row.name as string,
        url: `https://www.toolzy.io/listings/${row.slug}`,
        city: (row.city ?? null) as string | null,
        price_per_day: row.price_policy.base_price as number,
        distance_km: distanceToKm(row.distance_m ?? null),
        is_pro: row.owner?.role === "OwnerPro",
        is_super_loueur: row.owner?.is_super_loueur === true,
      }))
      .sort((a, b) => {
        const trancheA = a.distance_km == null ? Number.POSITIVE_INFINITY : Math.floor(a.distance_km);
        const trancheB = b.distance_km == null ? Number.POSITIVE_INFINITY : Math.floor(b.distance_km);
        if (trancheA !== trancheB) return trancheA - trancheB;

        const rangA = ownerRank(a.is_pro ? "OwnerPro" : null, a.is_super_loueur);
        const rangB = ownerRank(b.is_pro ? "OwnerPro" : null, b.is_super_loueur);
        if (rangA !== rangB) return rangA - rangB;

        // Départage final : sans lui, les distances s'affichent en désordre à
        // l'intérieur d'une même tranche.
        return (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity);
      })
      .slice(0, SIMILAR_MAX_RESULTS);
  } catch {
    return [];
  }
}

export async function getToolDetails(params: GetToolDetailsParams) {
  const supabase = getSupabase();
  const slug = extractSlug(params.tool_url);

  // Passe par la RPC plutôt que par un SELECT direct sur `tools` : elle applique
  // `paused_by_user = false` (l'ancien chemin proposait des annonces en pause) et
  // expose la catégorie, nécessaire aux alternatives.
  const { data, error } = await supabase.rpc("mcp_get_tool_details_by_slug", {
    p_slug: slug,
  });

  if (error || !Array.isArray(data) || data.length === 0) {
    return {
      content: [{ type: "text" as const, text: "Outil non trouvé." }],
      isError: true,
    };
  }

  const tool = data[0] as any;

  const similar = await fetchSimilar(supabase, {
    id: tool.id,
    category_id: tool.category_id ?? null,
    city_slug: tool.city_slug ?? null,
    latitude: tool.latitude ?? null,
    longitude: tool.longitude ?? null,
    country: tool.country ?? null,
    owner_id: tool.owner_id ?? null,
  });

  const details = {
    name: tool.name,
    description: tool.description,
    city: tool.city,
    zip_code: tool.zip_code,
    condition: tool.global_state,
    category: tool.tool_type_name,
    price_per_day: tool.base_price ?? null,
    deposit: tool.caution ?? null,
    delivery: tool.delivery_yn ?? false,
    delivery_price: tool.delivery_price ?? null,
    coaching: tool.training_yn ?? false,
    coaching_price: tool.training_price ?? null,
    owner_name: tool.owner_name ?? null,
    owner_is_pro: tool.owner_role === "OwnerPro",
    owner_is_super_loueur: tool.owner_is_super_loueur === true,
    images: tool.images ?? [],
    url: `https://www.toolzy.io/listings/${tool.slug}`,
    // Alternatives de la même catégorie autour de la fiche, avec leur distance :
    // c'est ce que le locataire vient comparer.
    similar_tools: similar,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(details, null, 2) }],
  };
}
