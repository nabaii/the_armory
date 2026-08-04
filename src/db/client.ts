import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "@/db/schema";

/**
 * DATABASE CLIENT.
 *
 * Phase 1 deliberately had no database — see the note in src/server/crm.ts.
 * Phase 2 needs one for accounts, leagues and scores, and the threat model does
 * not relax: we now hold a RECURRING schedule against named individuals, which
 * is strictly worse than a one-off booking.
 *
 * ---------------------------------------------------------------------------
 * WHY THE NEON HTTP DRIVER
 *
 * It speaks HTTP via `fetch` rather than holding a TCP pool, which keeps the
 * runtime-agnostic property Phase 1 was built around: nothing here depends on a
 * Node socket, so the hosting decision stays late and reversible and can be made
 * from measured Nigerian latency rather than vendor documentation.
 *
 * The trade-off is real and worth stating: HTTP means no transactions spanning
 * multiple statements. Anywhere Phase 2 needs atomicity — redeeming a sign-in
 * token, ingesting a batch of scores — it must be expressed as a single
 * statement with the guard in its WHERE clause, not as read-then-write. Those
 * places are called out where they occur.
 *
 * ---------------------------------------------------------------------------
 * UNCONFIGURED IS LOUD, NOT SILENT
 *
 * Accessing `db` without DATABASE_URL throws immediately with a message that
 * says what to do. It does not return a stub that quietly succeeds — the same
 * rule as the intake layer in Phase 1: never let a data path appear to work
 * when it is doing nothing.
 */

const connectionString = process.env.DATABASE_URL?.trim();

export const isDatabaseConfigured = (): boolean => Boolean(connectionString);

function connect() {
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Phase 2 features (accounts, leagues, scores) " +
        "require a Postgres connection. Set DATABASE_URL to a Neon or Supabase " +
        "connection string. Phase 1 marketing pages do not need it.",
    );
  }
  return drizzle(neon(connectionString), { schema });
}

/**
 * Lazily constructed, so importing this module never throws and the static
 * marketing build — which touches none of this — keeps working without a
 * database URL present at build time.
 */
let instance: ReturnType<typeof connect> | null = null;

export function getDb() {
  if (!instance) instance = connect();
  return instance;
}

export { schema };
