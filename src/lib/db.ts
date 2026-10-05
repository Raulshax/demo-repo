import "server-only";
import pg from "pg";

// numeric -> number, date -> string (YYYY-MM-DD) for predictable serialisation
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1082, (v) => v);

const globalForPool = globalThis as unknown as { __pool?: pg.Pool };

export const pool =
  globalForPool.__pool ??
  new pg.Pool({ connectionString: process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL, max: 10 });
if (process.env.NODE_ENV !== "production") globalForPool.__pool = pool;

export type Role =
  | "contractor_user"
  | "contractor_manager"
  | "contractor_exec"
  | "supplier"
  | "platform_admin";

export type OrgKind = "contractor" | "supplier" | "platform";

export interface Actor {
  userId: string;
  orgId: string;
  role: Role;
  orgKind: OrgKind;
}

export type Tx = pg.PoolClient;

/**
 * Runs fn inside a transaction with the tenant context set, so every statement is
 * filtered by Row Level Security for this actor.
 */
export async function withActor<T>(actor: Actor | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true),
              set_config('app.role', $3, true), set_config('app.org_kind', $4, true)`,
      [actor?.userId ?? "", actor?.orgId ?? "", actor?.role ?? "", actor?.orgKind ?? ""],
    );
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function rows<T = Record<string, unknown>>(tx: Tx, sql: string, params: unknown[] = []) {
  return (await tx.query(sql, params)).rows as T[];
}

export async function one<T = Record<string, unknown>>(tx: Tx, sql: string, params: unknown[] = []) {
  const r = (await tx.query(sql, params)).rows as T[];
  return r[0] ?? null;
}
