import { describe, expect, it } from "vitest";
import { periodBounds, statusLabel, toReservationView, type ReservationRow } from "../my-reservations";

const ME = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

const row = (overrides: Partial<ReservationRow> = {}): ReservationRow => ({
  id: "r-1",
  user_id: ME,
  owner_id: OTHER,
  start_date: "2026-12-19",
  end_date: "2026-12-20",
  status: "accepted",
  annonce_title: "Perceuse Bosch",
  amount: 3800,
  currency: "eur",
  created_at: "2026-11-10T10:00:00Z",
  tools: { name: "Perceuse", slug: "perceuse-bosch" },
  ...overrides,
});

describe("toReservationView", () => {
  it("présente une location où je suis locataire", () => {
    const view = toReservationView(row(), ME, new Map([[OTHER, "Olivier"]]));

    expect(view).toEqual({
      reservation_id: "r-1",
      tool: "Perceuse Bosch",
      tool_url: "https://www.toolzy.io/listings/perceuse-bosch",
      my_role: "locataire",
      counterpart_first_name: "Olivier",
      start_date: "2026-12-19",
      end_date: "2026-12-20",
      status: "acceptée",
      total_paid_eur: 38,
      booked_at: "2026-11-10T10:00:00Z",
    });
  });

  it("présente une location où je suis propriétaire", () => {
    const view = toReservationView(row({ user_id: OTHER, owner_id: ME }), ME, new Map());

    expect(view.my_role).toBe("propriétaire");
    expect(view.counterpart_first_name).toBeNull();
  });

  it("tolère une annonce supprimée et un montant absent", () => {
    const view = toReservationView(row({ annonce_title: null, tools: null, amount: null }), ME, new Map());

    expect(view.tool).toBe("Annonce supprimée");
    expect(view.tool_url).toBeNull();
    expect(view.total_paid_eur).toBeNull();
  });

  it("encode le slug dans l'URL de l'annonce", () => {
    const view = toReservationView(row({ tools: { name: "x", slug: "a b/c" } }), ME, new Map());

    expect(view.tool_url).toBe("https://www.toolzy.io/listings/a%20b%2Fc");
  });
});

describe("statusLabel", () => {
  it("traduit les statuts connus et garde les autres tels quels", () => {
    expect(statusLabel("pending")).toBe("en attente de réponse du propriétaire");
    expect(statusLabel("refused")).toBe("refusée");
    expect(statusLabel("cancelled")).toBe("annulée");
    expect(statusLabel("complete")).toBe("terminée");
    expect(statusLabel("autre")).toBe("autre");
  });
});

describe("periodBounds", () => {
  const today = "2026-11-18";

  it("à venir : commence après aujourd'hui", () => {
    expect(periodBounds("a_venir", today)).toEqual({ startAfter: today });
  });

  it("en cours : a commencé et n'est pas finie", () => {
    expect(periodBounds("en_cours", today)).toEqual({ startOnOrBefore: today, endOnOrAfter: today });
  });

  it("passées : finie avant aujourd'hui", () => {
    expect(periodBounds("passees", today)).toEqual({ endBefore: today });
  });

  it("toutes : aucune borne", () => {
    expect(periodBounds("toutes", today)).toEqual({});
  });
});
