/**
 * PUBLISH THE CLUB'S WEEK.
 *
 *   npm run db:hours          # show what the database holds, change nothing
 *   npm run db:hours --apply  # write the declared week from src/content/club-week.ts
 *
 * ============================================================================
 * WHY THIS IS A SCRIPT AND NOT A MIGRATION
 *
 * A migration is structure. The club's opening hours are an operating decision
 * the founder will change — a late deck in December, a closed morning for a
 * competition — and a decision that lives in a migration can only be changed by
 * a deploy. §6.2's rule about calendars applies to the club's own week as much
 * as to a member's: the values belong in rows.
 *
 * It is not a founder SCREEN either, and that is a gap rather than a decision.
 * The screen is the obvious next piece of work; until it exists this is the
 * interface, and it is written to be safe for somebody who is not a developer
 * to run: it prints before it writes, it refuses to guess, and running it twice
 * changes nothing the second time.
 *
 * ============================================================================
 * WHAT IT WILL NOT DO
 *
 * It will not set `session_minutes` or `table_capacity`. Both are outstanding
 * club decisions, both are registered, and a script that quietly defaulted them
 * would put a number in front of members that nobody agreed — which is the
 * failure `UNCONFIGURED_AVAILABILITY` exists to prevent. It reports them as
 * unset and says what that costs, because a founder who publishes hours and
 * finds nothing bookable deserves to be told why on the spot.
 *
 * ============================================================================
 * IT REPLACES, IT DOES NOT ACCUMULATE
 *
 * `--apply` deletes the existing periods and writes the declared week in one
 * transaction. Merging would be worse in the one direction that matters: a
 * founder narrowing the week — dropping Sunday, say — expects Sunday to go, and
 * an upsert would leave it open forever with nobody able to see why. Opening
 * hours are not append-only and carry no history worth preserving; the audit of
 * who changed them is a founder screen's job, not this script's.
 */

import { sql } from "drizzle-orm";
import { getArmoryDb, isArmoryDatabaseConfigured, schema } from "@/db/armory/client";
import { CLUB_WEEK } from "@/content/club-week";
import { uuidv7 } from "@/lib/uuidv7";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const bold = (s: string) => `[1m${s}[0m`;
const dim = (s: string) => `[2m${s}[0m`;
const red = (s: string) => `[31m${s}[0m`;
const green = (s: string) => `[32m${s}[0m`;
const amber = (s: string) => `[33m${s}[0m`;

const clock = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

async function main() {
  const apply = process.argv.includes("--apply");

  if (!isArmoryDatabaseConfigured()) {
    console.error(
      red("\nDATABASE_URL is not set.\n") +
        dim("  Run from a machine with the club's connection string in .env.local.\n"),
    );
    process.exit(1);
  }

  const db = getArmoryDb();

  /* ---- What is there now ------------------------------------------------ */

  const existing = await db
    .select({
      weekday: schema.openingHours.weekday,
      opens: schema.openingHours.opensMinute,
      closes: schema.openingHours.closesMinute,
      staffed: schema.openingHours.staffed,
      label: schema.openingHours.label,
    })
    .from(schema.openingHours)
    .orderBy(schema.openingHours.weekday, schema.openingHours.opensMinute);

  console.log(`\n${bold("The club's week — as the database holds it")}\n`);

  if (existing.length === 0) {
    console.log(dim("  Nothing published. Every availability grid renders one honest"));
    console.log(dim("  sentence and nothing bookable, which is correct until this runs.\n"));
  } else {
    for (const period of existing) {
      console.log(
        `  ${WEEKDAYS[period.weekday].padEnd(10)} ${clock(period.opens)}–${clock(period.closes)}` +
          `  ${period.staffed ? green("officer on the floor") : amber("no officer — deck only")}` +
          `  ${dim(period.label ?? "")}`,
      );
    }
    console.log("");
  }

  /* ---- What the club has declared --------------------------------------- */

  console.log(`${bold("Declared in src/content/club-week.ts")}\n`);
  for (const period of CLUB_WEEK) {
    console.log(
      `  ${WEEKDAYS[period.weekday].padEnd(10)} ${clock(period.opens)}–${clock(period.closes)}` +
        `  ${period.staffed ? green("officer on the floor") : amber("no officer — deck only")}` +
        `  ${dim(period.label ?? "")}`,
    );
  }
  console.log("");

  /* ---- The settings that decide whether any of it is bookable ------------ */

  const [settings] = await db
    .select({
      sessionMinutes: schema.clubSettings.sessionMinutes,
      leadTime: schema.clubSettings.bookingLeadTimeMinutes,
      tableCapacity: schema.clubSettings.tableCapacity,
    })
    .from(schema.clubSettings)
    .limit(1);

  console.log(`${bold("What still decides whether anything is bookable")}\n`);
  console.log(
    `  session length     ${
      settings?.sessionMinutes
        ? green(`${settings.sessionMinutes} minutes`)
        : amber("UNSET — no slots are produced, on any day")
    }`,
  );
  console.log(
    `  notice required    ${
      settings?.leadTime === null || settings?.leadTime === undefined
        ? dim("unset — treated as none")
        : green(`${settings.leadTime} minutes`)
    }`,
  );
  console.log(
    `  covers at tables   ${
      settings?.tableCapacity === null || settings?.tableCapacity === undefined
        ? amber("UNSET — table bookings are not open")
        : green(String(settings.tableCapacity))
    }`,
  );
  console.log("");

  if (!apply) {
    console.log(dim("  Nothing was written. Re-run with --apply to publish the declared week.\n"));
    return;
  }

  /* ---- Write ------------------------------------------------------------- */

  await db.transaction(async (tx) => {
    /* Replace rather than merge — see the header. Opening hours are not
       append-only and no trigger stands in the way. */
    await tx.delete(schema.openingHours);

    await tx.insert(schema.openingHours).values(
      CLUB_WEEK.map((period) => ({
        id: uuidv7(),
        weekday: period.weekday,
        opensMinute: period.opens,
        closesMinute: period.closes,
        staffed: period.staffed,
        label: period.label ?? null,
      })),
    );
  });

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.openingHours);

  console.log(green(`  Published. ${count} periods now on file.\n`));

  if (!settings?.sessionMinutes) {
    console.log(
      amber("  The week is published and NOTHING IS BOOKABLE YET.\n") +
        dim("  A session length has not been set, so the availability grid produces\n") +
        dim("  no slots. The portal says so specifically rather than reading as a\n") +
        dim("  busy club. Set it when the club has decided:\n\n") +
        dim("    update armory.club_settings set session_minutes = 60;\n"),
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(red("\nCould not publish the week.\n"));
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
