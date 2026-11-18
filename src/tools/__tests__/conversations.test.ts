import { describe, expect, it } from "vitest";
import {
  findConversation,
  ListingNotFoundError,
  OwnListingError,
  parseListingSlug,
  pickConversation,
  ReservationNotFoundError,
  type Counterpart,
} from "../conversations";
import { fakeSession, has, ME, operation, type Query } from "./fakeDb";

const OWNER = "22222222-2222-2222-2222-222222222222";
const TOOL = "44444444-4444-4444-4444-444444444444";
const RESA = "55555555-5555-5555-5555-555555555555";

const conv = (id: string, overrides: Partial<{ tool_id: string | null; reservation_ids: string[] | null }> = {}) => ({
  id,
  participants: [ME, OWNER],
  tool_id: null,
  reservation_ids: null,
  last_message_at: null,
  ...overrides,
});

describe("parseListingSlug", () => {
  it("lit le slug d'une URL toolzy.io ou le slug seul", () => {
    expect(parseListingSlug("https://www.toolzy.io/listings/perceuse-bosch?x=1")).toBe("perceuse-bosch");
    expect(parseListingSlug("perceuse-bosch")).toBe("perceuse-bosch");
  });

  it("refuse ce qui n'est pas un slug", () => {
    expect(parseListingSlug("a,b")).toBeNull();
    expect(parseListingSlug("https://www.toolzy.io/listings/%E0%A4%A")).toBeNull();
    expect(parseListingSlug("")).toBeNull();
  });
});

describe("pickConversation — mêmes règles que le site", () => {
  const fromListing: Counterpart = { userId: OWNER, toolId: TOOL, toolName: "x", reservationId: null, canStart: true };
  const fromReservation: Counterpart = { ...fromListing, reservationId: RESA };

  it("depuis une annonce : seulement une conversation sur le même outil", () => {
    expect(pickConversation([conv("a"), conv("b", { tool_id: TOOL })], fromListing)?.id).toBe("b");
    expect(pickConversation([conv("a")], fromListing)).toBeUndefined();
  });

  it("depuis une réservation : celle qui la référence, puis même outil, puis même paire", () => {
    const rows = [conv("a"), conv("b", { tool_id: TOOL }), conv("c", { reservation_ids: [RESA] })];
    expect(pickConversation(rows, fromReservation)?.id).toBe("c");
    expect(pickConversation(rows.slice(0, 2), fromReservation)?.id).toBe("b");
    expect(pickConversation(rows.slice(0, 1), fromReservation)?.id).toBe("a");
  });
});

describe("find_conversation", () => {
  const listing = { id: TOOL, owner: OWNER, name: "Perceuse", moderation: "validated", paused_by_user: false };

  const scripted = (tool: unknown, conversations: unknown[], reservation: unknown = null) =>
    fakeSession((query: Query) => {
      if (query.table === "tools") return { data: tool, error: null };
      if (query.table === "reservations") return { data: reservation, error: null };
      if (query.table === "conversations") return { data: conversations, error: null };
      if (query.table === "users") return { data: [{ id: OWNER, prenom: "Olivier" }], error: null };
      return { data: null, error: null };
    });

  it("trouve la conversation existante avec le propriétaire de l'annonce, sans rien écrire", async () => {
    const { session, queries } = scripted(listing, [conv("c-1", { tool_id: TOOL })]);

    const result = await findConversation(session, { listingUrl: "perceuse-bosch" });

    expect(result).toMatchObject({ exists: true, conversation_id: "c-1", with: "Olivier", tool: "Perceuse" });
    expect(queries.every((q) => operation(q) === "select")).toBe(true);
    const lookup = queries.find((q) => q.table === "conversations") as Query;
    expect(lookup.calls).toContainEqual(["contains", "participants", [ME, OWNER]]);
  });

  it("indique qu'aucune conversation n'existe et si l'on peut en ouvrir une", async () => {
    const { session } = scripted(listing, []);
    expect(await findConversation(session, { listingUrl: "perceuse-bosch" })).toMatchObject({
      exists: false,
      conversation_id: null,
      can_start_new: true,
    });

    const paused = scripted({ ...listing, paused_by_user: true }, []);
    expect(await findConversation(paused.session, { listingUrl: "perceuse-bosch" })).toMatchObject({
      exists: false,
      can_start_new: false,
    });
  });

  it("refuse sa propre annonce et une annonce inconnue", async () => {
    await expect(
      findConversation(scripted({ ...listing, owner: ME }, []).session, { listingUrl: "x" }),
    ).rejects.toBeInstanceOf(OwnListingError);
    await expect(findConversation(scripted(null, []).session, { listingUrl: "x" })).rejects.toBeInstanceOf(
      ListingNotFoundError,
    );
  });

  it("depuis une réservation : ne lit que les réservations de l'utilisateur", async () => {
    const reservation = { id: RESA, user_id: ME, owner_id: OWNER, tool_id: TOOL, annonce_title: "Perceuse" };
    const { session, queries } = scripted(null, [conv("c-2", { reservation_ids: [RESA] })], reservation);

    const result = await findConversation(session, { reservationId: RESA });

    expect(result).toMatchObject({ exists: true, conversation_id: "c-2" });
    const lookup = queries.find((q) => q.table === "reservations") as Query;
    expect(lookup.calls).toContainEqual(["or", `user_id.eq.${ME},owner_id.eq.${ME}`]);
  });

  it("une réservation d'autrui est introuvable", async () => {
    const { session, queries } = scripted(null, [], null);

    await expect(findConversation(session, { reservationId: RESA })).rejects.toBeInstanceOf(ReservationNotFoundError);
    expect(queries.some((q) => q.table === "conversations" && has(q, "select"))).toBe(false);
  });
});
