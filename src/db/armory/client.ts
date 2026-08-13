import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as armorySchema from "./schema";

/**
 * DATABASE CLIENT — the management system.
 *
 * ===========================================================================
 * WHY THIS IS A SECOND CLIENT, AND NOT src/db/client.ts
 *
 * The leagues product connects over the Neon HTTP driver, and its own header
 * comment states the trade-off plainly:
 *
 *   "The trade-off is real and worth stating: HTTP means no transactions
 *    spanning multiple statements. Anywhere Phase 2 needs atomicity … it must
 *    be expressed as a single statement with the guard in its WHERE clause."
 *
 * That was a sound trade for leagues. It is not available to this system,
 * because the Build Specification requires multi-statement atomicity in the
 * one place it is least willing to be wrong about — the guest allowance:
 *
 *   §3.2  "used_count is authoritative and mutated only server-side, inside a
 *          transaction."
 *   §6.2  "decrements allowance inside the same transaction as the booking
 *          write."
 *   §8.3  "host_allowances.used_count is mutated ONLY server-side, inside a
 *          transaction, with the invitation write."
 *
 * Three statements — read the allowance, write the invitation, increment the
 * counter — that must either all happen or none. The single-statement trick
 * cannot express it, and §8.3 names what goes wrong when it is not expressed:
 * "Two devices, one allowance."
 *
 * So the management system holds a real pooled TCP connection. §2 leaves the
 * server runtime to the team and asks only for "idempotent write endpoints",
 * and node-postgres speaks to any Postgres — Neon, Render, Supabase, or a
 * managed instance in whichever region measures best from Abuja (§2, hosting).
 * The hosting decision stays open; only the driver is fixed.
 *
 * ===========================================================================
 * UNCONFIGURED IS LOUD, NOT SILENT
 *
 * The same rule as everywhere else in this codebase: accessing the database
 * without DATABASE_URL throws with a message that says what to do, rather
 * than returning a stub that quietly succeeds. A management system that
 * appears to check someone in and writes nothing is worse than one that is
 * plainly down.
 */

const connectionString = process.env.DATABASE_URL?.trim();

export const isArmoryDatabaseConfigured = (): boolean => Boolean(connectionString);

let pool: Pool | null = null;

function connect() {
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. The Armory management system requires a " +
        "Postgres connection that supports transactions — see §3.2 and §8.3 " +
        "on the guest allowance. The marketing pages do not need it.",
    );
  }

  pool = new Pool({
    connectionString,
    /* Small on purpose. The club has a handful of tablets and one founder;
       the pool exists for transaction isolation, not for throughput, and a
       large idle pool against a managed Postgres is just billed connections. */
    max: 10,
    idleTimeoutMillis: 30_000,
    /* §2 asks for hosting with low latency to Nigeria, which in practice
       means the link is sometimes poor rather than absent. A connection
       attempt that hangs is indistinguishable at the desk from one that
       failed, and the desk has an offline path it should be falling back to. */
    connectionTimeoutMillis: 10_000,
    ssl: needsTls(connectionString) ? { rejectUnauthorized: true } : undefined,
  });

  /* An idle client erroring — a managed provider recycling a connection, a
     network blip — reaches the pool as an 'error' event. Unhandled, it is an
     uncaught exception that takes the process down. */
  pool.on("error", (error) => {
    console.error("[armory] idle database client error", error);
  });

  return drizzle(pool, { schema: armorySchema, casing: "snake_case" });
}

/**
 * Whether to demand TLS.
 *
 * §10 requires "TLS in transit", and this data is identity documents, home
 * addresses and firearm licences. The exception is a local connection during
 * development, where there is no certificate to verify and no network to
 * intercept. Anything else — including a hostname that merely looks local —
 * gets TLS with verification on, rather than the `rejectUnauthorized: false`
 * that turns TLS into decoration.
 */
function needsTls(url: string): boolean {
  if (process.env.NODE_ENV !== "production") {
    return !/@(localhost|127\.0\.0\.1|::1|host\.docker\.internal)[:/]/.test(url);
  }
  return true;
}

let instance: ReturnType<typeof connect> | null = null;

/** Lazily constructed, so importing this module never throws at build time. */
export function getArmoryDb() {
  if (!instance) instance = connect();
  return instance;
}

export type ArmoryDb = ReturnType<typeof connect>;

/**
 * A transaction handle, as the write layer sees it.
 *
 * Named so that a function's signature states whether it must be called
 * inside a transaction. `consumeAllowance(tx, …)` cannot be called with a
 * plain connection, which is the compile-time half of §8.3's rule.
 */
export type ArmoryTx = Parameters<Parameters<ArmoryDb["transaction"]>[0]>[0];

/**
 * Either a connection or a transaction — for functions that only READ.
 *
 * The distinction `ArmoryTx` draws is about writes: §3.2 and §8.3 require the
 * allowance and the invitation to move together, and a signature demanding a
 * transaction is what makes that a compile-time fact.
 *
 * A read carries no such obligation. `invitationForToken` resolving a guest link
 * (§6.3) is one SELECT on a page with nothing to make atomic, and forcing it
 * into a transaction would open one per page view for no benefit — and would
 * blunt the signal, because once every function takes an `ArmoryTx` the type
 * stops telling anyone anything.
 *
 * So: writes take `ArmoryTx`, reads take `ArmoryReader`, and the union means a
 * read composes freely inside a write's transaction.
 */
export type ArmoryReader = ArmoryDb | ArmoryTx;

export { armorySchema as schema };

/** For tests and for graceful shutdown. */
export async function closeArmoryDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    instance = null;
  }
}
