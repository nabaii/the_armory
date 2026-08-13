import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, isNull } from "drizzle-orm";
import { getArmoryDb, schema } from "@/db/armory/client";
import type { StaffRole } from "@/domain/enums";
import { uuidv7 } from "@/lib/uuidv7";
import { hashDeviceToken } from "@/server/sync/device-auth";

/**
 * THE STAFF SESSION — §10, and the thing every `actor_staff_id` column has been
 * waiting for.
 *
 *   §10: "No shared logins. Every staff action attributable to a named person.
 *         Device-bound sessions with a short local unlock. Shared accounts
 *         destroy the attribution the custody log exists to provide."
 *   §7:  "POST /auth/staff/unlock"
 *
 * ===========================================================================
 * WHY THIS ARRIVES AT M3 RATHER THAN AT M0
 *
 * It should have arrived earlier and docs/M1_offline_acceptance.md says so
 * plainly: check-ins recorded during M1 "name a tablet and honestly not a
 * human". That was survivable while the only write was a check-in.
 *
 * M3 makes it untenable. An admission decision is the action in this club that
 * most obviously belongs to a person — §3.1 gives `applications` a
 * `decided_by_staff_id` column, §5 requires "an explicit founder override" to
 * admit past the roster cap, and §12 requires that override to be "recorded".
 * None of those three sentences can be honoured by a system that cannot name
 * who decided.
 *
 * ===========================================================================
 * TWO FACTORS, NEITHER SUFFICIENT
 *
 * §10 asks for "device-bound sessions with a short local unlock", which is a
 * precise description of two factors:
 *
 *   the device token (0003)  proves WHICH TABLET  — something the club issued
 *   the PIN                  proves WHICH OFFICER — something the officer knows
 *
 * A PIN alone would be a four-to-six digit password, which is not a credential.
 * A device alone is the shared login §10 forbids by name — every officer
 * holding that tablet would be the same actor in the audit log, which is
 * exactly the failure the custody log exists to prevent.
 *
 * So `unlockStaffSession` requires both, and the session it issues is bound to
 * the device: revoking the tablet (§10) cascades the sessions away with it.
 *
 * ===========================================================================
 * THE PIN HASH
 *
 * scrypt, from node:crypto. The schema comment on `staff_users.pin_hash` asks
 * for "a memory-hard KDF and a per-user salt", and the reason is stated there:
 * "a four-to-six digit PIN has so little entropy that a fast hash would be
 * trivially reversed from a database dump."
 *
 * Note the deliberate departure from src/server/sync/device-auth.ts, which uses
 * Web Crypto specifically so it runs unchanged in an edge runtime. This cannot:
 * scrypt is Node-only. That is acceptable here and would not be there, because
 * a PIN is verified in one place — a request that is already touching Postgres
 * — while a device token is verified on every /sync/* call from the range floor.
 *
 * A million guesses is not many, so the KDF is not the whole defence. The
 * throttle below is.
 */

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/** Deliberately slow. Tuned for a desk unlock, not for a hot path. */
const SCRYPT_KEY_BYTES = 64;
const SALT_BYTES = 16;

/**
 * How long a session stands. §10 says "short".
 *
 * A shift, not a fortnight: long enough that an officer is not re-entering a PIN
 * between shooters and short enough that a tablet left in a bag overnight is not
 * still signed in as them in the morning.
 */
const SESSION_HOURS = 12;

/**
 * The throttle. Five wrong PINs and the account locks for fifteen minutes.
 *
 * Five because a range officer with cold hands mistypes, and a lockout that
 * triggers on ordinary human error is a lockout that gets designed around — the
 * predictable workaround being one PIN everybody knows, which is the shared
 * login §10 forbids. Fifteen minutes turns a million guesses into decades
 * without turning a fat-fingered Tuesday into a phone call to the founder.
 */
const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

/* ============================================================================
   HASHING
   ========================================================================= */

/**
 * Hash a PIN for storage. Format: `scrypt:<salt hex>:<key hex>`.
 *
 * Self-describing so the algorithm can be changed later without guessing what
 * produced an existing row — a stored hash that does not say what made it is a
 * migration nobody can perform safely.
 */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(pin, salt, SCRYPT_KEY_BYTES);
  return `scrypt:${salt.toString("hex")}:${key.toString("hex")}`;
}

