import type { Config } from "drizzle-kit";

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
  },
  /* Fail loudly on a destructive diff rather than dropping a column of scores. */
  strict: true,
  verbose: true,
} satisfies Config;
