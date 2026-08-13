/**
 * ENFORCEMENT PROOF RUNNER — §12.
 *
 *   npm run db:prove
 *
 * §12: "Every append-only table rejects update and delete at the database level, not
 * merely in application code."
 *
 * scripts/enforcement.test.sql is the proof. This runs it.
 *
 * ============================================================================
 * WHY THIS EXISTS INSTEAD OF CALLING psql
 *
 * The script used to be `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f …`, which is the
 * right tool and requires PostgreSQL client binaries to be installed. On the machine
 * this is developed on they are not, so the one check that verifies §12's central
 * claim silently could not be run — which is a worse outcome than a slightly unusual
 * runner.
 *
 * `pg` is already a dependency (src/db/armory/client.ts uses it), speaks the wire
 * protocol directly, and supports the real transaction the SQL file needs. So there is
 * nothing to install.
 *
 * ============================================================================
 * TWO THINGS THE SQL FILE NEEDS THAT ARE HANDLED HERE
 *
 *   · `\set ON_ERROR_STOP on` is a psql meta-command, not SQL. It is stripped. The
 *     behaviour it asks for is what `pg` does anyway: the first error rejects, and the
 *     surrounding transaction is aborted.
 *
 *   · The file wraps itself in BEGIN … ROLLBACK so it "leaves nothing behind and can
 *     be run against staging". That works unchanged — it is sent as one script and
 *     `pg` honours the explicit transaction control inside it.
 *
 * The whole file is sent as a SINGLE query rather than split on semicolons. That
 * matters: the assertions are `DO $$ … $$` blocks full of semicolons, and any splitter
 * naive enough to be worth writing would cut them in half.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const SQL_PATH = join(process.cwd(), "scripts", "enforcement.test.sql");

const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

async function prove(): Promise<void> {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. The enforcement proof runs against a real database " +
        "by design — §12 requires the rejection to come from Postgres, not from " +
        "TypeScript. Put it in .env.local.",
    );
  }

  /* Strip psql meta-commands. Anything starting with a backslash at the beginning of
     a line is psql's, not Postgres's. */
  const script = readFileSync(SQL_PATH, "utf8")
    .split("\n")
    .filter((line) => !/^\s*\\/.test(line))
    .join("\n");

  const client = new Client({
    connectionString,
    /* §10 requires TLS in transit. Local development has no certificate to verify. */
    ssl: /@(localhost|127\.0\.0\.1|::1)[:/]/.test(connectionString)
      ? undefined
      : { rejectUnauthorized: true },
  });

  /**
   * The PASS lines in the SQL file are raised as NOTICEs, and they are the entire
   * useful output. Without this listener they are discarded and a successful run prints
   * nothing at all — which is indistinguishable from a run that did not happen.
   */
  const notices: string[] = [];
  client.on("notice", (notice) => {
    if (notice.message) notices.push(notice.message);
  });

  await client.connect();

  try {
    console.log(`\n${bold("Enforcement proof")} ${dim("(§12 — append-only, at the database)")}\n`);

    await client.query(script);

    for (const notice of notices) console.log(`  ${green("PASS")}  ${notice}`);

    console.log(
      `\n${green(bold("Enforcement holds."))} ` +
        dim(`${notices.length} assertion${notices.length === 1 ? "" : "s"}, rolled back.\n`),
    );
  } finally {
    await client.end();
  }
}

prove().catch((error: unknown) => {
  /* A failure here is not a broken script — it is very likely a real finding: a table
     that accepted an UPDATE it should have refused. The message from Postgres names
     the assertion, so it is printed as-is rather than summarised. */
  console.error(`\n${red(bold("Enforcement proof failed."))}\n`);
  console.error(error instanceof Error ? error.message : error);
  console.error(
    dim(
      "\nIf this names a table that accepted a write, the trigger in " +
        "drizzle/0002_armory_enforcement.sql is missing or was dropped.\n",
    ),
  );
  process.exit(1);
});
