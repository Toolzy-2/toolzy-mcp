import { describe, expect, it } from "vitest";
import { ListingNotFoundError } from "../conversations";
import {
  InvalidListingUpdateError,
  listMyListings,
  ProListingPricingError,
  updateMyListing,
} from "../my-listings";
import { fakeSession, ME, operation, type Query } from "./fakeDb";

const TOOL = "44444444-4444-4444-4444-444444444444";
const POLICY = "66666666-6666-6666-6666-666666666666";

const POLICY_ROW = {
  id: POLICY,
  base_price: 7,
  delivery_yn: true,
  delivery_price: 10,
  training_yn: false,
  training: null,
  discount_after_days: null,
  discounted_daily_price: null,
};
const TOOL_ROW = {
  id: TOOL,
  name: "Perceuse Bosch",
  slug: "perceuse-bosch",
  caution: 70,
  moderation: "validated",
  paused_by_user: false,
  shop_id: null,
  views: 12,
  price_policy: POLICY_ROW,
};

interface Script {
  tool?: unknown;
  updatedPolicy?: unknown;
  updatedTool?: unknown;
}

const scripted = (script: Script) =>
  fakeSession((query: Query) => {
    const op = operation(query);
    if (query.table === "tools" && op === "select") return { data: script.tool ?? null, error: null };
    if (query.table === "tools" && op === "update") return { data: script.updatedTool ?? null, error: null };
    if (query.table === "price_policies" && op === "update") return { data: script.updatedPolicy ?? null, error: null };
    return { data: null, error: null };
  });

const byOp = (queries: Query[], table: string, op: string) => queries.filter((q) => q.table === table && operation(q) === op);
const listingUrl = "https://www.toolzy.io/listings/perceuse-bosch";

describe("list_my_listings", () => {
  it("ne liste que les annonces de l'utilisateur, avec leur tarif", async () => {
    const { session, queries } = fakeSession(() => ({ data: [TOOL_ROW], error: null }));

    const result = await listMyListings(session, {});

    expect(queries[0].calls).toContainEqual(["eq", "owner", ME]);
    expect(result.listings[0]).toMatchObject({
      title: "Perceuse Bosch",
      url: "https://www.toolzy.io/listings/perceuse-bosch",
      status: "en ligne",
      price_per_day_eur: 7,
      deposit_eur: 70,
      delivery_price_eur: 10,
      coaching_price_eur: null,
      long_rental_discount: null,
    });
  });
});

describe("update_my_listing", () => {
  it("change le prix par jour de sa propre annonce et renvoie l'avant/après", async () => {
    const { session, queries } = scripted({
      tool: TOOL_ROW,
      updatedPolicy: { ...POLICY_ROW, base_price: 10 },
    });

    const result = await updateMyListing(session, { listingUrl, pricePerDay: 10 });

    expect(result.before.price_per_day_eur).toBe(7);
    expect(result.after.price_per_day_eur).toBe(10);
    const lookup = byOp(queries, "tools", "select")[0];
    expect(lookup.calls).toContainEqual(["eq", "owner", ME]);
    const [update] = byOp(queries, "price_policies", "update");
    expect(update.calls[0]).toEqual(["update", { base_price: 10 }]);
    expect(update.calls).toContainEqual(["eq", "id", POLICY]);
    expect(update.calls).toContainEqual(["eq", "tool_id", TOOL]);
    // Le prix ne touche pas à `tools` : pas de remise en modération.
    expect(byOp(queries, "tools", "update")).toHaveLength(0);
  });

  it("n'agit pas sur l'annonce d'un autre, même avec un compte Admin", async () => {
    const { session, queries } = scripted({ tool: null });

    await expect(updateMyListing(session, { listingUrl, pricePerDay: 10 })).rejects.toBeInstanceOf(ListingNotFoundError);
    expect(byOp(queries, "price_policies", "update")).toHaveLength(0);
  });

  it("signale une mise à jour qui n'a touché aucune ligne au lieu de la croire faite", async () => {
    const { session } = scripted({ tool: TOOL_ROW, updatedPolicy: null });

    await expect(updateMyListing(session, { listingUrl, pricePerDay: 10 })).rejects.toThrow(/aucune ligne/);
  });

  it("applique les règles du formulaire du site", async () => {
    const cases = [
      { pricePerDay: 0 },
      { deposit: 49 },
      { deliveryPrice: -1 },
      { longRentalDiscount: { afterDays: 1, dailyPrice: 5 } },
      { longRentalDiscount: { afterDays: 3, dailyPrice: 8 } }, // pas moins cher que 7 €
      {},
    ];
    for (const changes of cases) {
      const { session, queries } = scripted({ tool: TOOL_ROW });
      await expect(updateMyListing(session, { listingUrl, ...changes })).rejects.toBeInstanceOf(InvalidListingUpdateError);
      expect(queries.filter((q) => operation(q) !== "select")).toHaveLength(0);
    }
  });

  it("désactive la livraison avec null, et active une remise longue durée", async () => {
    const { session, queries } = scripted({ tool: TOOL_ROW, updatedPolicy: POLICY_ROW });

    await updateMyListing(session, {
      listingUrl,
      deliveryPrice: null,
      longRentalDiscount: { afterDays: 3, dailyPrice: 5 },
    });

    expect(byOp(queries, "price_policies", "update")[0].calls[0]).toEqual([
      "update",
      { delivery_yn: false, delivery_price: null, discount_after_days: 3, discounted_daily_price: 5 },
    ]);
  });

  it("change la caution sur l'annonce, filtrée sur le propriétaire", async () => {
    const { session, queries } = scripted({ tool: TOOL_ROW, updatedTool: { id: TOOL, caution: 100 } });

    const result = await updateMyListing(session, { listingUrl, deposit: 100 });

    expect(result.after.deposit_eur).toBe(100);
    const [update] = byOp(queries, "tools", "update");
    expect(update.calls[0]).toEqual(["update", { caution: 100 }]);
    expect(update.calls).toContainEqual(["eq", "owner", ME]);
  });

  it("renvoie vers Toolzy Pro pour le tarif d'une annonce de boutique", async () => {
    const { session, queries } = scripted({ tool: { ...TOOL_ROW, shop_id: "shop-1" } });

    await expect(updateMyListing(session, { listingUrl, pricePerDay: 10 })).rejects.toBeInstanceOf(ProListingPricingError);
    expect(byOp(queries, "price_policies", "update")).toHaveLength(0);
  });
});
