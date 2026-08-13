import {
  CAPTURE_METHODS,
  CUSTODY_EVENT_TYPES,
  PARTICIPANT_ROLES,
} from "@/domain/enums";
import { isUuidv7 } from "@/lib/uuidv7";
/**
 * Type-only, and that matters twice.
 *
 * It gives every value below compile-time checking against the real column set —
 * a renamed or mistyped column is a build failure rather than a runtime error on a
 * range floor. And because `import type` is erased entirely, this module keeps no
 * runtime dependency on Drizzle or `pg`, so it stays importable from a test and from
 * anywhere else without dragging a database driver along.
 */
import type * as armory from "@/db/armory/schema";
import type { PushOperation, PushRequest } from "./contract";

/**
 * PUSH OPERATIONS — what a queued write becomes, and what it is refused for.
 *
 * §7: "Every write accepts a client-generated UUIDv7 as the record identity and
 * is safe to replay. A queued write delivered twice must produce one row, not
 * two. This is the single most important API requirement in the system."
 *
 * ===========================================================================
 * WHY THE ROW IS THE RECEIPT
 *
 * The schema has a `write_receipts` table, and it is deliberately unused by
 * everything in this file. A receipt exists to remember that a request was
 * already handled, and none of the operations here need one, because their
 * primary key IS the client-generated id:
 *
 *   INSERT INTO armory.custody_events (id, …) VALUES ($1, …)
 *   ON CONFLICT (id) DO NOTHING
 *
 * One statement, so it is atomic with no transaction at all — and a receipt written
 * separately from the row would be exactly the pair that must not be able to come
 * apart. Receipt first and the power fails: the record is lost while the server
 * believes it arrived. Row first and the power fails: the replay writes it twice.
 * Making them the same statement removes the question.
 *
 * The schema agrees, and says so at `writeReceipts` in src/db/armory/schema.ts: "For
 * append-only tables the record id IS the idempotency key… no extra table is needed.
 * This table covers the other half — server-authoritative operations that are not a
 * single row insert."
 *
 * That other half — closing a session, reconciling ammunition, authorising a guest
 * against an allowance (§8.3) — arrives with M4 and M5, in a transaction. The
 * management system has real ones; see src/db/armory/client.ts, which exists because
 * §8.3 requires the allowance counter to move "inside a transaction, with the
 * invitation write".
 *
 * ===========================================================================
 * WHY VALIDATION IS HERE AND ALSO IN POSTGRES
 *
 * migration 0002 enforces the append-only and arithmetic rules with triggers, and
 * §12 requires that: "Every append-only table rejects update and delete at the
 * database level, not merely in application code."
 *
 * This module is not a substitute for that and does not repeat it. It exists to
 * turn what would be a Postgres error into the one thing §8.2 asks for — "an
 * officer sees the rejection, never silently discarded" — as a sentence a range
 * officer can act on. A queued custody event that fails with
 * `invalid input syntax for type uuid` has surfaced nothing useful to anybody.
 */

/* ---------------------------------------------------------------------------
   THE ROW
   -------------------------------------------------------------------------- */

/**
 * A validated insert, ready for the writer.
 *
 * A discriminated union rather than a table name and a bag of columns. The earlier
 * shape carried `table: string` and `values: Record<string, unknown>`, which put two
 * avoidable risks in the most safety-critical write path in the system: a column name
 * could be misspelled with nothing to catch it until Postgres refused the row, and
 * the table was a string being interpolated into SQL.
 *
 * Discriminating on `target` means each branch's `values` is checked against the
 * actual table, so `checkedInAt` cannot become `checkedinAt`, and
 * src/server/sync/writer.ts resolves the target to a real Drizzle table object
 * instead of building an identifier.
 *
 * Note the tables are the ones in the `armory` schema. `armory.rounds` and the public
 * `rounds` table (leagues, Phase 2) both exist and are different things; referring to
 * the schema object makes it impossible to reach the wrong one by search path.
 */
