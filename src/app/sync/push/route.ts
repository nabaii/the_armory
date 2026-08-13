import { log } from "@/server/log";
import { touchDevice } from "@/server/sync/device-auth";
import {
  malformed,
  ok,
  rejected,
  requireDevice,
  unavailable,
} from "@/server/sync/http";
import { PostgresAppendOnlyWriter } from "@/server/sync/writer";
import { isPushOperation, type PushRequest, type PushResponse } from "@/sync/contract";
import { handlePush } from "@/sync/push";

/**
 * POST /sync/push — §7's one requirement.
 *
 *   "Every write accepts a client-generated UUIDv7 as the record identity and is
 *    safe to replay. A queued write delivered twice must produce one row, not two.
 *    This is the single most important API requirement in the system."
 *
 * The idempotency is a single `INSERT … ON CONFLICT (id) DO NOTHING`
 * (src/server/sync/writer.ts) and the proof is a unit test over every accepted
 * operation (src/sync/push.test.ts). This file reads the envelope and maps the
 * outcome to a status code.
 *
 * ===========================================================================
 * THE DEVICE IN THE BODY MUST BE THE DEVICE THAT AUTHENTICATED
 *
 * The record carries a `deviceId` because §7 requires attribution and because the
 * column is written from it. The request also carries a credential. Those two can
 * disagree, and the check below is what stops one tablet writing custody events
 * attributed to another — which would not be a hypothetical attack so much as the
 * eventual result of a copied token during setup, and it would corrupt the one log
 * §3.4 calls "the sole source of truth for where any firearm is".
 */

export const dynamic = "force-dynamic";

/** Fields the envelope must supply. Read defensively; this is a network boundary. */
function readEnvelope(body: unknown): PushRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as Record<string, unknown>;

  if (typeof raw.id !== "string") return null;
  if (!isPushOperation(raw.operation)) return null;
  if (typeof raw.deviceId !== "string") return null;
  if (typeof raw.clientRecordedAt !== "string") return null;
  if (raw.actorStaffId !== null && typeof raw.actorStaffId !== "string") return null;

  return {
    id: raw.id,
    operation: raw.operation,
    payload: raw.payload,
    deviceId: raw.deviceId,
    actorStaffId: raw.actorStaffId,
    clientRecordedAt: raw.clientRecordedAt,
  };
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireDevice(request);
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return malformed("This record could not be read.");
  }

  const envelope = readEnvelope(body);
  if (!envelope) {
    /**
     * 400, and therefore final.
     *
     * An unreadable envelope will be unreadable on every retry — the same bytes
     * refused identically, as policy.ts puts it — so it is surfaced to an officer
     * rather than retried into a quarantine twenty minutes later. An unrecognised
     * `operation` lands here too, which is how the server-authoritative writes
     * deferred to M4 are refused rather than silently accepted into the wrong
     * class.
     */
    return malformed(
      "This record is not one the club's system knows how to store.",
    );
  }

  if (envelope.deviceId !== auth.device.deviceId) {
    return rejected({
      reason: "This record says it came from a different device.",
      remedy: "A developer needs to look at it: the record's device does not " +
        "match the one that sent it.",
    });
  }

  const result = await handlePush(envelope, new PostgresAppendOnlyWriter());

  switch (result.kind) {
    case "applied":
    case "duplicate": {
      /* Bookkeeping after the record is safely stored, never before. */
      await touchDevice(auth.device.deviceId);

      const body: PushResponse = {
        outcome: result.kind,
        recordedAt: result.recordedAt.toISOString(),
      };
      return ok(body);
    }

    case "rejected":
      log.warn("sync.push.rejected", {
        deviceId: auth.device.deviceId,
        operation: envelope.operation,
        recordId: envelope.id,
        reason: result.reason,
      });
      return rejected({ reason: result.reason, remedy: result.remedy });

    case "failed":
      /* The record is still on the device. Logged here because the officer's copy
         of this is "waiting for a connection", which is true and not diagnosable. */
      log.error("sync.push.failed", {
        deviceId: auth.device.deviceId,
        operation: envelope.operation,
        recordId: envelope.id,
        message: result.reason,
      });
      return unavailable("The club's system could not store this record just now.");
  }
}
