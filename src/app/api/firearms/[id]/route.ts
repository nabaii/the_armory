import { CUSTODY_EVENT_TYPES, type CustodyEventType } from "@/domain/enums";
import { correctCustodyEvent, custodyLog } from "@/server/armory/register";
import {
  forbidden,
  handleRead,
  handleWrite,
  malformed,
  readWrite,
  requireStaff,
} from "@/server/armory/http";

/**
 * /api/firearms/:id — §3.4's custody log.
 *
 * GET  the movement history.
 * POST a correction, and nothing else.
 *
 * ===========================================================================
 * THE ONLY WRITE IS A CORRECTION, AND IT IS AN APPEND
 *
 * §3.4: "custody_events is append-only… No update. No delete. Ever."
 * §1.2 rule 3: "a correction is a new row referencing the old one."
 *
 * There is no PATCH and no DELETE on this route, and their absence is the
 * feature. The database would refuse either — the triggers in drizzle/0002 make
 * that certain rather than trusted — but an endpoint that offered them would
 * teach a client that editing the log is a thing one does, and the first
 * developer to hit the trigger would go looking for a way around it.
 *
 * Correcting is founder-only. It changes what the club's append-only log says
 * happened, which is a different act from recording a movement — a range officer
 * records what they did, and deciding that an existing entry is wrong is the
 * founder's call.
 */

export const dynamic = "force-dynamic";

const isEventType = (value: unknown): value is CustodyEventType =>
  typeof value === "string" &&
  (CUSTODY_EVENT_TYPES as readonly string[]).includes(value);

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireStaff(request, { atLeast: "read_only" });
  if ("response" in auth) return auth.response;

  const { id } = await context.params;

  return handleRead("firearms.custody_log", async (tx) => {
    const entries = await custodyLog(tx, id);

    return {
      firearmId: id,
      /* Corrected entries are included and marked. §1.2 rule 3 keeps the
         original precisely so it can be read; hiding superseded rows would make
         the log editable by appending. */
      events: entries.map((entry) => ({
        ...entry,
        occurredAt: entry.occurredAt.toISOString(),
        recordedAt: entry.recordedAt.toISOString(),
      })),
    };
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireStaff(request);
  if ("response" in auth) return auth.response;

  /* Unused for the write itself — a correction inherits its firearm from the
     event it corrects, so trusting the URL could attach a correction to the
     wrong firearm. Awaited so the route signature stays honest about what it
     receives. */
  await context.params;

  if (auth.staff.role !== "founder") {
    return forbidden(
      "Correcting the movement log is the founder's decision.",
      "Record what happened as a new movement, or ask the founder to correct the entry.",
    );
  }

  const write = await readWrite(request);
  if ("response" in write) return write.response;

  const { correctsEventId, eventType, reason } = write.envelope.payload;

  if (typeof correctsEventId !== "string") {
    return malformed("A correction has to say which entry it corrects.");
  }

  if (!isEventType(eventType) || eventType === "correction") {
    return malformed(
      "A correction has to say what actually happened — issued, returned, taken out, and so on.",
    );
  }

  if (typeof reason !== "string") {
    return malformed("A correction needs a reason.");
  }

  return handleWrite(
    { envelope: write.envelope, operation: "custody.correct", staff: auth.staff },
    (tx) =>
      correctCustodyEvent(tx, {
        correctsEventId,
        eventType,
        reason,
        occurredAt: new Date(),
        deviceId: auth.staff.deviceId,
      }),
  );
}