export type AppendOnlyInsert =
  | { target: "participations"; values: typeof armory.participations.$inferInsert }
  | { target: "waiverSignatures"; values: typeof armory.waiverSignatures.$inferInsert }
  | { target: "custodyEvents"; values: typeof armory.custodyEvents.$inferInsert }
  | { target: "ammunitionIssues"; values: typeof armory.ammunitionIssues.$inferInsert }
  | { target: "rounds"; values: typeof armory.rounds.$inferInsert }
  | { target: "auditLog"; values: typeof armory.auditLog.$inferInsert };

export type ParseResult =
  | { ok: true; row: AppendOnlyInsert }
  | { ok: false; reason: string; remedy: string | null };

const reject = (reason: string, remedy: string | null = null): ParseResult => ({
  ok: false,
  reason,
  remedy,
});

/* ---------------------------------------------------------------------------
   FIELD READERS

   Small and local rather than a schema library. Each returns `undefined` for
   "not usable", and the caller turns that into a sentence naming the field —
   which is the part a generic validator gets wrong for this system, because §4.3
   and §8.2 both require the refusal to read as English.
   -------------------------------------------------------------------------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const asObject = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** A reference to a row the server already has. Any UUID version. */
const uuid = (source: Record<string, unknown>, field: string): string | undefined => {
  const value = source[field];
  return typeof value === "string" && UUID.test(value) ? value : undefined;
};

const optionalUuid = (
  source: Record<string, unknown>,
  field: string,
): string | null | undefined => {
  const value = source[field];
  if (value === null || value === undefined) return null;
  return typeof value === "string" && UUID.test(value) ? value : undefined;
};