/**
 * Verify a PIN against a stored hash.
 *
 * Constant-time comparison. The timing signal from a byte-by-byte compare is
 * small but the search space here is a million, and a million guesses is exactly
 * the scale at which a small signal stops being theoretical.
 */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [algorithm, saltHex, keyHex] = stored.split(":");
  if (algorithm !== "scrypt" || !saltHex || !keyHex) return false;

  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(pin, Buffer.from(saltHex, "hex"), expected.length);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/* ============================================================================
   THE UNLOCK
   ========================================================================= */

export type StaffIdentity = {
  readonly staffUserId: string;
  readonly personId: string;
  readonly displayName: string;
  readonly role: StaffRole;
  readonly deviceId: string;
};

export type UnlockResult =
  | {
      readonly ok: true;
      /** Plaintext, returned once. Only its hash is stored. */
      readonly token: string;
      readonly expiresAt: Date;
      readonly staff: StaffIdentity;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Exchange a PIN for a session on an already-authenticated device.
 *
 * The caller must have authenticated the DEVICE first — `authenticateDevice` in
 * src/server/sync/device-auth.ts — and pass the device it resolved. This
 * function will not look one up, so there is no path by which a PIN alone
 * produces a session.
 */
export async function unlockStaffSession(input: {
  readonly deviceId: string;
  readonly staffUserId: string;
  readonly pin: string;
  readonly now: Date;
}): Promise<UnlockResult> {
  const db = getArmoryDb();

  const [staff] = await db
    .select({
      id: schema.staffUsers.id,
      personId: schema.staffUsers.personId,
      role: schema.staffUsers.role,
      active: schema.staffUsers.active,
      pinHash: schema.staffUsers.pinHash,
      pinFailedCount: schema.staffUsers.pinFailedCount,
      pinLockedUntil: schema.staffUsers.pinLockedUntil,
      firstName: schema.people.firstName,
      lastName: schema.people.lastName,
    })
    .from(schema.staffUsers)
    .innerJoin(schema.people, eq(schema.people.id, schema.staffUsers.personId))
    .where(eq(schema.staffUsers.id, input.staffUserId))
    .limit(1);

  /* One sentence for "no such officer", "not active" and "no PIN set". The
     unlock screen lists the officers on this device, so an attacker already
     knows who exists; what they must not learn is which of them is a viable
     target — an account with no PIN set is worth attacking differently from one
     that is merely locked. */
  const unusable = {
    ok: false as const,
    reason: "That PIN was not recognised on this device.",
  };

  if (!staff || !staff.active || !staff.pinHash) return unusable;

  if (staff.pinLockedUntil && staff.pinLockedUntil > input.now) {
    const minutes = Math.ceil(
      (staff.pinLockedUntil.getTime() - input.now.getTime()) / 60_000,
    );
    /* This one DOES say what is wrong, unlike the case above. An officer locked
       out by their own mistyping needs to know to wait rather than to keep
       trying — and by this point the attacker has already learned the account
       exists, so there is nothing left to conceal. */
    return {
      ok: false,
      reason: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or ask the founder to reset it.`,
    };
  }

  const correct = await verifyPin(input.pin, staff.pinHash);

  if (!correct) {
    const failed = staff.pinFailedCount + 1;
    const locked = failed >= MAX_PIN_ATTEMPTS;

    await db
      .update(schema.staffUsers)
      .set({
        pinFailedCount: locked ? 0 : failed,
        pinLockedUntil: locked
          ? new Date(input.now.getTime() + LOCKOUT_MINUTES * 60_000)
          : staff.pinLockedUntil,
        updatedAt: input.now,
      })
      .where(eq(schema.staffUsers.id, staff.id));

    return unusable;
  }

  /* A device revoked between authentication and unlock. Cheap to check and the
     window is real: the founder revokes a tablet precisely when someone is
     holding it. */
  const [device] = await db
    .select({ revokedAt: schema.devices.revokedAt })
    .from(schema.devices)
    .where(eq(schema.devices.id, input.deviceId))
    .limit(1);

  if (!device || device.revokedAt) {
    return {
      ok: false,
      reason: "This device has been signed out by the club.",
    };
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(input.now.getTime() + SESSION_HOURS * 3_600_000);

  await db.transaction(async (tx) => {
    /* One session per officer per device. Unlocking again replaces the previous
       session rather than accumulating them — an officer who unlocks each
       morning would otherwise leave a month of live credentials behind. */
    await tx
      .update(schema.staffSessions)
      .set({ endedAt: input.now })
      .where(
        and(
          eq(schema.staffSessions.staffUserId, staff.id),
          eq(schema.staffSessions.deviceId, input.deviceId),
          isNull(schema.staffSessions.endedAt),
        ),
      );

    await tx.insert(schema.staffSessions).values({
      id: uuidv7(),
      staffUserId: staff.id,
      deviceId: input.deviceId,
      tokenHash: await hashDeviceToken(token),
      expiresAt,
    });

    await tx
      .update(schema.staffUsers)
      .set({ pinFailedCount: 0, pinLockedUntil: null, updatedAt: input.now })
      .where(eq(schema.staffUsers.id, staff.id));
  });

  return {
    ok: true,
    token,
    expiresAt,
    staff: {
      staffUserId: staff.id,
      personId: staff.personId,
      displayName: `${staff.firstName} ${staff.lastName}`,
      role: staff.role,
      deviceId: input.deviceId,
    },
  };
}

/* ============================================================================
   RESOLVING A SESSION
   ========================================================================= */

/**
 * Identify the officer behind a request, or null.
 *
 * Null rather than a thrown error, because the caller decides what an
 * unattributed request means. A /sync/push from a tablet mid-shift is still
 * accepted with a null actor — the M1 debt, still being paid down — while an
 * admission decision is refused outright by `requireStaff` below.
 */
export async function resolveStaffSession(
  token: string | null,
  now: Date,
): Promise<StaffIdentity | null> {
  if (!token) return null;

  const db = getArmoryDb();
  const tokenHash = await hashDeviceToken(token);

  const [row] = await db
    .select({
      staffUserId: schema.staffSessions.staffUserId,
      deviceId: schema.staffSessions.deviceId,
      expiresAt: schema.staffSessions.expiresAt,
      endedAt: schema.staffSessions.endedAt,
      personId: schema.staffUsers.personId,
      role: schema.staffUsers.role,
      active: schema.staffUsers.active,
      revokedAt: schema.devices.revokedAt,
      firstName: schema.people.firstName,
      lastName: schema.people.lastName,
    })
    .from(schema.staffSessions)
    .innerJoin(
      schema.staffUsers,
      eq(schema.staffUsers.id, schema.staffSessions.staffUserId),
    )
    .innerJoin(schema.people, eq(schema.people.id, schema.staffUsers.personId))
    .innerJoin(schema.devices, eq(schema.devices.id, schema.staffSessions.deviceId))
    .where(eq(schema.staffSessions.tokenHash, tokenHash))
    .limit(1);

  if (!row) return null;
  if (row.endedAt) return null;
  if (row.expiresAt <= now) return null;
  /* Checked live rather than trusted to the cascade. A revoked device's sessions
     are deleted by the foreign key, but only when the row is actually deleted —
     revocation sets `revoked_at` and leaves the row in place, precisely so a
     stolen tablet can still authenticate and be told to wipe itself. */
  if (row.revokedAt) return null;
  if (!row.active) return null;

  return {
    staffUserId: row.staffUserId,
    personId: row.personId,
    displayName: `${row.firstName} ${row.lastName}`,
    role: row.role,
    deviceId: row.deviceId,
  };
}

/** End one session. The officer signing out at the end of a shift. */
export async function endStaffSession(token: string, now: Date): Promise<void> {
  const db = getArmoryDb();
  await db
    .update(schema.staffSessions)
    .set({ endedAt: now })
    .where(eq(schema.staffSessions.tokenHash, await hashDeviceToken(token)));
}

/**
 * End every session for a device. Called when the founder revokes it (§10).
 *
 * Belt and braces alongside the cascade, because revocation does not delete the
 * device row — see `resolveStaffSession`. Without this, a revoked tablet's
 * sessions would remain technically live in the table, and the only thing
 * refusing them would be a single condition in one function.
 */
export async function endSessionsForDevice(
  deviceId: string,
  now: Date,
): Promise<void> {
  const db = getArmoryDb();
  await db
    .update(schema.staffSessions)
    .set({ endedAt: now })
    .where(
      and(
        eq(schema.staffSessions.deviceId, deviceId),
        isNull(schema.staffSessions.endedAt),
      ),
    );
}
