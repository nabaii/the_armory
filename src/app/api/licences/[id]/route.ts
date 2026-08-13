import { applyLicenceEvent } from "@/server/armory/licences";
import {
  forbidden,
  handleWrite,
  malformed,
  readWrite,
  requireStaff,
} from "@/server/armory/http";

/**
 * POST /api/licences/:id — §5's licence machine, §7's members group.
 *
 *   §5:   "pending_review → verified → expired (by date) | revoked (staff
 *          action). Capability is live only while verified and unexpired."
 *   §3.1: "Capability activates only on verified."
 *
 * The same shape as the application decision route, and deliberately so: both
 * are a state machine reached over HTTP, and a reader who has understood one has
 * understood the other.
 *
 * ===========================================================================
 * VERIFYING IS FOUNDER-ONLY
 *
 * §10: licence scans are "readable only by the founder role. Not by range
 * officers."
 *
 * Verification is the act of looking at the document and saying it is genuine.
 * A role that may not see the scan cannot perform it — an officer verifying a
 * licence they are not permitted to read would be recording a judgement they did
 * not make, in the column the capability service trusts to decide whether
 * somebody may handle their own firearm.
 *
 * So the role check is not an access-control detail bolted on top. It is what
 * makes `verified` mean anything.
 *
 * `expire` is absent from the accepted events on purpose. §5 marks it "(by
 * date)" and state-machines.ts calls it "Set by the expiry sweep, from the date.
 * Not a staff action." Exposing it here would let a person do by hand something
 * the clock is supposed to do, and the audit row would name them as having
 * decided a date had passed.
 */

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireStaff(request);
  if ("response" in auth) return auth.response;

  const { id } = await context.params;

  const write = await readWrite(request);
  if ("response" in write) return write.response;

  const { event, reason } = write.envelope.payload;

  if (event !== "verify" && event !== "revoke") {
    return malformed(
      "A licence is verified or revoked. Expiry follows the date on the licence.",
    );
  }

  if (auth.staff.role !== "founder") {
    return forbidden(
      event === "verify"
        ? "Only the founder verifies a licence, because only the founder may read the document."
        : "Only the founder revokes a licence.",
      "Ask the founder to review it.",
    );
  }

  if (event === "revoke" && (typeof reason !== "string" || reason.trim().length < 12)) {
    /* The same bar as every other override in the system (§3.6). Revoking a
       licence takes a capability away from a member who had it, and a founder
       reading the log next year needs to know why. */
    return malformed(
      "Revoking a licence needs a reason a founder can read tomorrow morning and understand without asking anyone.",
    );
  }

  return handleWrite(
    {
      envelope: write.envelope,
      operation: `licences.${event}`,
      staff: auth.staff,
    },
    (tx) =>
      applyLicenceEvent(tx, {
        licenceId: id,
        event:
          event === "verify"
            ? { type: "verify", staffUserId: auth.staff.staffUserId }
            : {
                type: "revoke",
                staffUserId: auth.staff.staffUserId,
                reason: (reason as string).trim(),
              },
        occurredAt: new Date(),
      }),
  );
}
