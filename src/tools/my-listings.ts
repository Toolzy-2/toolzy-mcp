import type { UserSession } from "../lib/auth/userSession";
import { ListingNotFoundError, parseListingSlug } from "./conversations";

/**
 * Annonces du propriétaire connecté : lecture et modification du tarif.
 *
 * Règles reprises du formulaire « Modifier l'annonce » du site
 * (toolzy-v2 modifier-annonce/[id]/page.tsx) : prix par jour > 0, caution
 * ≥ 50 €, remise longue durée à partir de 2 jours. Le tarif vit dans
 * `price_policies` ; le changer ne remet pas l'annonce en modération (le
 * trigger moderate_updated_tool ne regarde que titre, description et marque).
 */

const SITE_URL = "https://www.toolzy.io";
export const MIN_DEPOSIT_EUR = 50;
export const MIN_DISCOUNT_AFTER_DAYS = 2;

export class InvalidListingUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidListingUpdateError";
  }
}

/** Le tarif d'une annonce de boutique se gère dans Toolzy Pro. */
export class ProListingPricingError extends Error {
  constructor() {
    super("Tarif géré dans Toolzy Pro");
    this.name = "ProListingPricingError";
  }
}

interface PolicyRow {
  id: string;
  base_price: number | string | null;
  delivery_yn: boolean | null;
  delivery_price: number | string | null;
  training_yn: boolean | null;
  training: number | string | null;
  discount_after_days: number | null;
  discounted_daily_price: number | string | null;
}

interface ListingRow {
  id: string;
  name: string | null;
  slug: string | null;
  caution: number | string | null;
  moderation: string | null;
  paused_by_user: boolean | null;
  shop_id: string | null;
  views: number | null;
  price_policy: PolicyRow | null;
}

export interface Pricing {
  price_per_day_eur: number | null;
  deposit_eur: number | null;
  delivery_price_eur: number | null;
  coaching_price_eur: number | null;
  long_rental_discount: { after_days: number; price_per_day_eur: number } | null;
}

export interface ListingView extends Pricing {
  title: string;
  url: string | null;
  status: string;
  shop_listing: boolean;
  views: number;
}

const LISTING_COLUMNS =
  "id, name, slug, caution, moderation, paused_by_user, shop_id, views, " +
  "price_policy(id, base_price, delivery_yn, delivery_price, training_yn, training, discount_after_days, discounted_daily_price)";

const num = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export function pricingOf(deposit: number | string | null, policy: PolicyRow | null): Pricing {
  const afterDays = policy?.discount_after_days ?? null;
  const discounted = num(policy?.discounted_daily_price);
  return {
    price_per_day_eur: num(policy?.base_price),
    deposit_eur: num(deposit),
    delivery_price_eur: policy?.delivery_yn ? num(policy.delivery_price) : null,
    coaching_price_eur: policy?.training_yn ? num(policy.training) : null,
    long_rental_discount:
      afterDays !== null && discounted !== null ? { after_days: afterDays, price_per_day_eur: discounted } : null,
  };
}

function statusOf(row: ListingRow): string {
  if (row.paused_by_user) return "en pause";
  switch (row.moderation) {
    case "validated":
      return "en ligne";
    case "pending":
      return "en cours de modération";
    case "rejected":
      return "refusée en modération";
    default:
      return row.moderation ?? "inconnu";
  }
}

export function toListingView(row: ListingRow): ListingView {
  return {
    title: row.name ?? "Sans titre",
    url: row.slug ? `${SITE_URL}/listings/${encodeURIComponent(row.slug)}` : null,
    status: statusOf(row),
    shop_listing: row.shop_id !== null,
    views: row.views ?? 0,
    ...pricingOf(row.caution, row.price_policy),
  };
}

/** Annonces dont l'utilisateur est propriétaire (filtre explicite, voir UserSession). */
export async function listMyListings(
  session: UserSession,
  { limit = 30 }: { limit?: number },
): Promise<{ count: number; listings: ListingView[] }> {
  const { data, error } = await session.db
    .from("tools")
    .select(LISTING_COLUMNS)
    .eq("owner", session.userId)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<ListingRow[]>();
  if (error) throw new Error(`Lecture des annonces refusée : ${error.message}`);
  const listings = (data ?? []).map(toListingView);
  return { count: listings.length, listings };
}

export interface ListingChanges {
  pricePerDay?: number;
  deposit?: number;
  /** null : livraison désactivée. */
  deliveryPrice?: number | null;
  /** null : accompagnement désactivé. */
  coachingPrice?: number | null;
  /** null : remise longue durée désactivée. */
  longRentalDiscount?: { afterDays: number; dailyPrice: number } | null;
}

const positive = (value: number, label: string) => {
  if (!Number.isFinite(value) || value <= 0) throw new InvalidListingUpdateError(`${label} doit être supérieur à 0 €.`);
};

