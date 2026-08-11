/**
 * OUTBOX POLICY — what happens to a queued write that does not land.
 *
 * Build Specification §8.4:
 *
 *   "A durable queue in IndexedDB. Ordered, replayed on reconnection,
 *    exponential backoff, poison-message quarantine after repeated failure
 *    with an alert to the founder.
 *
 *    Depth and last-sync time are visible on the desk at all times. Silent
 *    queues are how data is lost.
 *
 *    The queue survives tab close, app close, device restart and power loss."
 *
 * ===========================================================================
 * WHY THIS IS A SEPARATE, PURE MODULE
 *
 * The same reasoning as src/domain: the rules that decide whether a custody
 * event is retried, parked or surfaced are the rules that decide whether the
 * club loses a record. They should be testable by calling a function, not by
 * mocking IndexedDB, throttling a network and hoping.
 *
 * So this file contains no storage and no I/O. It answers one question —
 * given an attempt that failed this way, what should become of the item? —
 * and outbox.ts applies the answer.
 *
 * ===========================================================================
 * THE RULE THAT MATTERS MOST: NOTHING IS EVER SILENTLY DISCARDED
 *
 * §8.2, on server-authoritative writes: "Rejections surface to the officer —
 * never silently discarded." §8.4: "Silent queues are how data is lost."
 *
 * There is therefore no terminal state in this policy that means "give up and
 * forget". An item either succeeds, or it ends in a state a human is shown:
 * `quarantined` (we could not deliver it) or `rejected` (the server refused
 * it). Both are visible on the desk and both keep the payload, because the
 * payload may be the only remaining record that a firearm left the rack.
 */

/**
 * Why an attempt failed.
 *
 * The distinction between these is the whole of the policy. Retrying a
 * validation error a thousand times is how a queue becomes permanently stuck
 * behind one bad item; quarantining a network blip is how a club loses an
 * afternoon of scores because the wifi dropped.
 */
export type FailureKind =
  /**
   * No network, DNS failure, timeout, 502/503/504. The request never reached
   * a decision. Always retryable — this is the normal condition of a club
   * whose power and internet are unreliable (§1.1).
   */
  | "unreachable"
  /**
   * The server answered 5xx. It reached a decision and the decision broke.
   * Retryable, but it counts towards quarantine: a deterministic server error
   * will not fix itself, and a queue that hammers it forever is worse than one
   * that parks the item and tells someone.
   */
  | "server_error"
  /**
   * The server understood and refused — 4xx other than auth. A malformed
   * payload, a constraint violation, a rule the device could not know about.
   * Retrying is pointless: the same bytes will be refused identically.
   *
   * §8.2 requires this to reach the officer rather than vanish.
   */
  | "rejected"
  /**
   * 401/403. The device session expired, or the device was revoked (§10).
   * Not the item's fault, and not retryable until someone signs in — so the
   * item is held, the queue pauses, and nothing is quarantined for a reason
   * that has nothing to do with its contents.
   */
  | "unauthorised";

export type OutboxState =
  /** Waiting to be sent. The normal state. */
  | "pending"
  /** Handed to the network; outcome unknown. */
  | "inflight"
  /** Delivered and acknowledged. Eligible for pruning. */
  | "done"
  /** Delivery failed repeatedly. Visible to staff, alerts the founder. */
  | "quarantined"
  /** The server refused it. Visible to staff. §8.2. */
  | "rejected"
  /** Waiting for a valid session before anything is retried. */
  | "held";

/**
 * Attempts before an item is parked.
 *
 * Six, with the backoff below, spans roughly twenty minutes of trying. That is
 * chosen against the actual failure this system expects: a generator
 * changeover or a router reboot, which resolves in minutes. Anything still
 * failing after twenty minutes is not a blip, and a range officer would rather
 * be told than have the queue keep quietly retrying while they lock up.
 */
export const MAX_ATTEMPTS = 6;

/** Backoff bounds. */
export const BASE_DELAY_MS = 1_000;
export const MAX_DELAY_MS = 5 * 60_000;

/**
 * Exponential backoff with full jitter.
 *
 * Jitter matters more here than it looks. When the club's internet returns,
 * every queued item on every device becomes eligible at the same instant — the
 * desk tablet, two lane tablets, and whatever the founder has open. Without
 * jitter they retry in lockstep, in bursts, against a link that has just come
 * back up and is the least able to take it.
 *
 * Full jitter (a uniform draw from [0, delay]) rather than half jitter,
 * because the population is small: with four devices, spreading them as widely
 * as possible matters more than keeping the mean retry interval tight.
 *
 * `random` is injectable so the tests can assert the bounds deterministically.
 */
export function backoffDelayMs(
  attempts: number,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** attempts, MAX_DELAY_MS);
  return Math.floor(random() * exponential);
}

