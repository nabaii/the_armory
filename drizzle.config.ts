import type { Config } from "drizzle-kit";
import { tlsOptions } from "./src/db/tls";

/**
 * Load `.env.local` before the credentials below are read.
 *
 * Next.js loads that file for `next dev` and `next build`, but drizzle-kit is its own
 * CLI and does not — so without this, `npm run db:migrate` fails with an empty url
 * even though the app is configured correctly. This runs at module evaluation, which
 * is before the object literal at the bottom reads `process.env`.
 *
 * `process.loadEnvFile` is Node's own, so this needs no dependency. Wrapped because it
 * throws when the file is absent, which is the normal case in CI where the variable
 * arrives from the environment instead.
 */
try {
  process.loadEnvFile(".env.local");
} catch {
  /* No .env.local — DATABASE_URL may still be set in the shell. */
}

/**
 * Drizzle Kit — migration generation for the Phase 2 schema.
 *
 *   npm run db:generate   # schema → SQL migration, no database needed
 *   npm run db:migrate    # apply to DATABASE_URL
 *
 * Migrations are generated and committed rather than pushed. `db:push` diffs a
 * live database and applies changes directly, which is convenient in
 * development and wrong here: this schema will hold members' scores and a
 * recurring schedule of who is where and when. Those changes need to be
 * reviewable in a pull request and replayable on a restore, not applied by a
 * command someone ran locally.
 */
export default {
  /**
   * Two schema files, two Postgres schemas.
   *
   *   src/db/schema.ts        `public` — the Phase 2 leagues product.
   *   src/db/armory/schema.ts `armory` — the management system.
   *
   * They are separated because both specifications need the table names
   * `rounds` and `sessions` for different things; see the header of
   * src/db/armory/schema.ts. Generating them together keeps one migration
   * history, which is what a restore replays.
   */
  schema: ["./src/db/schema.ts", "./src/db/armory/schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
    /**
     * THE SAME TLS RULE THE APPLICATION USES — src/db/tls.ts.
     *
     * Without this, migrations against any managed provider that requires TLS
     * fail as `ECONNRESET`, which drizzle-kit swallows into exit code 1 with an
     * empty stderr and a spinner that just stops. The database stays empty and
     * nothing says why. That is how this was found.
     *
     * §10 wants TLS on every connection carrying this data, and a migration
     * runner connects to the same database with the same credentials as the
     * application — there was never a reason for it to be the exception.
     */
    ssl: tlsOptions(process.env.DATABASE_URL ?? ""),
  },
  /* Fail loudly on a destructive diff rather than dropping a column of scores. */
  strict: true,
  verbose: true,
} satisfies Config;