/** Valide les changements et construit la mise à jour de `price_policies`. */
export function buildPolicyPatch(changes: ListingChanges, current: Pricing): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (changes.pricePerDay !== undefined) {
    positive(changes.pricePerDay, "Le prix par jour");
    patch.base_price = changes.pricePerDay;
  }
  if (changes.deliveryPrice !== undefined) {
    if (changes.deliveryPrice !== null) positive(changes.deliveryPrice, "Le prix de livraison");
    patch.delivery_yn = changes.deliveryPrice !== null;
    patch.delivery_price = changes.deliveryPrice;
  }
  if (changes.coachingPrice !== undefined) {
    if (changes.coachingPrice !== null) positive(changes.coachingPrice, "Le prix de l'accompagnement");
    patch.training_yn = changes.coachingPrice !== null;
    patch.training = changes.coachingPrice;
  }
  if (changes.longRentalDiscount !== undefined) {
    const discount = changes.longRentalDiscount;
    if (discount !== null) {
      if (!Number.isInteger(discount.afterDays) || discount.afterDays < MIN_DISCOUNT_AFTER_DAYS) {
        throw new InvalidListingUpdateError(`La remise longue durée commence à ${MIN_DISCOUNT_AFTER_DAYS} jours minimum.`);
      }
      positive(discount.dailyPrice, "Le prix remisé");
      const basePrice = changes.pricePerDay ?? current.price_per_day_eur;
      if (basePrice !== null && discount.dailyPrice >= basePrice) {
        throw new InvalidListingUpdateError("Le prix remisé doit être inférieur au prix par jour.");
      }
    }
    patch.discount_after_days = discount?.afterDays ?? null;
    patch.discounted_daily_price = discount?.dailyPrice ?? null;
  }
  return patch;
}

/**
 * Modifie le tarif et/ou la caution d'une annonce de l'utilisateur. Toutes
 * les règles sont vérifiées avant la première écriture ; chaque écriture
 * est filtrée sur l'annonce et son propriétaire, et doit toucher une ligne.
 */
export async function updateMyListing(
  session: UserSession,
  { listingUrl, ...changes }: { listingUrl: string } & ListingChanges,
): Promise<{ listing: string; url: string | null; before: Pricing; after: Pricing }> {
  if (Object.values(changes).every((value) => value === undefined)) {
    throw new InvalidListingUpdateError("Aucune modification demandée.");
  }
  if (changes.deposit !== undefined && !(Number.isFinite(changes.deposit) && changes.deposit >= MIN_DEPOSIT_EUR)) {
    throw new InvalidListingUpdateError(`La caution doit être d'au moins ${MIN_DEPOSIT_EUR} €.`);
  }

  const slug = parseListingSlug(listingUrl);
  if (!slug) throw new ListingNotFoundError();
  const { data: row, error } = await session.db
    .from("tools")
    .select(LISTING_COLUMNS)
    .eq("slug", slug)
    .eq("owner", session.userId)
    .maybeSingle<ListingRow>();
  if (error) throw new Error(`Lecture de l'annonce refusée : ${error.message}`);
  if (!row) throw new ListingNotFoundError();

  const before = pricingOf(row.caution, row.price_policy);
  const policyPatch = buildPolicyPatch(changes, before);
  const changesPricing = Object.keys(policyPatch).length > 0;
  if (changesPricing && row.shop_id !== null) throw new ProListingPricingError();
  if (changesPricing && !row.price_policy) throw new Error("Annonce sans grille tarifaire");

  let policy = row.price_policy;
  if (changesPricing && row.price_policy) {
    const { data: updated, error: policyError } = await session.db
      .from("price_policies")
      .update(policyPatch)
      .eq("id", row.price_policy.id)
      .eq("tool_id", row.id)
      .select("id, base_price, delivery_yn, delivery_price, training_yn, training, discount_after_days, discounted_daily_price")
      .maybeSingle<PolicyRow>();
    if (policyError) throw new Error(`Mise à jour du tarif refusée : ${policyError.message}`);
    // Une mise à jour bloquée par la RLS ne renvoie pas d'erreur : on vérifie qu'elle a porté.
    if (!updated) throw new Error("Mise à jour du tarif : aucune ligne modifiée");
    policy = updated;
  }

  let deposit = row.caution;
  if (changes.deposit !== undefined) {
    const { data: updated, error: toolError } = await session.db
      .from("tools")
      .update({ caution: changes.deposit })
      .eq("id", row.id)
      .eq("owner", session.userId)
      .select("id, caution")
      .maybeSingle<{ id: string; caution: number | string | null }>();
    if (toolError) throw new Error(`Mise à jour de la caution refusée : ${toolError.message}`);
    if (!updated) throw new Error("Mise à jour de la caution : aucune ligne modifiée");
    deposit = updated.caution;
  }

  return {
    listing: row.name ?? "Sans titre",
    url: toListingView(row).url,
    before,
    after: pricingOf(deposit, policy),
  };
}
