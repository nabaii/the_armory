import {
  reissueToken,
  restoreDevice,
  revokeDevice,
} from "@/server/armory/devices";
import {
  handleWrite,
  malformed,
  readWrite,
  requireStaff,
} from "@/server/armory/http";

/**
 * POST /api/devices/:id — §10's revocation, with an operator behind it.
 *
 *   §10: "A lost or stolen tablet CAN BE REVOKED SERVER-SIDE, and its cached
 *    day pack rendered unusable on next launch."
 *
 * Three events, and the same shape as every other state change in this API: a
 * `requestId` for §7's replay guarantee, an event name, and whatever that event
 * needs.
 *
 * ===========================================================================
 * FOUNDER ONLY, AND THIS ONE IS NOT ARGUABLE
 *
 * Elsewhere in this API the role check is about what a person is entitled to
 * SEE. Here it is about what they can take away: an officer who could revoke
 * devices could close the range from a phone, and an officer who could reissue
 * tokens could enrol a tablet the founder never authorised.
 *
 * §3.1 says the desk and lane "load only on a registered, unrevoked device", and
 * this endpoint is the whole of what makes that sentence true. It belongs to the
 * person whose club it is.
 *
 * ===========================================================================
 * WHY REISSUE IS A SEPARATE EVENT FROM RESTORE
 *
 * They look like one action — a found tablet is put back to work — and they are
 * deliberately two, because a restore is a correction and a reissue is a new
 * credential. `reissueToken` refuses while a device is still revoked, so a
 * founder cannot issue a live token to a tablet the club has recorded as stolen
 * by pressing one button in a hurry. The two-step is the point.
 */

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireStaff(request, { atLeast: "founder" });
  if ("response" in auth) return auth.response;

  const { id } = await context.params;

  const write = await readWrite(request);
  if ("response" in write) return write.response;

  const { event, reason } = write.envelope.payload;

  if (event !== "revoke" && event !== "restore" && event !== "reissue") {
    return malformed(
      "A device accepts revoke, restore or reissue.",
    );
  }

  const now = new Date();

  if (event === "revoke") {
    /* Checked here as well as in `revokeDevice`, so a caller that sent no
       reason at all hears about the field rather than about the sentence. The
       builder's refusal is the one a founder reads on screen. */
    if (typeof reason !== "string") {
      return malformed("Revoking a tablet needs a reason.");
    }

    return handleWrite(
      { envelope: write.envelope, operation: "device.revoke", staff: auth.staff },
      (tx) => revokeDevice(tx, { deviceId: id, reason, now }),
    );
  }

  if (event === "restore") {
    return handleWrite(
      { envelope: write.envelope, operation: "device.restore", staff: auth.staff },
      (tx) => restoreDevice(tx, { deviceId: id, now }),
    );
  }

  return handleWrite(
    {
      envelope: write.envelope,
      operation: "device.reissue_token",
      staff: auth.staff,
    },
    (tx) =>
      reissueToken(tx, {
        deviceId: id,
        /* §10: every staff action attributable to a named person. The founder
           who issued this credential is the one who answers for the tablet. */
        registeredByStaffId: auth.staff.staffUserId,
        now,
      }),
  );
}
