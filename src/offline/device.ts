import type { DeviceSurface } from "@/domain/enums";

/**
 * DEVICE TRUST — may this tablet run the console, right now, offline?
 *
 * Build Specification §3.1: "Desk and lane surfaces load only on a registered,
 * unrevoked device."
 * §10: "A lost or stolen tablet can be revoked server-side, and its cached day
 * pack rendered unusable on next launch."
 *
 * ===========================================================================
 * THE TENSION THIS MODULE EXISTS TO RESOLVE
 *
 * Those two sentences pull against §8, and the pull is the whole problem:
 *
 *   · §8 says the desk works fully offline. So the console cannot ask the
 *     server for permission before it opens — that would make the entire
 *     offline guarantee conditional on the thing that is missing.
 *   · §10 says revocation reaches a stolen tablet. But a thief's first move,
 *     deliberate or not, is that the device stops talking to the server. A
 *     revocation the device never hears is not a revocation.
 *
 * If the console trusts its cached registration indefinitely, a stolen tablet
 * holding a full day pack — the roster, home addresses, the firearm register —
 * works forever, in someone else's hands, and the club's only recourse is that
 * it happens to reconnect.
 *
 * If the console demands a live check, an ordinary Thursday power cut closes
 * the range, which is the failure §1.1 is written to prevent.
 *
 * ===========================================================================
 * THE RESOLUTION: A BOUNDED OFFLINE GRACE PERIOD
 *
 * A registration is trusted while offline, but only for as long as an outage
 * plausibly lasts. Past that, the console stops — not because the device is
 * known to be stolen, but because the club can no longer tell.
 *
 * Seven days is the bound, and the reasoning is about which mistake is
 * cheaper. §1.1 says power and internet are unreliable, so the window has to
 * absorb a serious outage: a multi-day grid failure with a generator running
 * and no uplink is an ordinary Nigerian fortnight and the range should keep
 * operating through it. But a tablet that has not reached the server in a
 * week, in a club whose devices sit in one building with staff who notice, is
 * likelier to be missing than to be in a blackout.
 *
 * Wrong in the safe direction: refusing a legitimate device costs the club one
 * phone call and a re-registration at the desk. Trusting a stolen one costs it
 * every member's address.
 *
 * The clock is `lastVerifiedAt` — the last time the SERVER confirmed this
 * device — not `registeredAt`. A device that checks in daily never approaches
 * the bound.
 *
 * ===========================================================================
 * THE BOUND IS MEASURED AGAINST A CLOCK THE THIEF CONTROLS
 *
 * Everything above depends on elapsed time, and the only clock available with
 * no network is the tablet's own — which is a setting, on a device that by
 * assumption is in someone else's hands. Measuring staleness against
 * `new Date()` alone means the seven-day bound is defeated by opening the
 * settings app and moving the date backwards, and the whole module reduces to
 * the indefinite trust it was written to avoid.
 *
 * So the device keeps a HIGH-WATER MARK: the furthest-forward wall-clock time
 * it has ever seen, persisted locally and advanced on every launch. Staleness is
 * measured against whichever is later, the current clock or that mark.
 *
 * It is not a real monotonic clock and does not pretend to be. What it
 * guarantees is narrower and sufficient: time cannot be made to run BACKWARDS
 * across a restart. A thief who winds the date back gets no more grace than was
 * left at the moment the device was last legitimately used, because the mark
 * written by that launch is still on disk and still counts.
 */

export type DeviceRegistration = {
  /** Server-issued. Matches armory.devices.id. */
  deviceId: string;
  label: string;
  surface: DeviceSurface;
  registeredAt: Date;
  /**
   * The last moment the server confirmed this device was registered and
   * unrevoked. Refreshed on every successful sync.
   */
  lastVerifiedAt: Date;
};

/** What the server said, when it could be reached. */
export type ServerVerdict =
  | { reachable: true; revoked: boolean }
  | { reachable: false };

/**
 * The device's own sense of time, and how far it can be trusted.
 *
 * A pair rather than a bare `Date` because on this surface the current time is
 * untrusted input, and a function that takes `now: Date` invites every caller to
 * pass `new Date()` and forget that it is a setting. See the high-water note in
 * the header.
 */
export type DeviceClock = {
  /** What the device believes the time is. */
  now: Date;
  /**
   * The furthest-forward time this device has ever observed. Persisted locally,
   * advanced on every launch. Null only on the very first launch after install.
   */
  highWaterAt: Date | null;
};

/**
 * The later of the current clock and the high-water mark.
 *
 * This is the only time value the staleness bound is allowed to see.
 */
