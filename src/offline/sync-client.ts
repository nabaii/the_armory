import type {
  DayPackResponse,
  PullResponse,
  PushRequest,
  PushResponse,
} from "@/sync/contract";
import type { SendResult, Sender, OutboxItem } from "./outbox/outbox";
import type { DayPack } from "./daypack";

/**
 * THE CLIENT SIDE OF /sync/* — where the queue meets the network.
 *
 * src/offline/outbox/policy.ts decides what becomes of a write that does not land,
 * and it decides it from a `FailureKind`. This module's real job is producing the
 * right one, because that mapping is where an offline layer quietly loses data:
 *
 *   · call a network blip `rejected` and a valid custody event is thrown away
 *   · call a malformed payload `unreachable` and the queue retries it forever,
 *     with everything behind it (the queue is strictly ordered) waiting
 *   · call a revocation `server_error` and §10 never reaches the tablet
 *
 * src/sync/contract.ts fixes the status codes so this mapping can be exact rather
 * than heuristic.
 */

/** Where the endpoints live. Under /sync/, which both workers never cache. */
const ENDPOINTS = {
  daypack: "/sync/daypack",
  push: "/sync/push",
  pull: "/sync/pull",
} as const;

/**
 * How long a request may hang before it counts as unreachable.
 *
 * §2 gives the desk a one-second cold start and public/console/sw.js explains why
 * cache-first: "on a range floor the network is frequently present but useless — a
 * captive portal, a saturated uplink, a 4G cell that accepts the connection and
 * then stalls."
 *
 * A `fetch` against that cell does not fail. It waits, for as long as the platform
 * default allows, holding the head of a strictly ordered queue. Twelve seconds is
 * long enough for a real push over a bad GPRS link and short enough that a stalled
 * one is retried within the outbox's backoff rather than blocking the afternoon.
 */
const TIMEOUT_MS = 12_000;

export type SyncClientOptions = {
  /**
   * The device's bearer token. §3.1, §10 — see drizzle/0003_device_tokens.sql.
   *
   * Read from the device store at boot rather than passed per call, so that no
   * caller has to remember to attach it.
   */
  deviceToken: string;
  /**
   * Called when the server says this device is revoked.
   *
   * Not handled here, deliberately. §10's response is to destroy every local store
   * (src/offline/revoke.ts), which is irreversible, and a network module is the
   * wrong place to hold that authority — this reports the fact and the console
   * decides.
   */
  onRevoked: () => void;
  fetchImpl?: typeof fetch;
};

