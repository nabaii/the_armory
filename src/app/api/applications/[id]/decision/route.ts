import { DEFAULT_ROSTER_POLICY } from "@/domain/roster";
import type { ApplicationEvent } from "@/domain/state-machines";
import { decideApplication } from "@/server/armory/applications";
import {
  forbidden,
  handleWrite,
  malformed,
  readWrite,
  requireStaff,
} from "@/server/armory/http";

/**
 * POST /api/applications/:id/decision — §5's application machine over HTTP.
 *
 *   §5:  "submitted → under_review → admitted | waitlisted | declined.
 *         waitlisted → admitted | withdrawn. Any → withdrawn. Admission requires
 *         roster headroom or an explicit founder override."
 *   §12: "Roster at cap, application admitted → Blocked, or admitted only with
 *         explicit founder override recorded."
 *
 * One endpoint for all five decisions rather than five endpoints, because they
 * are one state machine and splitting them would put the transition table in the
 * router. A route per verb reads tidier and quietly invites the sixth route that
 * sets a status directly — which is the thing §5 opens by forbidding: "Do not
 * allow status to be set by direct assignment from a form."
 *
 * ===========================================================================
 * THE OVERRIDE IS FOUNDER-ONLY, AND THAT IS ENFORCED HERE
 *
 * §12 says admitting past the cap needs "explicit founder override recorded",
 * and §5 says the same. The pure transition in state-machines.ts accepts a
 * `founderOverride` and cannot check the role — it has no idea who is calling.
 * The record layer takes the staff id from the envelope. So this is the only
 * layer that can compare the claimed override against the caller's actual role,
 * and if it does not, a range officer can admit past the club's cap by putting
 * their own id in the body.
 *
 * The staff id on the override is therefore taken from the SESSION and never
 * from the payload. A client cannot name someone else as the overriding founder
 * because there is no field in which to say it.
 */

export const dynamic = "force-dynamic";

const DECISIONS = [
  "begin_review",
  "admit",
  "waitlist",
  "decline",
  "withdraw",
] as const;

type DecisionType = (typeof DECISIONS)[number];

const isDecision = (value: unknown): value is DecisionType =>
  typeof value === "string" && (DECISIONS as readonly string[]).includes(value);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireStaff(request);
  if ("response" in auth) return auth.response;

  const { id } = await context.params;

  const write = await readWrite(request);
  if ("response" in write) return write.response;

  const { decision, overrideReason, fallbackTierId } = write.envelope.payload;

  if (!isDecision(decision)) {
    return malformed(
      `A decision is one of: ${DECISIONS.join(", ")}.`,
    );
  }

  let event: ApplicationEvent;

  if (decision === "admit") {
    const wantsOverride =
      typeof overrideReason === "string" && overrideReason.trim().length > 0;

    if (wantsOverride && auth.staff.role !== "founder") {
      /* §12's "explicit founder override". Refused before the transition sees
         it, so an officer cannot admit past the cap under their own name. */
      return forbidden(
        "Admitting past the roster cap is the founder's decision.",
        "Ask the founder to admit this one.",
      );
    }

    event = {
      type: "admit",
      /* Replaced inside the transaction by the live count — see the header of
         src/server/armory/applications.ts on why headroom is not computed out
         here. Zero rather than a guess, so that a bug which skipped the
         recount would refuse rather than over-admit. */
      rosterHeadroom: 0,
      ...(wantsOverride
        ? {
            founderOverride: {
              /* From the session. There is deliberately no payload field for
                 this: a client that could name the overriding founder could
                 attribute an over-cap admission to someone who was not there. */
              staffUserId: auth.staff.staffUserId,
              reason: (overrideReason as string).trim(),
            },
          }
        : {}),
    };
  } else {
    event = { type: decision };
  }

  return handleWrite(
    {
      envelope: write.envelope,
      operation: `applications.${decision}`,
      staff: auth.staff,
    },
    (tx) =>
      decideApplication(tx, {
        applicationId: id,
        event,
        occurredAt: new Date(),
        policy: DEFAULT_ROSTER_POLICY,
        fallbackTierId:
          typeof fallbackTierId === "string" ? fallbackTierId : undefined,
      }),
  );
}