export function effectiveNow(clock: DeviceClock): Date {
  if (!clock.highWaterAt) return clock.now;
  return clock.highWaterAt.getTime() > clock.now.getTime()
    ? clock.highWaterAt
    : clock.now;
}

export type TrustDecision =
  /** Open the console. */
  | { action: "allow"; staleDays: number; warning: string | null }
  /**
   * Destroy every local record and unregister. §10's "rendered unusable".
   * Returned when the server says revoked — the one unambiguous answer.
   */
  | { action: "wipe"; reason: string }
  /**
   * Do not open, but do not destroy either. The device may be perfectly
   * legitimate and simply cut off; wiping it would throw away a queued
   * afternoon of custody events that have not synced.
   */
  | { action: "refuse"; reason: string; remedy: string };

/** How long a registration is trusted without the server confirming it. */
export const OFFLINE_GRACE_DAYS = 7;

/** When to start telling the officer the device is drifting out of contact. */
export const OFFLINE_WARNING_DAYS = 4;

const DAY_MS = 86_400_000;

/**
 * Decide whether this device may open the console.
 *
 * Pure, for the same reason everything else in this system's decision layer
 * is: it runs at launch, on a tablet, possibly with no network, and it must be
 * testable without one.
 */
export function evaluateDeviceTrust(
  registration: DeviceRegistration | null,
  verdict: ServerVerdict,
  clock: DeviceClock,
): TrustDecision {
  if (!registration) {
    return {
      action: "refuse",
      reason: "This device is not registered.",
      remedy: "A founder can register it from the owner dashboard.",
    };
  }

  if (verdict.reachable) {
    if (verdict.revoked) {
      /* The only answer that justifies destroying local data. §10. */
      return {
        action: "wipe",
        reason: "This device has been revoked.",
      };
    }
    /* Confirmed live. The caller refreshes lastVerifiedAt. */
    return { action: "allow", staleDays: 0, warning: null };
  }

  /* Server unreachable: fall back to how long ago it last confirmed — measured
     against the high-water mark, not the raw clock. See the header. */
  const staleDays = Math.floor(
    (effectiveNow(clock).getTime() - registration.lastVerifiedAt.getTime()) /
      DAY_MS,
  );

  /**
   * Time still appears to run backwards even after the high-water mark: the
   * device was last verified later than anything it has ever seen.
   *
   * The legitimate cause is a tablet whose battery died and came back with a
   * bad date, on its first launch afterwards, before any mark existed. Locking
   * the desk over that would be a self-inflicted outage — §1.1's failure.
   *
   * So it is allowed, but not silently. An officer who is told the clock is
   * wrong can fix it in a minute; a desk that quietly grants itself unlimited
   * grace on a wrong clock is the §10 hole this module exists to close.
   */
  if (staleDays < 0) {
    return {
      action: "allow",
      staleDays: 0,
      warning:
        "This device's clock is wrong. Connect it to the internet so it can " +
        "correct itself.",
    };
  }

  if (staleDays >= OFFLINE_GRACE_DAYS) {
    return {
      action: "refuse",
      reason: `This device has not reached the club's system in ${staleDays} days.`,
      remedy: "Connect it to the internet once, and it will unlock itself.",
    };
  }

  const remaining = OFFLINE_GRACE_DAYS - staleDays;
  return {
    action: "allow",
    staleDays,
    warning:
      staleDays >= OFFLINE_WARNING_DAYS
        ? `This device has been offline for ${staleDays} days. It stops working in ${remaining}.`
        : null,
  };
}

/**
 * Whether a day pack is too old to run a session from.
 *
 * §8.1: the pack holds "today's and tomorrow's expected arrivals". A pack from
 * last week has the wrong arrivals, a stale roster and — the one that matters —
 * a firearm register that predates whatever has been issued since.
 *
 * Separate from device trust on purpose. A device can be legitimately
 * registered and holding data too old to be safe to work from, and those two
 * facts need different sentences at the desk.
 */
export function isDayPackUsable(
  pulledAt: Date | null,
  now: Date,
): { usable: boolean; line: string } {
  if (!pulledAt) {
    return {
      usable: false,
      line: "This device has not downloaded today's information yet.",
    };
  }

  const hours = Math.floor((now.getTime() - pulledAt.getTime()) / 3_600_000);

  /* 36 hours rather than 24: the pack deliberately covers today AND tomorrow
     (§8.1), so one pulled yesterday evening still holds today's arrivals. A
     24-hour bound would refuse a pack that is entirely correct. */
  if (hours >= 36) {
    return {
      usable: false,
      line: "This device's information is more than a day old.",
    };
  }

  if (hours >= 12) {
    return {
      usable: true,
      line: "Working from information downloaded earlier today.",
    };
  }

  return { usable: true, line: "Information is current." };
}