const text = (
  source: Record<string, unknown>,
  field: string,
): string | undefined => {
  const value = source[field];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const optionalText = (
  source: Record<string, unknown>,
  field: string,
): string | null | undefined => {
  const value = source[field];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** A non-negative whole number. Quantities and scores are both. */
const wholeNumber = (
  source: Record<string, unknown>,
  field: string,
): number | undefined => {
  const value = source[field];
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    Number.isFinite(value)
    ? value
    : undefined;
};

/**
 * An ISO instant, as a Date.
 *
 * The column is `timestamp with time zone` and Drizzle binds a Date to it directly,
 * so the round trip is exact for any valid ISO instant. Validated by parsing rather
 * than by a regex: a string that `Date.parse` cannot read would reach Postgres as
 * `Invalid Date` and fail there, hours later, inside a queued record.
 */
const instant = (
  source: Record<string, unknown>,
  field: string,
): Date | undefined => {
  const value = source[field];
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed);
};

const oneOf = <T extends string>(
  source: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T | undefined => {
  const value = source[field];
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
};

const missing = (field: string, what: string): ParseResult =>
  reject(
    `This record is missing ${what}, so the club's system would not accept it.`,
    `A developer needs to look at it: the ${field} field was not usable.`,
  );

/* ---------------------------------------------------------------------------
   THE OPERATIONS
   -------------------------------------------------------------------------- */

type Parser = (request: PushRequest, payload: Record<string, unknown>) => ParseResult;

const parsers: Record<PushOperation, Parser> = {
  /**
   * A check-in. §3.3: "APPEND-ONLY on check-in."
   *
   * `tier_snapshot` is the tier as it stood at the visit. §3.3 is explicit that
   * it must be recorded rather than joined to the live tier later, so that a
   * report about last season does not silently change when a tier is edited. The
   * desk has the tier in the day pack and writes it here.
   */
  "participations.checkin": (request, payload) => {
    const sessionId = uuid(payload, "sessionId");
    if (!sessionId) return missing("sessionId", "the session it belongs to");

    const personId = uuid(payload, "personId");
    if (!personId) return missing("personId", "the person being checked in");

    const role = oneOf(payload, "role", PARTICIPANT_ROLES);
    if (!role) return missing("role", "whether this is a member, guest or spectator");

    const checkedInAt = instant(payload, "checkedInAt");
    if (!checkedInAt) return missing("checkedInAt", "the time of the check-in");

    const hostPersonId = optionalUuid(payload, "hostPersonId");
    if (hostPersonId === undefined) return missing("hostPersonId", "a valid host");

    /* §3.3: "host_person_id required when role is guest_shooter." Checked here as
       well as in the database so the officer gets this sentence instead of a
       constraint name — and because a guest with no recorded host is the exact
       record §1.1's second rule exists to prevent. */
    if (role === "guest_shooter" && !hostPersonId) {
      return reject(
        "A guest cannot be checked in without recording who is hosting them.",
        "Go back and choose the member bringing this guest.",
      );
    }

    const laneId = optionalUuid(payload, "laneId");
    if (laneId === undefined) return missing("laneId", "a valid lane");

    return {
      ok: true,
      row: {
        target: "participations",
        values: {
          id: request.id,
          sessionId,
          personId,
          role,
          hostPersonId,
          laneId,
          /* jsonb. Drizzle binds the object; no manual serialisation. */
          tierSnapshot: payload.tierSnapshot ?? null,
          checkedInAt,
          checkedInByStaffId: request.actorStaffId,
          deviceId: request.deviceId,
          /* `recordedAt` is deliberately absent: it is the server's clock and is
             left to the column default. §2 — both clocks, never one instead of
             the other. */
        },
      },
    };
  },

  /**
   * A waiver signature. §3.1: "APPEND-ONLY. No update, no delete. A resignature
   * is a new row."
   */
  "waiver_signatures.create": (request, payload) => {
    const personId = uuid(payload, "personId");
    if (!personId) return missing("personId", "the person who signed");

    const waiverVersionId = uuid(payload, "waiverVersionId");
    if (!waiverVersionId) {
      return missing("waiverVersionId", "which version of the waiver was signed");
    }

    const signedAt = instant(payload, "signedAt");
    if (!signedAt) return missing("signedAt", "the time it was signed");

    const signatureImageUrl = optionalText(payload, "signatureImageUrl");
    if (signatureImageUrl === undefined) {
      return missing("signatureImageUrl", "a valid signature image reference");
    }

    return {
      ok: true,
      row: {
        target: "waiverSignatures",
        values: {
          id: request.id,
          personId,
          waiverVersionId,
          signatureImageUrl,
          signedAt,
          deviceId: request.deviceId,
        },
      },
    };
  },

  /**
   * A custody event. §3.4: "custody_events is append-only and is the sole source
   * of truth for where any firearm is. No update. No delete. Ever."
   *
   * The firearm's status is derived from this row by a trigger, so this insert is
   * also how a firearm becomes `issued` — there is no second write to keep in
   * step, which is the §3.4 architectural instruction working as intended.
   */
  "custody_events.create": (request, payload) => {
    const firearmId = uuid(payload, "firearmId");
    if (!firearmId) return missing("firearmId", "which firearm this concerns");

    const eventType = oneOf(payload, "eventType", CUSTODY_EVENT_TYPES);
    if (!eventType) return missing("eventType", "what happened to the firearm");

    const occurredAt = instant(payload, "occurredAt");
    if (!occurredAt) return missing("occurredAt", "the time it happened");

    const counterpartyPersonId = optionalUuid(payload, "counterpartyPersonId");
    if (counterpartyPersonId === undefined) {
      return missing("counterpartyPersonId", "a valid person");
    }

    const sessionId = optionalUuid(payload, "sessionId");
    if (sessionId === undefined) return missing("sessionId", "a valid session");

    const correctsEventId = optionalUuid(payload, "correctsEventId");
    if (correctsEventId === undefined) {
      return missing("correctsEventId", "a valid event to correct");
    }

    const note = optionalText(payload, "note");
    if (note === undefined) return missing("note", "a usable note");

    /* §1.2 rule 3: "a correction is a new row referencing the old one." A
       correction that cites nothing is indistinguishable from an ordinary event
       and destroys the audit trail it was meant to repair. */
    if (eventType === "correction" && !correctsEventId) {
      return reject(
        "A correction has to say which entry it corrects.",
        "Open the movement log and choose the entry being corrected.",
      );
    }

    return {
      ok: true,
      row: {
        target: "custodyEvents",
        values: {
          id: request.id,
          firearmId,
          eventType,
          actorStaffId: request.actorStaffId,
          counterpartyPersonId,
          sessionId,
          occurredAt,
          deviceId: request.deviceId,
          correctsEventId,
          note,
        },
      },
    };
  },

  /**
   * An ammunition issue. §3.4: "Reconciled per participation, not per day."
   *
   * Issue only. The reconciliation fields are left null: setting them is an
   * UPDATE, which the database allows exactly once and which the arithmetic guard
   * in migration 0002 checks. That write belongs to session close (M5) and is not
   * a create.
   */
  "ammunition_issues.create": (request, payload) => {
    const lotId = uuid(payload, "lotId");
    if (!lotId) return missing("lotId", "which lot the ammunition came from");

    const participationId = uuid(payload, "participationId");
    if (!participationId) {
      return missing("participationId", "the shooter it was issued to");
    }

    const qtyIssued = wholeNumber(payload, "qtyIssued");
    if (qtyIssued === undefined) return missing("qtyIssued", "how many rounds");

    if (qtyIssued === 0) {
      return reject(
        "An ammunition issue of no rounds is not a record of anything.",
        "Enter the number of rounds issued.",
      );
    }

    const issuedAt = instant(payload, "issuedAt");
    if (!issuedAt) return missing("issuedAt", "the time of the issue");

    return {
      ok: true,
      row: {
        target: "ammunitionIssues",
        values: {
          id: request.id,
          lotId,
          participationId,
          qtyIssued,
          /* Left null. Setting these is an UPDATE, which the arithmetic guard in
             migration 0002 permits exactly once, and which belongs to session
             close (M5) rather than to an issue. */
          qtyFired: null,
          qtyReturned: null,
          issuedByStaffId: request.actorStaffId,
          issuedAt,
          deviceId: request.deviceId,
        },
      },
    };
  },

  /** A score. §3.3: "APPEND-ONLY. capture_method: manual, electronic." */
  "rounds.create": (request, payload) => {
    const participationId = uuid(payload, "participationId");
    if (!participationId) return missing("participationId", "whose score this is");

    const discipline = text(payload, "discipline");
    if (!discipline) return missing("discipline", "the discipline");

    const format = text(payload, "format");
    if (!format) return missing("format", "the format shot");

    const totalScore = wholeNumber(payload, "totalScore");
    if (totalScore === undefined) return missing("totalScore", "a score");

    const captureMethod = oneOf(payload, "captureMethod", CAPTURE_METHODS);
    if (!captureMethod) {
      return missing("captureMethod", "how the score was captured");
    }

    const capturedAt = instant(payload, "capturedAt");
    if (!capturedAt) return missing("capturedAt", "the time it was captured");

    const sourceReference = optionalText(payload, "sourceReference");
    if (sourceReference === undefined) {
      return missing("sourceReference", "a usable source reference");
    }

    const correctsRoundId = optionalUuid(payload, "correctsRoundId");
    if (correctsRoundId === undefined) {
      return missing("correctsRoundId", "a valid score to correct");
    }

    const correctionReason = optionalText(payload, "correctionReason");
    if (correctionReason === undefined) {
      return missing("correctionReason", "a usable correction reason");
    }

    /* Rule 3 again: a correction names what it corrects, and here it also has to
       say why — a re-entered score with no reason is unauditable. */
    if (correctsRoundId && !correctionReason) {
      return reject(
        "A corrected score has to say why it was changed.",
        "Add a short reason for the correction.",
      );
    }

    return {
      ok: true,
      row: {
        target: "rounds",
        values: {
          id: request.id,
          participationId,
          discipline,
          format,
          totalScore,
          shotDetail: payload.shotDetail ?? null,
          captureMethod,
          sourceReference,
          capturedByStaffId: request.actorStaffId,
          capturedAt,
          correctsRoundId,
          correctionReason,
          deviceId: request.deviceId,
        },
      },
    };
  },

  /**
   * An audit entry. §3.6: "APPEND-ONLY. Every custody event, score, waiver,
   * admission, guest authorisation, block and override."
   *
   * Pushed from the device rather than written server-side on receipt, because
   * §4.3 requires an override to record "who, why, and on which device" and the
   * only machine that knows an officer overrode a block is the one that showed it
   * to them. A block overridden during a power cut has to survive the power cut.
   */
  "audit_log.create": (request, payload) => {
    const action = text(payload, "action");
    if (!action) return missing("action", "what was done");

    const entityType = text(payload, "entityType");
    if (!entityType) return missing("entityType", "what it was done to");

    const entityId = optionalUuid(payload, "entityId");
    if (entityId === undefined) return missing("entityId", "a valid record");

    const occurredAt = instant(payload, "occurredAt");
    if (!occurredAt) return missing("occurredAt", "the time it happened");

    const isOverride = payload.isOverride === true;

    const overrideReason = optionalText(payload, "overrideReason");
    if (overrideReason === undefined) {
      return missing("overrideReason", "a usable reason");
    }

    /* §3.6: "An override is permitted but never silent — override_reason is
       mandatory when present." An override with no reason is the one audit row
       that would matter most and say least. */
    if (isOverride && !overrideReason) {
      return reject(
        "An override has to be recorded with a reason.",
        "Say briefly why the block was overridden.",
      );
    }

    return {
      ok: true,
      row: {
        target: "auditLog",
        values: {
          id: request.id,
          actorStaffId: request.actorStaffId,
          action,
          entityType,
          entityId,
          before: payload.before ?? null,
          after: payload.after ?? null,
          deviceId: request.deviceId,
          isOverride,
          overrideReason,
          occurredAt,
        },
      },
    };
  },
};

/**
 * Turn a push request into a row, or into a sentence explaining the refusal.
 *
 * Checks common to every operation live here rather than in each parser: the
 * identity rule is §7's and applies to all of them equally.
 */
export function parsePush(request: PushRequest): ParseResult {
  /**
   * §7 and §2: the id is a client-generated UUIDv7.
   *
   * Enforced rather than assumed because the ordering of the whole outbox depends
   * on it. src/offline/outbox/outbox.ts sorts the queue lexicographically by id
   * and relies on v7 sorting into creation order; a v4 id accepted here would
   * take its place in that ordering at random, and an ammunition issue could
   * legitimately be delivered before the participation it references.
   */
  if (!isUuidv7(request.id)) {
    return reject(
      "This record does not carry a usable identity, so it cannot be stored " +
        "safely.",
      "A developer needs to look at it: the record id is not a UUIDv7.",
    );
  }

  if (!UUID.test(request.deviceId)) {
    return reject(
      "This record does not say which device it came from.",
      "A developer needs to look at it: the device id is not a UUID.",
    );
  }

  if (request.actorStaffId !== null && !UUID.test(request.actorStaffId)) {
    /* §10: "Every staff action attributable to a named person." A record whose
       actor is unreadable is worse than one with no actor, because it looks
       attributed. */
    return reject(
      "This record does not say which officer made it.",
      "A developer needs to look at it: the staff id is not a UUID.",
    );
  }

  const payload = asObject(request.payload);
  if (!payload) {
    return reject(
      "This record arrived empty and cannot be stored.",
      "A developer needs to look at it: the payload was not an object.",
    );
  }

  return parsers[request.operation](request, payload);
}
