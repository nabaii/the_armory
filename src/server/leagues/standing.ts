import { cache } from "react";
import { eq } from "drizzle-orm";
import { getArmoryDb, isArmoryDatabaseConfigured, schema } from "@/db/armory/client";
import type { memberStatus } from "@/db/schema";
import { leaguesStandingFor } from "./eligibility";

/**
 * THE CLUB'S ANSWER TO "IS THIS PERSON A MEMBER", READ BY THE LEAGUES HALF.
 *
 * The argument for reading it at all is in eligibility.ts on
 * `leaguesStandingFor`. This is the query behind it.
 *
 * ===========================================================================
 * WHY IT IS NOT FOLDED INTO `findSession`
 *
 * One query would be cheaper than two, and the two products share a pool, so
 * the join is physically possible. It is still wrong here: the armory schema
 * leans on `casing: "snake_case"` and the leagues client is configured without
 * it, so armory tables addressed through the leagues drizzle instance generate
 * camelCase column names and fail at the database. The two clients exist
 * because the two schemas are configured differently — see src/db/client.ts —
 * and reaching across that line to save a round trip is how that difference
 * turns into a runtime error nobody can read.
 *
 * ===========================================================================
 * CACHED PER REQUEST, NOT PER SESSION
 *
 * `getMember()` is called more than once in a render — the member layout guards
 * and then the page reads — and this would otherwise repeat with it. React's
 * `cache` dedupes within a single request and forgets between them, which is
 * the correct lifetime: a membership that lapses or is upgraded must take
 * effect on the next request, exactly as the session comment promises. Keyed on
 * the person id, a string, because a member object is a fresh identity on every
 * load and would never hit.
 */
export const clubStandingFor = cache(
  async (personId: string): Promise<(typeof memberStatus.enumValues)[number] | null> => {
    if (!isArmoryDatabaseConfigured()) return null;

    /* `is_founding` is a column on the MEMBERSHIP, not on the tier — §3.1 makes
       founding a property of how this person joined, which a later tier change
       must not revoke. So there is no join to make. */
    const [row] = await getArmoryDb()
      .select({
        status: schema.memberships.status,
        isFounding: schema.memberships.isFounding,
      })
      .from(schema.memberships)
      .where(eq(schema.memberships.personId, personId))
      .limit(1);

    /* A person with no membership is not an error and not a downgrade: they are
       a former guest or an applicant, and `members.status` — which this returns
       null to defer to — already says what the leagues product knows about
       them. */
    if (!row) return null;

    return leaguesStandingFor(row.status, row.isFounding);
  },
);
