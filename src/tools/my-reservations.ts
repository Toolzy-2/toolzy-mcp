import type { UserSession } from "../lib/auth/userSession";
import { firstNamesOf } from "../lib/auth/userSession";

export const RESERVATION_ROLES = ["tous", "locataire", "proprietaire"] as const;
export const RESERVATION_PERIODS = ["toutes", "a_venir", "en_cours", "passees"] as const;
export type ReservationRole = (typeof RESERVATION_ROLES)[number];
export type ReservationPeriod = (typeof RESERVATION_PERIODS)[number];

const SITE_URL = "https://www.toolzy.io";

export interface ReservationRow {
  id: string;
  user_id: string | null;
  owner_id: string | null;
  start_date: string;
  end_date: string;
  status: string | null;
  annonce_title: string | null;
  amount: number | null;
  currency: string | null;
  created_at: string;
  tools: { name: string | null; slug: string | null } | null;
}

export interface ReservationView {
  reservation_id: string;
  tool: string;
  tool_url: string | null;
  my_role: "locataire" | "propriétaire";
  counterpart_first_name: string | null;
  start_date: string;
  end_date: string;
  status: string;
  /** Montant total payé par le locataire (loyer, frais et garantie compris). */
  total_paid_eur: number | null;
  booked_at: string;
}

const STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  pending: "en attente de réponse du propriétaire",
  accepted: "acceptée",
  refused: "refusée",
  cancelled: "annulée",
  complete: "terminée",
});

export const statusLabel = (status: string | null): string =>
  status ? (STATUS_LABELS[status] ?? status) : "inconnu";

export interface PeriodBounds {
  startAfter?: string;
  startOnOrBefore?: string;
  endOnOrAfter?: string;
  endBefore?: string;
}

/** Bornes de dates (format AAAA-MM-JJ) d'une période, relativement à `today`. */
export function periodBounds(period: ReservationPeriod, today: string): PeriodBounds {
  switch (period) {
    case "a_venir":
      return { startAfter: today };
    case "en_cours":
      return { startOnOrBefore: today, endOnOrAfter: today };
    case "passees":
      return { endBefore: today };
    default:
      return {};
  }
}

export function toReservationView(
  row: ReservationRow,
  userId: string,
  names: ReadonlyMap<string, string>,
): ReservationView {
  const iAmRenter = row.user_id === userId;
  const counterpartId = iAmRenter ? row.owner_id : row.user_id;
  const slug = row.tools?.slug;
  return {
    reservation_id: row.id,
    tool: row.annonce_title ?? row.tools?.name ?? "Annonce supprimée",
    tool_url: slug ? `${SITE_URL}/listings/${encodeURIComponent(slug)}` : null,
    my_role: iAmRenter ? "locataire" : "propriétaire",
    counterpart_first_name: counterpartId ? (names.get(counterpartId) ?? null) : null,
    start_date: row.start_date,
    end_date: row.end_date,
    status: statusLabel(row.status),
    total_paid_eur: typeof row.amount === "number" ? row.amount / 100 : null,
    booked_at: row.created_at,
  };
}

/** Date du jour à Paris, au format AAAA-MM-JJ (les dates de location sont locales). */
export const todayInParis = (now: Date = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(now);

export interface ListMyReservationsArgs {
  role?: ReservationRole;
  period?: ReservationPeriod;
  limit?: number;
}

/**
 * Réservations de l'utilisateur, comme locataire et comme propriétaire. La RLS
 * ne renvoie que celles auxquelles il participe ; le filtre de rôle ne fait
 * que restreindre ce périmètre.
 */
export async function listMyReservations(
  session: UserSession,
  { role = "tous", period = "toutes", limit = 20 }: ListMyReservationsArgs,
): Promise<{ count: number; reservations: ReservationView[] }> {
  const bounds = periodBounds(period, todayInParis());
  let query = session.db
    .from("reservations")
    .select("id, user_id, owner_id, start_date, end_date, status, annonce_title, amount, currency, created_at, tools(name, slug)")
    .order("start_date", { ascending: period === "a_venir" })
    .limit(limit);

  if (role === "locataire") query = query.eq("user_id", session.userId);
  if (role === "proprietaire") query = query.eq("owner_id", session.userId);
  if (bounds.startAfter) query = query.gt("start_date", bounds.startAfter);
  if (bounds.startOnOrBefore) query = query.lte("start_date", bounds.startOnOrBefore);
  if (bounds.endOnOrAfter) query = query.gte("end_date", bounds.endOnOrAfter);
  if (bounds.endBefore) query = query.lt("end_date", bounds.endBefore);

  const { data, error } = await query.returns<ReservationRow[]>();
  if (error) throw new Error(`Lecture des réservations refusée : ${error.message}`);

  const rows = data ?? [];
  const counterparts = rows
    .map((r) => (r.user_id === session.userId ? r.owner_id : r.user_id))
    .filter((id): id is string => typeof id === "string");
  const names = await firstNamesOf(session.db, counterparts);
  const reservations = rows.map((r) => toReservationView(r, session.userId, names));
  return { count: reservations.length, reservations };
}
