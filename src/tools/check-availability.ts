import { getSupabase } from "../lib/supabase";

interface CheckAvailabilityParams {
  tool_url: string;
  start_date: string;
  end_date: string;
}

function extractSlug(url: string): string {
  const match = url.match(/\/listings\/([^/?#]+)/);
  return match?.[1] ?? url;
}

function countDays(start: string, end: string): number {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const diffMs = endDate.getTime() - startDate.getTime();
  return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

// Format de date strict (YYYY-MM-DD). Valider AVANT toute interpolation dans un
// filtre PostgREST empêche toute injection de filtre via les dates.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function checkAvailability(params: CheckAvailabilityParams) {
  const supabase = getSupabase();

  if (!DATE_RE.test(params.start_date) || !DATE_RE.test(params.end_date)) {
    return {
      content: [
        {
          type: "text" as const,
          text: "Dates invalides. Format attendu : YYYY-MM-DD.",
        },
      ],
      isError: true,
    };
  }

  const slug = extractSlug(params.tool_url);

  // Récupérer l'outil et son prix
  const { data: tool, error: toolError } = await supabase
    .from("tools")
    .select(`
      id, name, slug,
      price_policy(base_price)
    `)
    .eq("slug", slug)
    .eq("moderation", "validated")
    .single();

  if (toolError || !tool) {
    return {
      content: [{ type: "text" as const, text: "Outil non trouvé." }],
      isError: true,
    };
  }

  // Vérifier les réservations existantes sur la période
  //
  // ⚠️ SÉCURITÉ/EXACTITUDE (à valider avant prod) : cette lecture utilise la
  // clé ANON et dépend donc des RLS de la table `reservations`.
  //  - Si les RLS bloquent le SELECT anonyme → `reservations` = null → l'outil
  //    est TOUJOURS annoncé disponible (faux positif).
  //  - Si les RLS autorisent le SELECT anonyme → on expose les fenêtres de
  //    réservation (fuite de données).
  // Correctif recommandé : passer par une RPC `SECURITY DEFINER` qui ne renvoie
  // qu'un booléen de disponibilité (cf. `mcp_check_availability` du PRD Phase 0).
  const { data: reservations } = await supabase
    .from("reservations")
    .select("start_date, end_date")
    .eq("tool_id", tool.id)
    .in("status", ["confirmed", "pending"])
    .or(`and(start_date.lte.${params.end_date},end_date.gte.${params.start_date})`);

  const isAvailable = !reservations || reservations.length === 0;
  const days = countDays(params.start_date, params.end_date);
  const pricePerDay = (tool.price_policy as any)?.base_price ?? 0;
  const totalPrice = pricePerDay * days;

  // Frais plateforme : 20% (min 4€) si > 20€, sinon flat 4€
  const platformFee = totalPrice > 20 ? Math.max(4, totalPrice * 0.2) : 4;

  const result = {
    tool: tool.name,
    url: `https://www.toolzy.io/listings/${tool.slug}`,
    start_date: params.start_date,
    end_date: params.end_date,
    days,
    available: isAvailable,
    price_per_day: pricePerDay,
    subtotal: totalPrice,
    platform_fee: Math.round(platformFee * 100) / 100,
    total: Math.round((totalPrice + platformFee) * 100) / 100,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}
