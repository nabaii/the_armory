import type { StaffRole } from "@/domain/enums";
import { log } from "@/server/log";
import { readDeviceToken } from "@/server/sync/device-auth";
import { PostgresRecordStore } from "./postgres-store";
import {
  record,
  type Outcome,
  type RecordRequest,
  type Written,
} from "./record";
import { resolveStaffSession, type StaffIdentity } from "./staff-session";
import type { ArmoryTx } from "@/db/armory/client";

/**
 * THE HTTP BOUNDARY FOR THE MANAGEMENT API.
 *
 * The same role src/server/sync/http.ts plays for /sync/*, one layer up: one set
 * of rules about status codes and authentication, kept in one file so the routes
 * cannot drift apart.
 *
 * ===========================================================================
 * WHY THE OUTCOME MAPPING LIVES HERE AND NOT IN EACH ROUTE
 *
 * §7: "A queued write delivered twice must produce one row, not two. This is the
 * single most important API requirement in the system."
 *
 * `record()` already guarantees that at the database. What a route can still get
 * wrong is TELLING the client about it — and the dangerous mistake is a natural
 * one. A `duplicate` looks like a conflict, 409 is the conflict status, and a
 * client that receives 409 for a replay will treat a successfully stored record
 * as rejected. src/sync/contract.ts is explicit that a 409 is FINAL: the record
 * is surfaced to an officer as refused and never retried.
 *
 * So one route mapping `duplicate` to 409 would not produce a duplicated row —
 * it would produce a phantom refusal for a record that is safely stored, which
 * is arguably worse because nothing in the database looks wrong.
 *
 * `duplicate` is therefore a 200 carrying the FIRST execution's result, exactly
 * as /sync/push answers it, and no route is in a position to decide otherwise.
 *
 * ===========================================================================
 * WHY THESE ROUTES SIT UNDER /api AND /sync/* DOES NOT
 *
 * /sync/* is a closed namespace owned by the device protocol, referenced by the
 * service worker and the outbox, and moving it would be a breaking change to
 * software already installed on tablets.
 *
 * These are a different audience — a browser holding a staff session — and they
 * would otherwise share a namespace with the marketing site. A future page at
 * /applications would silently collide with the resource of the same name, and
 * the collision would appear as a route that returns HTML to a fetch(). §7 calls
 * its resource list "indicative, not a contract. Shape it as the team prefers."
 */

/* ============================================================================
   RESPONSES
   ========================================================================= */

export type ApiError = {
  readonly reason: string;
  readonly remedy: string | null;
};

function respond(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      /* Same instruction as /sync/*: these bodies carry the roster, applications
         and personal data §10 calls "a concentration of sensitive personal
         data". No intermediary should hold a copy. */
      "cache-control": "no-store",
    },
  });
}

export const ok = (body: unknown): Response => respond(body, 200);

export const malformed = (reason: string): Response =>
  respond({ reason, remedy: null } satisfies ApiError, 400);

export const unauthenticated = (): Response =>
  respond(
    {
      reason: "This request did not carry a staff session.",
      remedy: "Unlock the desk with your PIN and try again.",
    } satisfies ApiError,
    401,
  );

/**
 * 403. Authenticated, and not permitted.
 *
 * Distinct from 401 on purpose: a range officer who cannot see a licence
 * document (§10) has not failed to sign in, and telling them to sign in again
 * would send them round a loop that cannot succeed.
 */
export const forbidden = (reason: string, remedy: string | null = null): Response =>
  respond({ reason, remedy } satisfies ApiError, 403);

/** 409. Well-formed, and the domain refused it. Final — see sync/contract.ts. */
export const refusedResponse = (error: ApiError): Response => respond(error, 409);

/** 503. Retryable; nothing was written and the caller should come back. */
export const unavailable = (reason: string): Response =>
  respond(
    { reason, remedy: "Try again in a moment." } satisfies ApiError,
    503,
  );

