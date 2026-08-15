import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { getPool, isDatabaseUrlSet, registerPoolReset } from "@/db/pool";

/**
 * DATABASE CLIENT — the leagues product (`public` schema).
 *
 * Phase 1 deliberately had no database — see the note in src/server/crm.ts.
 * Phase 2 needs one for accounts, leagues and scores, and the threat model does
 * not relax: we now hold a RECURRING schedule against named individuals, which
 * is strictly worse than a one-off booking.
 *
 * ===========================================================================
 * THIS USED TO BE THE NEON HTTP DRIVER, AND THE REASONING IS WORTH KEEPING
 *
 * The original header argued for `drizzle-orm/neon-http`:
 *
 *   "It speaks HTTP via `fetch` rather than holding a TCP pool, which keeps the
 *    runtime-agnostic property Phase 1 was built around: nothing here depends
 *    on a Node socket, so the hosting decision stays late and reversible and
 *    can be made from measured Nigerian latency rather than vendor
 *    documentation."
 *
 * The argument was sound and the conclusion was backwards, which is the useful
 * thing to record. The Neon HTTP driver speaks only to NEON — it posts SQL to
 * an endpoint derived from the hostname — so the driver chosen to keep hosting
 * open was the one component that fixed the vendor. Meanwhile the management
 * system, on `pg`, ran against anything.
 *
 * And the property it bought — an edge-compatible runtime — was never used.
 * Nothing in this repository sets `runtime = "edge"`.
 *
 * So both halves now share one pool: src/db/pool.ts, which carries the full
 * reasoning and the TLS rules.
 *
 * ===========================================================================
 * THE TRANSACTION CAVEAT IS LIFTED. THE CODE WRITTEN UNDER IT IS STILL RIGHT.
 *
 * The old header warned:
 *
 *   "HTTP means no transactions spanning multiple statements. Anywhere Phase 2
 *    needs atomicity — redeeming a sign-in token, ingesting a batch of scores —
 *    it must be expressed as a single statement with the guard in its WHERE
 *    clause, not as read-then-write."
 *
 * Those single-statement writes are NOT being unpicked, and nobody should
 * unpick them. A guard in a WHERE clause is stronger than a transaction, not
 * weaker: it is atomic against concurrent writers without holding a lock, and
 * `redeemAuthToken` marking a token used in the same statement that reads it is
 * the reason a sign-in link cannot be redeemed twice.
 *
 * What changes is that it is now a choice rather than a constraint. A future
 * write that genuinely needs three statements to move together can have a
 * transaction, the way the management system already does for §8.3's allowance.
 *
 * ===========================================================================
 * UNCONFIGURED IS LOUD, NOT SILENT
 *
 * Accessing `db` without DATABASE_URL throws immediately with a message that
 * says what to do. It does not return a stub that quietly succeeds — the same
 * rule as the intake layer in Phase 1: never let a data path appear to work
 * when it is doing nothing.
 */

export const isDatabaseConfigured = isDatabaseUrlSet;

/**
 * No `casing` option, deliberately.
 *
 * The management system passes `casing: "snake_case"` because its schema leans
 * on the convention. Every column in src/db/schema.ts names itself explicitly —
 * `email: text("email")` — so a casing rule here would be inert at best and, if
 * a column were ever added without an explicit name, would silently change
 * which column it resolved to. Left off so the schema stays the only authority.
 */
const connect = () => drizzle(getPool(), { schema });

let instance: ReturnType<typeof connect> | null = null;

registerPoolReset(() => {
  instance = null;
});

/**
 * Lazily constructed, so importing this module never throws and the static
 * marketing build — which touches none of this — keeps working without a
 * database URL present at build time.
 */
export function getDb() {
  if (!instance) instance = connect();
  return instance;
}

export { schema };
