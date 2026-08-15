import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

/**
 * THE PASSWORD KDF — one implementation, two callers.
 *
 * Staff PINs (§10's "short local unlock") and member passwords both need a
 * memory-hard hash with a per-user salt, and this is it. It was written first
 * for PINs in src/server/armory/staff-session.ts and moved here unchanged when
 * the member password login arrived, because two scrypt implementations in one
 * codebase is two sets of parameters that will eventually disagree — and the
 * one that drifts is always the one nobody is looking at.
 *
 * `hashPin` and `verifyPin` remain exported from staff-session.ts as aliases,
 * so nothing that already imported them had to change.
 *
 * ===========================================================================
 * scrypt, FROM node:crypto, AND THE DELIBERATE DEPARTURE
 *
 * The schema comment on `staff_users.pin_hash` asks for "a memory-hard KDF and
 * a per-user salt", and states why: "a four-to-six digit PIN has so little
 * entropy that a fast hash would be trivially reversed from a database dump."
 * A member's password is longer and has more entropy, and the same argument
 * applies with less force but in the same direction.
 *
 * Note the departure from src/server/sync/device-auth.ts, which uses Web Crypto
 * specifically so it runs unchanged in an edge runtime. This cannot: scrypt is
 * Node-only. That is acceptable here and would not be there, because a
 * credential is verified in one place — a request already touching Postgres —
 * while a device token is verified on every /sync/* call from the range floor.
 *
 * ===========================================================================
 * THE KDF IS NOT THE WHOLE DEFENCE, AND WAS NEVER MEANT TO BE
 *
 * A million guesses is not many. The throttle at the call site is what turns a
 * feasible search into an infeasible one — `unlockStaffSession` for PINs and
 * `verifyMemberPassword` for passwords, both of which lock an account after a
 * small number of failures. A KDF alone protects a stolen database; it does
 * nothing about an attacker who can simply keep asking.
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
 * Hash a secret for storage. Format: `scrypt:<salt hex>:<key hex>`.
 *
 * Self-describing so the algorithm can be changed later without guessing what
 * produced an existing row — a stored hash that does not say what made it is a
 * migration nobody can perform safely.
 */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(secret, salt, SCRYPT_KEY_BYTES);
  return `scrypt:${salt.toString("hex")}:${key.toString("hex")}`;
}

/**
 * Verify a secret against a stored hash.
 *
 * Constant-time comparison. The timing signal from a byte-by-byte compare is
 * small, and the search space for a six-digit PIN is a million — which is
 * exactly the scale at which a small signal stops being theoretical.
 *
 * Returns false rather than throwing on a malformed stored value. A row whose
 * hash cannot be parsed is a row nobody can authenticate against, and that is
 * the safe reading: an exception here would turn a corrupt column into a 500 on
 * a sign-in form and tell an attacker they had found something interesting.
 */
export async function verifySecret(
  secret: string,
  stored: string,
): Promise<boolean> {
  const [algorithm, saltHex, keyHex] = stored.split(":");
  if (algorithm !== "scrypt" || !saltHex || !keyHex) return false;

  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(secret, Buffer.from(saltHex, "hex"), expected.length);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