/* ============================================================================
   AUTHENTICATION
   ========================================================================= */

/**
 * §10's roles, ordered by what they may do.
 *
 * `read_only` exists so the club can give someone visibility without giving them
 * the ability to change the record — an accountant, an auditor, a founder's
 * second device. A route that only checked "is there a session" would hand all
 * three the same powers and make the role decorative.
 */
/**
 * ===========================================================================
 * THIS LADDER GOVERNS THE M0–M10 API AND NOTHING IN THE MANAGEMENT SYSTEM
 *
 * A total order over roles cannot express "custody and payment are never in the
 * same hands" — an ordering has no way to say that two authorities are
 * individually fine and jointly forbidden. That is why the management system's
 * authority is a set of grants (src/domain/grants.ts) rather than a rank, and
 * why nothing under the management route group consults this map.
 *
 * It stays because these routes exist and work. What matters when adding a role
 * is the rule below.
 *
 * ===========================================================================
 * A NEW ROLE NEVER CLEARS A GATE IT WAS NOT WEIGHED AGAINST
 *
 * The five roles added with the management system sit at the range officer's
 * rank, not above it. Ranking `finance` or `duty_manager` between officer and
 * founder would read as an org chart and would silently widen every
 * `atLeast: "founder"` route in the codebase — a founder-only endpoint, such as
 * erasing a person, would begin admitting the club's bookkeeper because
 * somebody drew the hierarchy the way the org chart looks.
 *
 * So: founder is 2 and alone. Everything operational is 1. Anything that needs
 * a finer distinction than that asks for a GRANT.
 */
const RANK: Record<StaffRole, number> = {
  read_only: 0,
  front_of_house: 0,
  range_officer: 1,
  armourer: 1,
  duty_manager: 1,
  finance: 1,
  safety_officer: 1,
  founder: 2,
};

export type StaffGuard = {
  /** The least privileged role permitted. Defaults to range_officer. */
  readonly atLeast?: StaffRole;
};

/**
 * Identify the officer behind a request, or produce the response to send.
 *
 * Reads the same `Authorization: Bearer` header as the device endpoints, and for
 * the same reason recorded in device-auth.ts: a token in a URL is written to
 * every access log, proxy cache and browser history between the tablet and the
 * database.
 *
 * The guard clause shape — `if ("response" in auth) return auth.response` —
 * matches `requireDevice`, so a handler in either namespace reads the same way.
 */
export async function requireStaff(
  request: Request,
  guard: StaffGuard = {},
): Promise<{ staff: StaffIdentity } | { response: Response }> {
  const atLeast = guard.atLeast ?? "range_officer";

  let staff: StaffIdentity | null;
  try {
    staff = await resolveStaffSession(readDeviceToken(request), new Date());
  } catch (error) {
    /* An unconfigured or unreachable database is not a credential failure. A 401
       would send an officer to re-enter a PIN that was never the problem — the
       same reasoning as requireDevice in sync/http.ts. */
    return {
      response: unavailable(
        error instanceof Error && /DATABASE_URL/.test(error.message)
          ? "The club's system is not configured yet."
          : "The club's system could not be reached.",
      ),
    };
  }

  if (!staff) return { response: unauthenticated() };

  if (RANK[staff.role] < RANK[atLeast]) {
    return {
      response: forbidden(
        "Your role does not cover this.",
        atLeast === "founder"
          ? "Only the founder can do this."
          : "Ask a range officer or the founder.",
      ),
    };
  }

  return { staff };
}

/* ============================================================================
   THE WRITE HANDLER
   ========================================================================= */

const store = new PostgresRecordStore();

/**
 * A write's envelope, as it arrives over HTTP.
 *
 * `requestId` is the client-generated UUIDv7 §7 requires. It is read from the
 * body rather than generated here, and that is the whole mechanism: a caller
 * that retries must send the SAME id, and a server that minted one would make
 * every retry a new operation.
 */
