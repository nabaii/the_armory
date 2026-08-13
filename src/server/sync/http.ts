import type { DayPack } from "@/offline/daypack";
import type { SyncError } from "@/sync/contract";
import { authenticateDevice, type DeviceIdentity } from "./device-auth";

/**
 * SHARED PLUMBING FOR /sync/*.
 *
 * Three endpoints, one set of rules about status codes and cache headers, kept
 * here so they cannot drift apart. src/sync/contract.ts explains why the status
 * code is the contract rather than a field in the body: the outbox turns it into
 * one of four fates for a queued record, and collapsing them loses the difference
 * between a record to retry and a record to show an officer.
 */

/**
 * Every sync response.
 *
 * `no-store` on all of them. These bodies contain the roster, the firearm register
 * and every guest invitation in the window; the console service worker already
 * refuses to cache anything under /sync/ (see public/console/sw.js), and this is
 * the same instruction to every proxy between the tablet and the server.
 */
function respond(body: unknown, status: number, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export const ok = (body: unknown, headers?: HeadersInit): Response =>
  respond(body, 200, headers);

/** 401. The outbox holds the queue and waits for an unlock; nothing is discarded. */
export const unauthenticated = (reason: string): Response =>
  respond({ reason, remedy: null } satisfies SyncError, 401);

/**
 * 403, and the body a revoked tablet acts on. §10.
 *
 * The one response that causes a device to destroy its own data, so it says so
 * unambiguously rather than leaving the client to infer it from a status code.
 */
export const revoked = (): Response =>
  respond(
    {
      reason: "This device has been signed out of the club's system.",
      remedy:
        "A founder can register it again from the owner dashboard if it should " +
        "still be in use.",
      revoked: true,
    },
    403,
  );

/**
 * 409. The server understood the record and will not store it.
 *
 * Final: policy.ts will not retry this, and the record is surfaced to an officer
 * with the reason (§8.2: "Rejections surface to the officer — never silently
 * discarded"). 409 rather than 400 because the payload was well-formed JSON that
 * the domain refused, and a 400 reads to every intermediary as a malformed request.
 */
export const rejected = (error: SyncError): Response => respond(error, 409);

/** 400. The envelope itself was unreadable. Also final. */
export const malformed = (reason: string): Response =>
  respond({ reason, remedy: null } satisfies SyncError, 400);

/** 503. Retryable — the record stays on the device and the queue brings it back. */
export const unavailable = (reason: string): Response =>
  respond(
    {
      reason,
      remedy: "The device will keep trying on its own.",
    } satisfies SyncError,
    503,
  );

/**
 * Authenticate, and refuse a revoked device.
 *
 * Returns either the device or the Response to send instead, so a handler reads as
 * a guard clause rather than nested conditionals.
 */
export async function requireDevice(
  request: Request,
): Promise<{ device: DeviceIdentity } | { response: Response }> {
  let result;
  try {
    result = await authenticateDevice(request);
  } catch (error) {
    /* An unconfigured or unreachable database is not the device's fault and must
       not read as a credential failure — a 401 would make the tablet hold its whole
       queue waiting for an unlock that nobody needs to perform. */
    return {
      response: unavailable(
        error instanceof Error && /DATABASE_URL/.test(error.message)
          ? "The club's system is not configured to accept syncs yet."
          : "The club's system could not be reached.",
      ),
    };
  }

  if (!result.ok) return { response: unauthenticated(result.reason) };
  if (result.device.revoked) return { response: revoked() };

  return { device: result.device };
}

/**
 * A fingerprint of a pack's CONTENT, for the conditional refresh.
 *
 * `pulledAt` is excluded, and that exclusion is the entire point. It is the server's
 * clock at the moment of the query, so it differs on every request; including it
 * would produce a new fingerprint every time and the 304 path — which is the common
 * case, because a club does not change between two refreshes thirty seconds apart —
 * would never be taken.
 *
 * Excluding it is safe because `pulledAt` is not data the desk decides anything
 * with. It drives the staleness sentence in `isDayPackUsable`, and a device that
 * gets a 304 keeps the `pulledAt` of the pack it already holds, which is the honest
 * answer: nothing has changed, so it is still working from information gathered
 * then.
 */
export async function fingerprint(pack: DayPack): Promise<string> {
  /* A replacer rather than a destructure, so the exclusion is one expression and
     the reason for it stays next to it. No nested key is named `pulledAt`. */
  const content = JSON.stringify(pack, (key, value) =>
    key === "pulledAt" ? undefined : value,
  );

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(content),
  );

  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  /* Quoted, because that is what an ETag is, and an unquoted one is silently
     ignored by some intermediaries. */
  return `"${hex}"`;
}
