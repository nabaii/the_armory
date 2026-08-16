import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { ArmoryReader } from "@/db/armory/client";
import { schema } from "@/db/armory/client";
import {
  programmeForDay,
  weekFrom,
  type ProgrammeDay,
  type ProgrammeEvent,
  type ProgrammeFixture,
} from "@/domain/programme";
import type { OpeningPeriod } from "@/domain/availability";
import { lagosDateKey } from "@/lib/time";

/**
 * WHAT IS ON — Members Portal §7.3, and the Tonight card at §6.1.
 *
 * The merge itself is pure and lives in src/domain/programme.ts. This is the
 * read behind it: published one-offs from `armory.events` for a date range,
 * combined with the opening hours the caller already holds.
 *
 * ===========================================================================
 * DRAFTS ARE NOT MEMBER-VISIBLE, AND THE FILTER IS IN THE QUERY
 *
 * `published` defaults to false so the founder can draft a guest evening three
 * weeks out and decide later. That filter belongs in SQL rather than in a
 * component: a draft that reached a React tree would be one `.filter()` away
 * from a member's screen for the rest of the codebase's life, and the failure
 * would be a club that looked disorganised in the surface it is most judged by.
 *
 * ===========================================================================
 * FIXTURES ARE PASSED IN, NOT READ HERE
 *
 * §7.3's second feed comes from the leagues product in the `public` schema, and
 * a member's fixtures are a fact about that member. This module reads the
 * club's programme, which is the same for everybody — mixing a personal read
 * into it would mean the club's week could not be cached or shown to anyone
 * without a session. The caller supplies the member's fixtures; the merge takes
 * both.
 */

export async function publishedEvents(
  db: ArmoryReader,
  input: { readonly from: Date; readonly to: Date },
): Promise<ProgrammeEvent[]> {
  const rows = await db
    .select({
      kind: schema.events.kind,
      title: schema.events.title,
      detail: schema.events.detail,
      onDate: schema.events.onDate,
      startsMinute: schema.events.startsMinute,
      endsMinute: schema.events.endsMinute,
    })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.published, true),
        gte(schema.events.onDate, lagosDateKey(input.from)),
        lte(schema.events.onDate, lagosDateKey(input.to)),
      ),
    )
    .orderBy(asc(schema.events.onDate), asc(schema.events.startsMinute));

  return rows;
}

/**
 * A run of days, each with its programme — the Diary's What's on mode.
 *
 * Returns every day in the range including the empty ones. A week that omitted
 * its quiet days would compress into a list of three entries and lose the shape
 * of the week, which is the one thing §7.1 says Today cannot show.
 */
export function programmeWeek(input: {
  readonly from: Date;
  readonly days: number;
  readonly openingHours: readonly OpeningPeriod[];
  readonly events: readonly ProgrammeEvent[];
  readonly fixtures: readonly ProgrammeFixture[];
}): ProgrammeDay[] {
  return weekFrom(input.from, input.days).map((date) =>
    programmeForDay({
      date,
      openingHours: input.openingHours,
      events: input.events,
      fixtures: input.fixtures,
    }),
  );
}