export type OutboxDecision = {
  state: OutboxState;
  /** When the item next becomes eligible. Null when it is not retrying. */
  nextAttemptAt: Date | null;
  /** Whether the founder is alerted. §8.4 requires it on quarantine. */
  alertFounder: boolean;
  /** One line, for the desk. Never a code, never a stack trace. */
  note: string;
};

/**
 * What to do with an item whose attempt just failed.
 *
 * `attempts` is the count INCLUDING the one that just failed.
 */
export function decideAfterFailure(
  failure: FailureKind,
  attempts: number,
  now: Date,
  random: () => number = Math.random,
): OutboxDecision {
  switch (failure) {
    /* Not the item's fault and not fixable by retrying it. Hold it — and
       every item behind it — until a session exists again. Counting this
       towards quarantine would park a whole day's work because a PIN
       timed out. */
    case "unauthorised":
      return {
        state: "held",
        nextAttemptAt: null,
        alertFounder: false,
        note: "Waiting for a range officer to unlock this device.",
      };

    /* §8.2: surfaced, never discarded. The payload is kept. */
    case "rejected":
      return {
        state: "rejected",
        nextAttemptAt: null,
        alertFounder: true,
        note: "The server would not accept this record. A person needs to look at it.",
      };

    case "unreachable":
    case "server_error": {
      if (attempts >= MAX_ATTEMPTS) {
        return {
          state: "quarantined",
          nextAttemptAt: null,
          alertFounder: true,
          note:
            failure === "unreachable"
              ? `Could not reach the server after ${attempts} attempts.`
              : `The server failed on this record ${attempts} times.`,
        };
      }

      return {
        state: "pending",
        nextAttemptAt: new Date(now.getTime() + backoffDelayMs(attempts, random)),
        alertFounder: false,
        note:
          failure === "unreachable"
            ? "Waiting for a connection."
            : "The server is having trouble. Trying again shortly.",
      };
    }
  }
}

/**
 * Whether an item is eligible to be sent right now.
 *
 * `held` is deliberately not eligible: it is released by a successful unlock,
 * not by the clock, because time passing does not produce a session.
 */
export function isEligible(
  item: { state: OutboxState; nextAttemptAt: Date | null },
  now: Date,
): boolean {
  if (item.state !== "pending") return false;
  if (item.nextAttemptAt === null) return true;
  return item.nextAttemptAt.getTime() <= now.getTime();
}

/**
 * Whether an item still needs a human.
 *
 * Drives the desk's queue indicator. §8.4: "Depth and last-sync time are
 * visible on the desk at all times."
 */
export const needsAttention = (state: OutboxState): boolean =>
  state === "quarantined" || state === "rejected";

/**
 * How the desk should describe the queue in one line.
 *
 * §6.4 puts sync queue depth on the end-of-day screen, and §8.4 wants it
 * visible at all times. The wording distinguishes "behind" from "broken",
 * because those call for completely different responses from an officer at
 * nine in the evening: one is waiting, the other is a phone call.
 */
export function queueSummary(counts: {
  pending: number;
  inflight: number;
  held: number;
  quarantined: number;
  rejected: number;
}): { tone: "clear" | "waiting" | "attention"; line: string } {
  const stuck = counts.quarantined + counts.rejected;
  if (stuck > 0) {
    return {
      tone: "attention",
      line:
        stuck === 1
          ? "1 record could not be sent. The founder has been told."
          : `${stuck} records could not be sent. The founder has been told.`,
    };
  }

  if (counts.held > 0) {
    return {
      tone: "attention",
      line: "This device needs unlocking before anything can be sent.",
    };
  }

  const waiting = counts.pending + counts.inflight;
  if (waiting > 0) {
    return {
      tone: "waiting",
      line:
        waiting === 1
          ? "1 record waiting to sync."
          : `${waiting} records waiting to sync.`,
    };
  }

  return { tone: "clear", line: "Everything is synced." };
}

/**
 * How stale the last successful sync is, in words.
 *
 * Returned as a sentence rather than a timestamp because the number a range
 * officer needs is "how far behind am I", and a clock time makes them do the
 * subtraction themselves while someone waits at the desk.
 */
export function lastSyncLine(lastSyncAt: Date | null, now: Date): string {
  if (!lastSyncAt) return "Not synced on this device yet.";

  const minutes = Math.floor((now.getTime() - lastSyncAt.getTime()) / 60_000);
  if (minutes < 1) return "Synced just now.";
  if (minutes === 1) return "Synced a minute ago.";
  if (minutes < 60) return `Synced ${minutes} minutes ago.`;

  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "Synced an hour ago.";
  if (hours < 24) return `Synced ${hours} hours ago.`;

  const days = Math.floor(hours / 24);
  return days === 1 ? "Synced yesterday." : `Synced ${days} days ago.`;
}
