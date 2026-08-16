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
 * WHAT IT WRITES, AND WHAT IT WILL NOT
 *
 * It writes the three things the club has DECIDED: the week, the session length
 * and the turnaround. All three come from src/content/club-week.ts and all
 * three are founder decisions of the same kind — the club's operating day.
 *
 * It will not set `table_capacity`. That is an outstanding decision, it is
 * registered, and a script that quietly defaulted it would sell a Friday
 * evening the kitchen cannot serve. It is reported as unset and the report says
 * what that costs, because a founder who publishes a week and finds tables
 * closed deserves to be told why on the spot rather than to go looking.
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

import { eq, sql } from "drizzle-orm";
import { getArmoryDb, isArmoryDatabaseConfigured, schema } from "@/db/armory/client";
import {
  CLUB_WEEK,
  SESSION_MINUTES,
  TURNAROUND_MINUTES,
  declaredSessionStarts,
} from "@/content/club-week";
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

  /* The day a member actually sees, spelled out. A founder reading "60 + 15"
     should not have to work out where that lands. */
  const starts = declaredSessionStarts();
  console.log(
    `  ${bold("Sessions")}  ${SESSION_MINUTES} minutes, ` +
      `${TURNAROUND_MINUTES} minutes' turnaround between them\n`,
  );
  console.log(
    "  " +
      starts
        .map((minute) => `${clock(minute)}–${clock(minute + SESSION_MINUTES)}`)
        .join("  "),
  );
  console.log(dim(`  ${starts.length} sessions a day, per discipline.\n`));

  /* ---- The settings that decide whether any of it is bookable ------------ */

  const [settings] = await db
    .select({
      sessionMinutes: schema.clubSettings.sessionMinutes,
      leadTime: schema.clubSettings.bookingLeadTimeMinutes,
      turnaroundMinutes: schema.clubSettings.turnaroundMinutes,
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
    `  turnaround         ${
      settings?.turnaroundMinutes
        ? green(`${settings.turnaroundMinutes} minutes between sessions`)
        : dim("unset — sessions run back to back")
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

    /**
     * The session and its turnaround, in the same transaction as the week.
     *
     * They belong together: a week published without a session length produces
     * no slots at all, and the two arriving separately is the half-configured
     * state the portal has to have a sentence for. One transaction means a
     * founder cannot end up in it by running this script.
     *
     * `club_settings` is a singleton enforced by a unique index, so this is an
     * upsert against the one row migration 0006 created — and it touches only
     * the two columns this script owns. Everything else in that table is
     * somebody else's decision.
     */
    const [existing] = await tx
      .select({ id: schema.clubSettings.id })
      .from(schema.clubSettings)
      .limit(1);

    if (existing) {
      await tx
        .update(schema.clubSettings)
        .set({
          sessionMinutes: SESSION_MINUTES,
          turnaroundMinutes: TURNAROUND_MINUTES,
          updatedAt: new Date(),
        })
        .where(eq(schema.clubSettings.id, existing.id));
    } else {
      await tx.insert(schema.clubSettings).values({
        id: uuidv7(),
        sessionMinutes: SESSION_MINUTES,
        turnaroundMinutes: TURNAROUND_MINUTES,
      });
    }
  });

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.openingHours);

  console.log(
    green(
      `  Published. ${count} periods on file, ` +
        `${SESSION_MINUTES}-minute sessions, ${TURNAROUND_MINUTES}-minute turnaround.\n`,
    ),
  );

  if (settings?.tableCapacity === null || settings?.tableCapacity === undefined) {
    console.log(
      amber("  The range is bookable. THE TABLES ARE NOT.\n") +
        dim("  The club has not said how many covers it can seat, so table bookings\n") +
        dim("  stay closed and the Diary says so. Deliberately not defaulted — an\n") +
        dim("  invented number sells a Friday the kitchen cannot serve. Set it when\n") +
        dim("  the club has counted:\n\n") +
        dim("    update armory.club_settings set table_capacity = <covers>;\n"),
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
