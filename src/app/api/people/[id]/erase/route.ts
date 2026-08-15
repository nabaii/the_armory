import { erasePerson, erasureSubject } from "@/server/armory/erasure";
import { mayErase } from "@/domain/erasure";
import {
  handleRead,
  handleWrite,
  malformed,
  readWrite,
  requireStaff,
} from "@/server/armory/http";

/**
 * /api/people/:id/erase — §10's guest data requirement, §11 M10.
 *
 *   §10: "A guest who does not join has provided data for a single visit. A
 *    defined retention position is required from counsel; BUILD THE DELETION
 *    PATH NOW."
 *
 * ===========================================================================
 * GET ANSWERS "MAY THIS BE DONE", AND IT EXISTS FOR A REASON
 *
 * A founder handling an erasure request needs to know before they promise
 * anything whether the club can comply — and if not, what has to happen first.
 * "A firearm is still recorded as issued to this person. Record the return
 * before erasing the record" is an answer they can act on the same day.
 *
 * Discovering that after telling somebody their data had been erased is the
 * failure this endpoint prevents, and it is the §4.3 principle applied outside
 * the desk: a block a person could have resolved in advance must be surfaced in
 * advance.
 *
 * ===========================================================================
 * FOUNDER ONLY
 *
 * §10 already restricts the most sensitive record — a licence scan — to the
 * founder. Erasure is the act of destroying identity data permanently, on a
 * person the club may still owe or be owed by, and it is not reversible by
 * anybody at any level. It belongs to the person who answers for the club's
 * data protection position.
 */

export const dynamic = "force-dynamic";

/** Whether this person can be erased, and what stands in the way. */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireStaff(request, { atLeast: "founder" });
  if ("response" in auth) return auth.response;

  const { id } = await context.params;

  return handleRead("person.erasure_check", async (tx) => {
    const subject = await erasureSubject(tx, id);

    if (!subject) {
      return { found: false as const };
    }

    const decision = mayErase(subject);

    return {
      found: true as const,
      /* The facts the decision turned on, so a founder is told rather than
         merely refused — §10's outstanding-balance case in particular, which
         does NOT block and which they should still know about. */
      standing: {
        membershipStatus: subject.membershipStatus,
        outstandingKobo: subject.outstandingKobo,
        unreturnedFirearms: subject.unreturnedFirearms,
        ownsRegisteredFirearm: subject.ownsRegisteredFirearm,
        lastVisitAt: subject.lastVisitAt,
        anonymisedAt: subject.anonymisedAt,
      },
      erasable: decision.allowed,
      alreadyErased: decision.allowed && decision.alreadyErased,
      refusal: decision.allowed ? null : decision.refusal,
    };
  });
}

/** Erase them. Not reversible by anybody. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireStaff(request, { atLeast: "founder" });
  if ("response" in auth) return auth.response;

  const { id } = await context.params;

  const write = await readWrite(request);
  if ("response" in write) return write.response;

  const { reason } = write.envelope.payload;

  if (typeof reason !== "string") {
    return malformed("An erasure needs a reason.");
  }

  return handleWrite(
    { envelope: write.envelope, operation: "person.erase", staff: auth.staff },
    (tx) => erasePerson(tx, { personId: id, reason, now: new Date() }),
  );
}
