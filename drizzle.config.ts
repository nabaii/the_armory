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
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  /* Fail loudly on a destructive diff rather than dropping a column of scores. */
  strict: true,
  verbose: true,
} satisfies Config;
