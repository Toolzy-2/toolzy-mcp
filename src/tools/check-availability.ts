import { getSupabase } from "../lib/supabase";

/**
 * ⚠️ RÉPLIQUE de la tarification de toolzy.io. Ce serveur est un dépôt séparé :
 * il ne peut pas importer `src/lib/insurancePricing.ts`. Toute évolution de la
 * grille Tulip, du markup ou du plancher de frais doit donc être reportée ici,
 * comme elle l'est déjà dans l'edge `calculate-reservation-fees`.
 *
 * Un total annoncé dans un assistant puis démenti par le tunnel de paiement est
 * pire qu'une erreur technique : le locataire se croit trompé.
 */

/** Plancher des frais de service (€). Figé en code côté site, sans seuil. */
const PLATFORM_FEE_FLOOR = 3.0;
/** Pourcentage de frais de service par défaut. */
const DEFAULT_PLATFORM_FEE_PERCENTAGE = 20.0;
/** Markup Toolzy sur la prime de base Tulip. */
const INSURANCE_MARKUP = 0.25;
/** Plancher de marge Toolzy sur la prime (€/jour). */
const INSURANCE_MARGIN_FLOOR_PER_DAY = 0.5;
/** Pas d'arrondi de la prime retail/jour (€). */
const INSURANCE_PREMIUM_STEP = 0.5;

/**
 * Grille Tulip « Proposition n°2 avec Vol par le client » : caution (€) → prime
 * de base (€/jour). Le vol par le locataire est DÉJÀ inclus, aucun supplément.
 */
const INSURANCE_GRID: { maxCaution: number; premiumPerDay: number }[] = [
  { maxCaution: 99, premiumPerDay: 1.5 },
  { maxCaution: 199, premiumPerDay: 2.0 },
  { maxCaution: 499, premiumPerDay: 2.5 },
  { maxCaution: 999, premiumPerDay: 3.0 },
  { maxCaution: 2999, premiumPerDay: 7.0 },
  { maxCaution: 4999, premiumPerDay: 11.0 },
  { maxCaution: 9999, premiumPerDay: 14.0 },
  { maxCaution: Infinity, premiumPerDay: 20.0 },
];

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function computeInsurancePremiumEuros(caution: number, days: number): number {
  if (!caution || caution <= 0 || !days || days <= 0) return 0;
  const tier = INSURANCE_GRID.find((t) => caution <= t.maxCaution);
  const basePerDay = tier ? tier.premiumPerDay : 20.0;
  const marginPerDay = Math.max(INSURANCE_MARGIN_FLOOR_PER_DAY, basePerDay * INSURANCE_MARKUP);
  const retailPerDay =
    Math.ceil((basePerDay + marginPerDay) / INSURANCE_PREMIUM_STEP) * INSURANCE_PREMIUM_STEP;
  return round2(retailPerDay * days);
}

interface CheckAvailabilityParams {
  tool_url: string;
  start_date: string;
  end_date: string;
}

function extractSlug(url: string): string {
  const match = url.match(/\/listings\/([^/?#]+)/);
  return match?.[1] ?? url;
}

// Format de date strict (YYYY-MM-DD), validé avant tout usage.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function checkAvailability(params: CheckAvailabilityParams) {
  const supabase = getSupabase();

  if (!DATE_RE.test(params.start_date) || !DATE_RE.test(params.end_date)) {
    return {
      content: [
        { type: "text" as const, text: "Dates invalides. Format attendu : YYYY-MM-DD." },
      ],
      isError: true,
    };
  }

  const slug = extractSlug(params.tool_url);

  // Passe par la RPC : elle applique `paused_by_user`, calcule la disponibilité
  // sur `tool_booked_day` et renvoie la caution et les paliers de réduction.
  //
  // L'implémentation précédente lisait `reservations` en direct et comptait les
  // jours avec `ceil(fin - début)` — soit 1 jour pour une location du 15 au 16,
  // là où le site en facture 2. Le prix annoncé était donc faux d'un jour entier.
  const { data, error } = await supabase.rpc("mcp_check_availability_by_slug", {
    p_slug: slug,
    p_start_date: params.start_date,
    p_end_date: params.end_date,
  });

  if (error || !Array.isArray(data) || data.length === 0 || !data[0]?.tool_name) {
    return {
      content: [{ type: "text" as const, text: "Outil non trouvé." }],
      isError: true,
    };
  }

  const r = data[0] as any;
  const days = r.days_count || 1;
  const gratuitMairie = r.is_free_mairie_listing === true;

  // Réduction longue durée : le prix réduit remplace le prix de base sur TOUTE
  // la durée, pas uniquement au-delà du seuil.
  const basePrice = typeof r.base_price === "number" ? r.base_price : 0;
  const seuil = r.discount_after_days ?? null;
  const prixReduit = r.discounted_daily_price ?? null;
  const reductionApplicable = !!seuil && !!prixReduit && days >= seuil;
  const dailyRate = reductionApplicable ? prixReduit : basePrice;

  const subtotal = round2(dailyRate * days);
  const discount = reductionApplicable ? round2((basePrice - prixReduit) * days) : 0;

  const serviceFee =
    gratuitMairie || subtotal <= 0
      ? 0
      : round2(Math.max(PLATFORM_FEE_FLOOR, subtotal * (DEFAULT_PLATFORM_FEE_PERCENTAGE / 100)));

  const caution = typeof r.caution === "number" ? r.caution : 0;
  const insuranceFee = gratuitMairie ? 0 : computeInsurancePremiumEuros(caution, days);

  const total = round2(subtotal + serviceFee + insuranceFee);
  const toolUrl = `https://www.toolzy.io/listings/${r.tool_slug}`;

  const result = {
    tool: r.tool_name,
    url: toolUrl,
    booking_url: `${toolUrl}?start=${params.start_date}&end=${params.end_date}`,
    start_date: params.start_date,
    end_date: params.end_date,
    days,
    available: r.available === true,
    price_per_day: dailyRate,
    subtotal,
    long_stay_discount: discount,
    service_fee: serviceFee,
    // Garantie Casse & Vol : assurée par un partenaire assureur, jamais présentée
    // comme une assurance Toolzy (cf. charte de marque).
    breakage_theft_guarantee: insuranceFee,
    guarantee_note:
      insuranceFee > 0 ? "Garantie Casse & Vol, assurée par notre partenaire assureur." : null,
    deposit: caution > 0 ? caution : 0,
    deposit_note:
      caution > 0
        ? "Aucune somme n'est bloquée sur la carte : Toolzy ne débite la caution qu'en cas de dommage déclaré et validé."
        : null,
    total,
    currency: "EUR",
    blocked_dates: r.available === true ? undefined : (r.blocked_dates ?? []),
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}
