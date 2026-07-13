import { getSupabase } from "../lib/supabase";

interface SearchParams {
  query?: string;
  city?: string;
  zipcode?: string;
  category?: string;
  price_max?: number;
  delivery?: boolean;
  coaching?: boolean;
  limit?: number;
}

export async function searchTools(params: SearchParams) {
  const supabase = getSupabase();
  const limit = Math.min(params.limit ?? 10, 20);

  let query = supabase
    .from("tools")
    .select(`
      id, name, slug, city, zip_code, images,
      tool_types:tool_type_id(slug, name),
      price_policy(base_price, delivery_yn, training_yn)
    `)
    .eq("moderation", "validated")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (params.query) {
    query = query.ilike("name", `%${params.query}%`);
  }

  if (params.city) {
    query = query.ilike("city", `%${params.city}%`);
  }

  if (params.zipcode) {
    query = query.like("zip_code", `${params.zipcode}%`);
  }

  if (params.delivery) {
    query = query.eq("price_policy.delivery_yn", true);
  }

  if (params.coaching) {
    query = query.eq("price_policy.training_yn", true);
  }

  const { data, error } = await query;

  if (error) {
    return {
      content: [{ type: "text" as const, text: `Erreur: ${error.message}` }],
      isError: true,
    };
  }

  const results = (data ?? [])
    .filter((tool) => {
      if (params.price_max) {
        const price = (tool.price_policy as any)?.base_price;
        if (price && price > params.price_max) return false;
      }
      return true;
    })
    .map((tool) => ({
      name: tool.name,
      city: tool.city,
      price: (tool.price_policy as any)?.base_price ?? null,
      delivery: (tool.price_policy as any)?.delivery_yn ?? false,
      coaching: (tool.price_policy as any)?.training_yn ?? false,
      category: (tool.tool_types as any)?.name ?? null,
      url: `https://www.toolzy.io/listings/${tool.slug}`,
      image: tool.images?.[0] ?? null,
    }));

  return {
    content: [
      {
        type: "text" as const,
        text: results.length > 0
          ? JSON.stringify(results, null, 2)
          : "Aucun outil trouvé pour cette recherche.",
      },
    ],
  };
}
