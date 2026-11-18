/** Ce dont la garde a besoin d'un pool pg (permet un faux pool en test). */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** Pool, ou fonction qui le fournit à la demande (création paresseuse, peut échouer). */
export type DbSource = Queryable | (() => Queryable);

export const resolveDb = (source: DbSource): Queryable => (typeof source === "function" ? source() : source);