export type WriteEnvelope = {
  readonly requestId: string;
  readonly payload: Record<string, unknown>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readEnvelope(body: unknown): WriteEnvelope | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as Record<string, unknown>;

  if (typeof raw.requestId !== "string" || !UUID.test(raw.requestId)) return null;
  if (typeof raw.payload !== "object" || raw.payload === null) return null;

  return {
    requestId: raw.requestId,
    payload: raw.payload as Record<string, unknown>,
  };
}

/** Read and validate a JSON write envelope, or the response to send instead. */
export async function readWrite(
  request: Request,
): Promise<{ envelope: WriteEnvelope } | { response: Response }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { response: malformed("This request could not be read.") };
  }

  const envelope = readEnvelope(body);
  if (!envelope) {
    return {
      response: malformed(
        "A write needs a requestId — a UUID the caller generates — and a payload.",
      ),
    };
  }

  return { envelope };
}

/**
 * Map an outcome to a response. The one place that decision is made.
 *
 * Exported so it can be tested directly; §7's replay guarantee is only as good
 * as this function, and it has no database in it.
 */
export function outcomeResponse<T>(outcome: Outcome<T>): Response {
  switch (outcome.status) {
    case "applied":
      return ok({ outcome: "applied", result: outcome.result });

    case "duplicate":
      /* 200, carrying the FIRST execution's result. See the header. */
      return ok({ outcome: "duplicate", result: outcome.result });

    case "refused":
      /* IN_FLIGHT is the one refusal that is not final. The record is being
         written by another delivery of the same request, so the caller should
         come back rather than surface a refusal to an officer for a record that
         is about to exist. */
      if (outcome.refusal.code === "IN_FLIGHT") {
        return unavailable(outcome.refusal.message);
      }

      return refusedResponse({
        reason: outcome.refusal.message,
        remedy: null,
      });
  }
}

/**
 * Run a server-authoritative write and answer the caller.
 *
 * Everything §7 asks of a write endpoint is discharged by this one function:
 * idempotency and audit come from `record()`, attribution from the staff
 * session, and the status codes from `outcomeResponse`. A route's remaining job
 * is to read its own payload and call this.
 */
export async function handleWrite<T>(
  input: {
    readonly envelope: WriteEnvelope;
    readonly operation: string;
    readonly staff: StaffIdentity;
  },
  body: (tx: ArmoryTx) => Promise<Written<T>>,
): Promise<Response> {
  const request: RecordRequest = {
    requestId: input.envelope.requestId,
    operation: input.operation,
    actor: {
      staffUserId: input.staff.staffUserId,
      deviceId: input.staff.deviceId,
    },
    /* The server's clock. Unlike a queued record from the desk, this write is
       happening now, over a live connection — there is no device clock to
       preserve because there was no offline interval to preserve it across. */
    occurredAt: new Date(),
  };

  try {
    return outcomeResponse(await record(store, request, body));
  } catch (error) {
    /* A fault, not a refusal. `record()` rolled the transaction back including
       the claim, so the same requestId can be retried — which is what 503 tells
       the caller to do. */
    log.error("armory.write.failed", {
      operation: input.operation,
      requestId: input.envelope.requestId,
      staffUserId: input.staff.staffUserId,
      message: error instanceof Error ? error.message : String(error),
    });

    return unavailable("The club's system could not store this just now.");
  }
}

/**
 * Run a read and answer the caller.
 *
 * Reads take no receipt and write no audit — they are not operations in §7's
 * sense — but they do need the same transaction handle and the same treatment
 * of a database that is down.
 */
export async function handleRead<T>(
  operation: string,
  body: (tx: ArmoryTx) => Promise<T>,
): Promise<Response> {
  try {
    return ok(await store.transaction(body));
  } catch (error) {
    log.error("armory.read.failed", {
      operation,
      message: error instanceof Error ? error.message : String(error),
    });
    return unavailable("The club's system could not be reached just now.");
  }
}
