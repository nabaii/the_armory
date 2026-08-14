import { exceptionSummary } from "@/domain/exceptions";
import { armouryExceptionReport } from "@/server/armory/register";
import { handleRead, requireStaff } from "@/server/armory/http";

/**
 * GET /api/exceptions — §6.6, §11 M6's "exception reporting".
 *
 *   §6.6, the owner dashboard: "…reconciliation exceptions; expiries within 90
 *    days; overrides in the last 7 days."
 *
 * ===========================================================================
 * WHAT THIS ENDPOINT IS FOR, AND WHY IT MUST STAY SHORT
 *
 * The rules are in src/domain/exceptions.ts and most of their design went into
 * what must NOT appear. That restraint only survives if this endpoint keeps it:
 * the moment somebody adds "and also every firearm currently issued" because it
 * seemed useful, the list becomes a list of normal operation and a founder stops
 * reading it. The day it reports a firearm that has been off site for a week,
 * they will not notice.
 *
 * So it returns exactly what the rules produce, and the summary sentence they
 * produce, and nothing assembled here.
 *
 * ===========================================================================
 * IT IS A FULL SCAN, AND THAT IS FINE AT THIS SIZE
 *
 * §3.4's integrity check compares every firearm's status column against a
 * derivation over its whole custody history, which means reading the log. §2.1
 * puts the club at a hundred members with a few dozen firearms; this is a
 * handful of rows and one query per table.
 *
 * It is worth being explicit that this would not survive ten times the data —
 * the derivation would move into SQL, or the check would run on a schedule
 * rather than on a request. Neither is needed now, and building for it now would
 * be building a cache nobody can verify against a table nobody has filled.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  /* Founder only. Not because the data is more sensitive than the register —
     it is the same rows — but because §6.6 puts this on the OWNER dashboard,
     and an exception list is a list of things the club has got wrong. Handing
     it to every officer would change what the list is for. */
  const auth = await requireStaff(request, { atLeast: "founder" });
  if ("response" in auth) return auth.response;

  return handleRead("armoury.exceptions", async (tx) => {
    const exceptions = await armouryExceptionReport(tx, new Date());

    return {
      summary: exceptionSummary(exceptions),
      /* Already ordered — integrity above attention. The client renders the
         order it is given so two surfaces cannot disagree about what matters
         most. */
      exceptions,
    };
  });
}
