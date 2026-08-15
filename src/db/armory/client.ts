import { drizzle } from "drizzle-orm/node-postgres";
import * as armorySchema from "./schema";
import {
  closePool,
  getPool,
  isDatabaseUrlSet,
  registerPoolReset,
} from "@/db/pool";

/**
 * DATABASE CLIENT — the management system (`armory` schema).
 *
 * ===========================================================================
 * WHY THIS IS A SECOND CLIENT AND NOT src/db/client.ts
 *
 * It is no longer a second DRIVER — both halves now share one pool
 * (src/db/pool.ts). It remains a second CLIENT because the two products have
 * different schemas, and a drizzle instance is scoped to one.
 *
 * The original reason for the split was the driver, and it is worth keeping
 * because it is why the pool looks the way it does. The leagues product
 * connected over the Neon HTTP driver, whose header stated the trade-off:
 *
 *   "The trade-off is real and worth stating: HTTP means no transactions
 *    spanning multiple statements. Anywhere Phase 2 needs atomicity … it must
 *    be expressed as a single statement with the guard in its WHERE clause."
 *
 * That was a sound trade for leagues. It was never available to this system,
 * because the Build Specification requires multi-statement atomicity in the one
 * place it is least willing to be wrong about — the guest allowance:
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
 * So this system has always held a real pooled TCP connection. What changed is
 * that the leagues half joined it rather than keeping a driver of its own.
 *
 * ===========================================================================
 * UNCONFIGURED IS LOUD, NOT SILENT
 *
 * The same rule as everywhere else in this codebase: accessing the database
 * without DATABASE_URL throws with a message that says what to do, rather than
 * returning a stub that quietly succeeds. A management system that appears to
 * check someone in and writes nothing is worse than one that is plainly down.
 */

export const isArmoryDatabaseConfigured = isDatabaseUrlSet;

/**
 * `casing: "snake_case"` because this schema leans on the convention, unlike
 * the leagues one which names every column explicitly. See src/db/client.ts.
 */
const connect = () =>
  drizzle(getPool(), { schema: armorySchema, casing: "snake_case" });

let instance: ReturnType<typeof connect> | null = null;

registerPoolReset(() => {
  instance = null;
});

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

/**
 * For tests and for graceful shutdown.
 *
 * Closes the SHARED pool, so the leagues client's cached instance is discarded
 * too — `registerPoolReset` is what makes that happen. Kept under this name
 * because every existing caller is a management-system test.
 */
export async function closeArmoryDb(): Promise<void> {
  await closePool();
}
