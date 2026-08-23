/**
 * RETIRE A DISCIPLINE FROM THE DATABASE.
 *
 *   npm run db:retire -- 25m-pistol            report what still references it
 *   npm run db:retire -- 25m-pistol --apply    strip it from tiers, close its lanes
 *
 * ============================================================================
 * WHY A SCRIPT AND NOT A MIGRATION
 *
 * Removing a discipline from `src/content/disciplines.ts` and
 * `src/domain/scoring.ts` takes it out of the product — it can no longer be
 * booked, scored, or rendered. It does NOT take it out of the database, and
 * those rows are not inert:
 *
 *   · A tier whose `discipline_access` still names it is granting a permission
 *     to something that does not exist. Harmless today; misleading to anybody
 *     reading the tier matrix to work out what a membership is worth.
 *   · A lane on it with status `available` is a lane the desk considers open.
 *     Nothing routes to it now, but the row says otherwise, and the club's own
 *     operational queries do not know the discipline was retired.
 *
 * A migration is the wrong tool because this is data, not shape: no column
 * changes, the fix differs per environment, and — the deciding reason — the
 * lanes must be handled differently depending on whether anybody ever shot on
 * them, which a migration cannot decide without reading rows anyway.
 *
 * ============================================================================
 * IT NEVER DELETES A LANE SOMEBODY SHOT ON
 *
 * §1.2 rule 3 makes the record of what happened permanent, and a lane is part
 * of that record: `participations.lane_id` says which physical line a person
 * was on. Deleting a lane that carries participations would either fail on the
 * foreign key or, worse, orphan the history of a session.
 *
 * So there are two outcomes and the script picks per lane:
 *
 *   · Never used  → DELETE. It was configuration, and the configuration is
 *                   wrong now. Nothing points at it.
 *   · Used at all → set status to `closed`. The row stays, the history stays,
 *                   and the desk stops treating it as a line it can put
 *                   somebody on.
 *
 * ============================================================================
 * IT REFUSES TO RETIRE A DISCIPLINE THE CLUB STILL RUNS
 *
 * The guard that makes this safe to keep in the repository. The slug is checked
 * against `src/content/disciplines.ts` first, and a slug still listed there is
 * refused outright — because retiring a live discipline would close the lanes
 * of a range that is open, which is an outage rather than a cleanup. The code
 * change comes first; this finishes it.
 */

import { eq, sql } from "drizzle-orm";
import {
  getArmoryDb,
  isArmoryDatabaseConfigured,
  schema,
} from "@/db/armory/client";
import { disciplines } from "@/content/disciplines";

/* ---------------------------------------------------------------------------
   ARGUMENTS
   -------------------------------------------------------------------------- */

const APPLY = process.argv.includes("--apply");
const slug = process.argv.slice(2).find((arg) => !arg.startsWith("--"));

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

async function main() {
  if (!isArmoryDatabaseConfigured()) {
    console.error(
      `\n${red("No database configured.")} Set DATABASE_URL and try again.\n`,
    );
    process.exit(1);
  }

  if (!slug) {
    console.error(
      `\n${red("Name the discipline to retire.")}` +
        `\n  npm run db:retire -- 25m-pistol\n`,
    );
    process.exit(1);
  }

  /* The guard. A slug the club still runs is refused before anything is read. */
  if (disciplines.some((discipline) => discipline.slug === slug)) {
    console.error(
      `\n${red(`${slug} is still in src/content/disciplines.ts.`)}` +
        `\n  Remove it from the product first — closing the lanes of a range` +
        `\n  that is open is an outage, not a cleanup.\n`,
    );
    process.exit(1);
  }

  const db = getArmoryDb();

  console.log(`\n${bold(`Retiring ${slug}`)}`);
  console.log(dim(APPLY ? "  Writing.\n" : "  Reporting only.\n"));

  /* ---------------------------------------------------------------- LANES */

  const lanes = await db
    .select({
      id: schema.lanes.id,
      number: schema.lanes.number,
      status: schema.lanes.status,
      used: sql<number>`(
        SELECT count(*) FROM armory.participations p WHERE p.lane_id = ${schema.lanes.id}
      )`.mapWith(Number),
    })
    .from(schema.lanes)
    .where(eq(schema.lanes.discipline, slug));

  if (lanes.length === 0) {
    console.log(`  ${dim("Lanes")}                no lanes on this discipline`);
  }

  for (const lane of lanes) {
    const disposition =
      lane.used > 0
        ? `close  ${dim(`(${lane.used} participation${lane.used === 1 ? "" : "s"} — the row stays)`)}`
        : `delete ${dim("(never used)")}`;

    console.log(`  ${dim("Lane")} ${String(lane.number).padEnd(3)}  ${disposition}`);

    if (!APPLY) continue;

    if (lane.used > 0) {
      await db
        .update(schema.lanes)
        .set({ status: "closed" })
        .where(eq(schema.lanes.id, lane.id));
    } else {
      await db.delete(schema.lanes).where(eq(schema.lanes.id, lane.id));
    }
  }

  /* ---------------------------------------------------------------- TIERS */

  const tiers = await db
    .select({
      id: schema.tiers.id,
      name: schema.tiers.name,
      access: schema.tiers.disciplineAccess,
    })
    .from(schema.tiers);

  const granting = tiers.filter((tier) => tier.access.includes(slug));

  if (granting.length === 0) {
    console.log(`\n  ${dim("Tiers")}                no tier grants it`);
  }

  for (const tier of granting) {
    const next = tier.access.filter((entry) => entry !== slug);
    console.log(
      `\n  ${dim("Tier")} ${tier.name}` +
        `\n    ${tier.access.join(", ")}` +
        `\n    ${green("→")} ${next.length > 0 ? next.join(", ") : dim("(no disciplines)")}`,
    );

    if (!APPLY) continue;

    await db
      .update(schema.tiers)
      .set({ disciplineAccess: next })
      .where(eq(schema.tiers.id, tier.id));
  }

  /* --------------------------------------------------- WHAT IS LEFT ALONE

     Bookings and rounds are reported and never touched. A round is a permanent
     sporting record and a booking is what somebody actually did; neither stops
     being true because the club closed the range. If either is non-zero, the
     lanes will be closed rather than deleted, which is the point of the split
     above. */

  const [{ bookings }] = await db
    .select({ bookings: sql<number>`count(*)`.mapWith(Number) })
    .from(schema.bookings)
    .where(eq(schema.bookings.discipline, slug));

  const [{ rounds }] = await db
    .select({ rounds: sql<number>`count(*)`.mapWith(Number) })
    .from(schema.rounds)
    .where(eq(schema.rounds.discipline, slug));

  console.log(`\n  ${dim("History, untouched")}`);
  console.log(`    ${bookings} booking${bookings === 1 ? "" : "s"}`);
  console.log(`    ${rounds} round${rounds === 1 ? "" : "s"}`);

  console.log(
    APPLY
      ? `\n${green(bold("Done."))}\n`
      : `\n${dim("  Nothing written. Pass --apply to make these changes.")}\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
