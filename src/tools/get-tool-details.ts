import { getSupabase } from "../lib/supabase";

interface GetToolDetailsParams {
  tool_url: string;
}

function extractSlug(url: string): string {
  const match = url.match(/\/listings\/([^/?#]+)/);
  return match?.[1] ?? url;
}

export async function getToolDetails(params: GetToolDetailsParams) {
  const supabase = getSupabase();
  const slug = extractSlug(params.tool_url);

  const { data, error } = await supabase
    .from("tools")
    .select(`
      id, name, slug, description, city, zip_code, images, condition,
      tool_types:tool_type_id(slug, name),
      price_policy(base_price, delivery_yn, delivery_price, training_yn, training_price)
    `)
    .eq("slug", slug)
    .eq("moderation", "validated")
    .single();

  if (error || !data) {
    return {
      content: [{ type: "text" as const, text: "Outil non trouvé." }],
      isError: true,
    };
  }

  const pricePolicy = data.price_policy as any;

  const details = {
    name: data.name,
    description: data.description,
    city: data.city,
    zip_code: data.zip_code,
    condition: data.condition,
    category: (data.tool_types as any)?.name ?? null,
    price_per_day: pricePolicy?.base_price ?? null,
    delivery: pricePolicy?.delivery_yn ?? false,
    delivery_price: pricePolicy?.delivery_price ?? null,
    coaching: pricePolicy?.training_yn ?? false,
    coaching_price: pricePolicy?.training_price ?? null,
    images: data.images ?? [],
    url: `https://www.toolzy.io/listings/${data.slug}`,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(details, null, 2) }],
  };
}
