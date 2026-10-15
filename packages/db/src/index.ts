import { SCHEMA_SQL } from "./schema";

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

export const schemaSql = () => SCHEMA_SQL;

/** Postgres via DATABASE_URL (Railway / Neon); PGlite (embedded) otherwise — used for tests and local dev. */
export async function connect(url = process.env.DATABASE_URL): Promise<Db> {
  let db: Db;
  if (url && url.startsWith("postgres")) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: url, max: 5 });
    db = {
      query: async (sql, params) => (await pool.query(sql, params as unknown[])).rows,
      close: () => pool.end(),
    };
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const lite = new PGlite(url && url !== "memory" ? url : undefined);
    db = {
      query: async <T,>(sql: string, params?: unknown[]) => (await lite.query<T>(sql, params)).rows,
      close: () => lite.close(),
    };
  }
  await migrate(db);
  return db;
}

export async function migrate(db: Db) {
  for (const stmt of schemaSql().split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
    await db.query(stmt);
  }
}

export * from "./repo";