/** A fetch with a deadline, so a stalled connection fails instead of hanging. */
async function withTimeout(
  input: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether a 403 was a revocation.
 *
 * The body carries `revoked: true` (src/server/sync/http.ts). Read rather than
 * inferred from the status, because a proxy or a WAF can produce a 403 of its own,
 * and wiping a legitimate tablet because a captive portal refused a request would
 * be this system destroying the records it exists to keep.
 */
async function isRevocation(response: Response): Promise<boolean> {
  try {
    const body = (await response.clone().json()) as { revoked?: unknown };
    return body.revoked === true;
  } catch {
    return false;
  }
}

/**
 * Map an HTTP response onto the outbox's four failure kinds.
 *
 * The table in src/sync/contract.ts, in code.
 */
async function classify(
  response: Response,
  onRevoked: () => void,
): Promise<SendResult> {
  if (response.ok) return { ok: true };

  if (response.status === 401 || response.status === 403) {
    if (response.status === 403 && (await isRevocation(response))) {
      onRevoked();
    }
    /* Either way the queue is HELD, not quarantined: nothing about the record's
       contents is wrong, and counting this towards quarantine would park a whole
       day's work because a credential lapsed. */
    return { ok: false, failure: "unauthorised", message: await reason(response) };
  }

  /* 400 and 409: the server understood and refused. Final — the same bytes will be
     refused identically — so it is surfaced to an officer (§8.2). */
  if (response.status >= 400 && response.status < 500) {
    return { ok: false, failure: "rejected", message: await reason(response) };
  }

  return { ok: false, failure: "server_error", message: await reason(response) };
}

/** The sentence the server sent, for the desk's exception list. */
async function reason(response: Response): Promise<string> {
  try {
    const body = (await response.clone().json()) as { reason?: unknown };
    if (typeof body.reason === "string") return body.reason;
  } catch {
    /* Fall through to the status. */
  }
  return `The club's system answered ${response.status}.`;
}

/**
 * The `Sender` the outbox drains through.
 *
 * One record per request — see the note in src/sync/contract.ts on why this is not
 * a batch.
 */
export function createSender(options: SyncClientOptions): Sender {
  const fetchImpl = options.fetchImpl ?? fetch;

  return async (item: OutboxItem): Promise<SendResult> => {
    const body: PushRequest = {
      id: item.id,
      operation: item.operation as PushRequest["operation"],
      payload: item.payload,
      deviceId: item.deviceId,
      actorStaffId: item.actorStaffId,
      /* §2: the device's own clock, recorded alongside the server's, never instead
         of it. `createdAt` is when the officer did the thing, which may be hours
         before this request. */
      clientRecordedAt: item.createdAt.toISOString(),
    };

    let response: Response;
    try {
      response = await withTimeout(
        ENDPOINTS.push,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${options.deviceToken}`,
          },
          body: JSON.stringify(body),
        },
        fetchImpl,
      );
    } catch (error) {
      /* No answer at all: offline, DNS failure, or the deadline above. Always
         retryable — this is the normal condition of a club whose power and
         internet are unreliable (§1.1). */
      return {
        ok: false,
        failure: "unreachable",
        message: error instanceof Error ? error.message : String(error),
      };
    }

    const result = await classify(response, options.onRevoked);

    if (result.ok) {
      /* `applied` and `duplicate` are both successes and the queue treats them
         identically. The distinction is read by the §8.5 run, not by this code. */
      const acknowledged = (await response.json()) as PushResponse;
      void acknowledged.outcome;
    }

    return result;
  };
}

/**
 * Ask the browser to deliver the queue when it next has a connection — even if the
 * desk has been closed by then. §2: "background sync where supported."
 *
 * The tag matches the one public/console/sw.js listens for. What that handler does
 * and, more importantly, what it deliberately does NOT do is documented there: it
 * delivers without recording delivery, which §7's idempotency makes free and which
 * keeps the queue's state machine in one place.
 *
 * Safe to call after every enqueue. Registering a tag that is already registered is
 * a no-op, so this does not need to know whether one is outstanding.
 *
 * Unsupported browsers — Safari and Firefox, at time of writing — get nothing, which
 * is what "where supported" means. On those the queue drains on the app's own timer
 * and on `online`, so an officer with the desk open is unaffected; only the
 * closed-tab case is lost, and it is lost quietly rather than reported as a failure.
 */
export async function requestBackgroundSync(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.ready;

    /* `sync` is not in the DOM typings for ServiceWorkerRegistration, because the
       Background Sync API is not on a standards track every vendor has adopted.
       Feature-detected rather than asserted, so an unsupported browser takes the
       false branch instead of throwing. */
    const sync = (
      registration as ServiceWorkerRegistration & {
        sync?: { register: (tag: string) => Promise<void> };
      }
    ).sync;

    if (!sync) return false;

    await sync.register("armory-outbox");
    return true;
  } catch {
    /* Permission denied, or a registration that is not ready. The timer covers it. */
    return false;
  }
}

export type Enrolment =
  | {
      kind: "enrolled";
      deviceId: string;
      label: string;
      surface: "desk" | "lane";
      pack: DayPack;
      etag: string;
    }
  /** The token matched no device, or matched a revoked one. */
  | { kind: "refused"; reason: string }
  | { kind: "unavailable"; reason: string };

/**
 * Exchange a device token for an identity and a first day pack.
 *
 * §3.1 requires the desk to load "only on a registered, unrevoked device", and this
 * is how a tablet becomes one from its own side. A founder registers the device on
 * the server, which issues a token once; the token is typed in here, and the server
 * answers with the device's id, label and surface along with the pack.
 *
 * ===========================================================================
 * WHY THE TOKEN IS TYPED AND NOT CARRIED IN A LINK
 *
 * The obvious enrolment is a one-time URL — `/console?enrol=…` — which the founder
 * opens on the tablet. It is also the one thing src/server/sync/device-auth.ts
 * refuses to accept for the same credential: a token in a URL is written to browser
 * history, every proxy log and every access log between the tablet and the database,
 * and this one opens the whole roster. Building the enrolment path around exactly
 * that would undo the reason the auth header is header-only.
 *
 * So it is typed once, on a device that will then hold it for months. The cost is
 * one minute of a founder's time at setup, which is the correct place to spend it.
 */
export async function enrolDevice(options: {
  deviceToken: string;
  fetchImpl?: typeof fetch;
}): Promise<Enrolment> {
  const fetchImpl = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await withTimeout(
      ENDPOINTS.daypack,
      {
        method: "GET",
        headers: { authorization: `Bearer ${options.deviceToken}` },
      },
      fetchImpl,
    );
  } catch (error) {
    return {
      kind: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  if (response.status === 401 || response.status === 403) {
    /* Both refusals get the same sentence. §3.1 is the club's rule and the person
       holding the tablet cannot tell an unknown token from a revoked one — nor
       should the response help anyone work out which. */
    return {
      kind: "refused",
      reason:
        "This code was not accepted. A founder can issue a new one from the " +
        "owner dashboard.",
    };
  }

  if (!response.ok) {
    return { kind: "unavailable", reason: await reason(response) };
  }

  const body = (await response.json()) as DayPackResponse;

  return {
    kind: "enrolled",
    deviceId: body.device.id,
    label: body.device.label,
    surface: body.device.surface,
    pack: body.pack,
    etag: body.etag,
  };
}

export type PackRefresh =
  /** A newer pack. Store it and re-index. */
  | { kind: "pack"; pack: DayPack; etag: string }
  /** The server has nothing newer. */
  | { kind: "unchanged" }
  /** §10. The caller wipes. */
  | { kind: "revoked" }
  /** No answer, or a server problem. Keep working from what is on disk. */
  | { kind: "unavailable"; reason: string };

/**
 * Fetch the day pack, conditionally.
 *
 * `etag` is the fingerprint of the pack already on the device. Supplying it turns
 * §8.1's "refreshed continuously while online" into a request that usually
 * transfers no body at all — which matters on a saturated uplink, and matters more
 * because this response is the largest and most sensitive one the system sends.
 */
export async function refreshDayPack(
  options: SyncClientOptions & { etag: string | null },
): Promise<PackRefresh> {
  const fetchImpl = options.fetchImpl ?? fetch;

  /* Pull when there is something to compare against, daypack on a cold device. */
  const endpoint = options.etag ? ENDPOINTS.pull : ENDPOINTS.daypack;

  let response: Response;
  try {
    response = await withTimeout(
      endpoint,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${options.deviceToken}`,
          ...(options.etag ? { "if-none-match": options.etag } : {}),
        },
      },
      fetchImpl,
    );
  } catch (error) {
    return {
      kind: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  if (response.status === 403 && (await isRevocation(response))) {
    options.onRevoked();
    return { kind: "revoked" };
  }

  if (!response.ok) {
    return { kind: "unavailable", reason: await reason(response) };
  }

  const body = (await response.json()) as DayPackResponse | PullResponse;

  if ("changed" in body) {
    return body.changed
      ? { kind: "pack", pack: body.pack, etag: body.etag }
      : { kind: "unchanged" };
  }

  return { kind: "pack", pack: body.pack, etag: body.etag };
}
