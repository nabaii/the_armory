/**
 * THE OFFICER ON SHIFT, OFFLINE — §10, and the debt M1 recorded.
 *
 *   §10: "No shared logins. Every staff action attributable to a named person.
 *         DEVICE-BOUND SESSIONS WITH A SHORT LOCAL UNLOCK. Shared accounts
 *         destroy the attribution the custody log exists to provide."
 *
 * docs/M1_offline_acceptance.md names this as M5's job and states the problem
 * precisely enough to be worth quoting in full, because the shape of this file
 * is dictated by it:
 *
 *   "Check-ins are attributed to a device, not to a person… `checked_in_by_staff_id`
 *    is written as null because M1 has no officer sign-in… The real fix is the
 *    device-bound session with a short local unlock (§10), which needs to work
 *    OFFLINE — so it cannot verify a PIN against the server, and the day pack
 *    deliberately does not carry `staff_users.pin_hash` (a pack holding every
 *    officer's PIN hash moves staff authentication onto a stealable tablet).
 *    The shape that resolves it: the officer signs in once while online, and
 *    the local unlock re-verifies only THAT ONE OFFICER's stored verifier for
 *    the length of the shift. M5, with the desk."
 *
 * ===========================================================================
 * WHY THE VERIFIER IS DERIVED IN THE BROWSER AND NEVER SENT ANYWHERE
 *
 * The naive offline unlock ships `staff_users.pin_hash` to the device. The day
 * pack deliberately refuses to, and the reason is in that quotation: a pack
 * carrying every officer's PIN hash turns a stolen tablet into an offline
 * cracking target for the whole staff list, against a six-digit secret.
 *
 * So nothing derived from anyone's PIN travels from the server. Instead, at the
 * moment of a successful ONLINE unlock — when the officer has just typed their
 * PIN and the server has confirmed it — the browser derives its own verifier
 * from that PIN, with its own random salt, and keeps it locally.
 *
 * What that buys, precisely:
 *
 *   · One officer, not all of them. A stolen tablet exposes a verifier for
 *     whoever last signed in on it, and nobody else.
 *   · Bounded in time. The verifier expires with the shift and only an online
 *     unlock creates another.
 *   · Useless elsewhere. It is salted per device and per unlock, so it does not
 *     match `staff_users.pin_hash` and cannot be replayed against the server.
 *
 * It is still a six-digit secret in a hash on a tablet in a public building.
 * That is not free, and the mitigation is the attempt limit below plus §10's
 * device revocation — which wipes this database along with everything else.
 *
 * ===========================================================================
 * PBKDF2 RATHER THAN scrypt, AND ONLY HERE
 *
 * The server uses scrypt (src/server/armory/staff-session.ts) because it is
 * memory-hard and Node has it. The browser does not: WebCrypto offers PBKDF2 and
 * nothing better, and shipping a WASM scrypt into the desk bundle would cost
 * more of §2's one-second cold start than it buys against an attacker who
 * already has the tablet.
 *
 * The iteration count is high enough to make six digits cost real time per
 * guess, and the attempt limit is what actually bounds it.
 */

/** §10's "short". A shift, after which only an online unlock will do. */
export const SHIFT_HOURS = 12;

/**
 * Wrong PINs before the local unlock refuses until the next online sign-in.
 *
 * Lower than the server's five (staff-session.ts), deliberately. The server can
 * lock an account for fifteen minutes and let a mistyping officer try again;
 * offline there is nobody to appeal to, so the failure has to be recoverable a
 * different way — by reconnecting. Three is enough for cold hands and few enough
 * that a stolen tablet yields little.
 */
export const MAX_LOCAL_ATTEMPTS = 3;

const PBKDF2_ITERATIONS = 310_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

/** What the device keeps between an online unlock and the end of the shift. */
export type OfficerShift = {
  readonly staffUserId: string;
  readonly displayName: string;
  readonly role: string;
  /** Random per unlock. Not a secret; it exists to make the verifier unique. */
  readonly salt: string;
  /** PBKDF2 of the PIN under that salt, hex. Never leaves the device. */
  readonly verifier: string;
  readonly unlockedAt: Date;
  readonly expiresAt: Date;
  /** Consecutive wrong PINs since the last success. */
  readonly failedAttempts: number;
};

/* ============================================================================
   DERIVATION
   ========================================================================= */

const toHex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

const fromHex = (hex: string): Uint8Array =>
  new Uint8Array(
    (hex.match(/.{1,2}/g) ?? []).map((byte) => Number.parseInt(byte, 16)),
  );

async function derive(pin: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    key,
    KEY_BITS,
  );

  return toHex(bits);
}

/**
 * Begin a shift, after the server has confirmed this PIN.
 *
 * MUST only be called on a successful online unlock. Calling it on an unverified
 * PIN would let anyone holding the tablet mint a shift for any officer whose id
 * they could name, which is the shared login §10 forbids wearing a disguise.
 */
export async function beginShift(input: {
  readonly staffUserId: string;
  readonly displayName: string;
  readonly role: string;
  readonly pin: string;
  readonly now: Date;
}): Promise<OfficerShift> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));

  return {
    staffUserId: input.staffUserId,
    displayName: input.displayName,
    role: input.role,
    salt: toHex(salt.buffer as ArrayBuffer),
    verifier: await derive(input.pin, salt),
    unlockedAt: input.now,
    expiresAt: new Date(input.now.getTime() + SHIFT_HOURS * 3_600_000),
    failedAttempts: 0,
  };
}

/* ============================================================================
   THE LOCAL UNLOCK
   ========================================================================= */

export type UnlockOutcome =
  | { readonly ok: true; readonly shift: OfficerShift }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly remedy: string | null;
      /** The shift as it now stands — attempts incremented, or null if spent. */
      readonly shift: OfficerShift | null;
    };

/**
 * Re-verify an officer against the shift this device is holding.
 *
 * Returns the updated shift so the caller persists the attempt count. An
 * in-memory counter would reset when the officer force-quits the desk, which is
 * both the obvious thing to try and the first thing an attacker would do.
 */
export async function unlockLocally(
  shift: OfficerShift | null,
  pin: string,
  now: Date,
): Promise<UnlockOutcome> {
  if (!shift) {
    return {
      ok: false,
      reason: "No officer has signed in on this tablet.",
      remedy: "Sign in once while the tablet has a connection.",
      shift: null,
    };
  }

  if (now.getTime() >= shift.expiresAt.getTime()) {
    /* Expired shifts are discarded rather than kept for an attempt. Keeping one
       would leave a verifier on disk indefinitely for an officer who is no
       longer working, which is the opposite of §10's "short". */
    return {
      ok: false,
      reason: "This shift has ended.",
      remedy: "Sign in again while the tablet has a connection.",
      shift: null,
    };
  }

  if (shift.failedAttempts >= MAX_LOCAL_ATTEMPTS) {
    return {
      ok: false,
      reason: "Too many wrong PINs on this tablet.",
      remedy: "Sign in again while the tablet has a connection.",
      shift,
    };
  }

  const attempt = await derive(pin, fromHex(shift.salt));

  if (!constantTimeEquals(attempt, shift.verifier)) {
    const failedAttempts = shift.failedAttempts + 1;
    const remaining = MAX_LOCAL_ATTEMPTS - failedAttempts;

    return {
      ok: false,
      reason: "That PIN was not recognised.",
      remedy:
        remaining > 0
          ? `${remaining} ${remaining === 1 ? "try" : "tries"} left before you need a connection.`
          : "Sign in again while the tablet has a connection.",
      shift: { ...shift, failedAttempts },
    };
  }

  return { ok: true, shift: { ...shift, failedAttempts: 0 } };
}

/**
 * Whether a shift is usable right now.
 *
 * Read at boot to decide whether the desk shows Today or the unlock screen. It
 * does NOT verify the PIN — an unexpired shift on disk means an officer already
 * unlocked and has not been away long enough to matter. Demanding a PIN between
 * every arrival would put §1.2's fifteen-second budget out of reach and teach
 * the club to leave the tablet unlocked, which is worse than either.
 */
export const shiftIsLive = (shift: OfficerShift | null, now: Date): boolean =>
  shift !== null &&
  now.getTime() < shift.expiresAt.getTime() &&
  shift.failedAttempts < MAX_LOCAL_ATTEMPTS;

/**
 * Who to attribute a write to, or null.
 *
 * The one function the rest of the desk calls. `buildCheckIn` already takes an
 * `actorStaffId` and M1 passed null into it; this is what fills it in, and the
 * same value goes on every custody event, ammunition issue and score the desk
 * writes from here on.
 */
export const actorFor = (shift: OfficerShift | null, now: Date): string | null =>
  shiftIsLive(shift, now) ? (shift as OfficerShift).staffUserId : null;

/**
 * Compare two hex digests without leaking where they differ.
 *
 * `timingSafeEqual` is Node's and is not available in a browser. The comparison
 * below is constant-time over equal-length inputs, which is the case that
 * matters — both sides are fixed-width hex from the same derivation.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}
