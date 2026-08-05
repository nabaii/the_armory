/**
 * LEAGUE JOIN CODES.
 *
 * ===========================================================================
 * THESE ARE READ ALOUD, NOT COPY-PASTED
 *
 * "Friends form a league." The realistic way a fourth player joins is somebody
 * at the bar saying "it's ARMY-2K7" over the noise of a firing line, or writing
 * it on a napkin. That makes character ambiguity the dominant design problem —
 * not entropy, which is easy.
 *
 * So the alphabet is Crockford Base32: digits and uppercase letters with
 * I, L, O and U removed.
 *
 *   · I and L are indistinguishable from 1 in most sans faces, including
 *     Archivo. O is indistinguishable from 0.
 *   · U is excluded so a random code cannot spell something unfortunate, which
 *     matters when the code is printed on a card and handed to a member.
 *
 * On input, the excluded characters are FORGIVEN rather than rejected: someone
 * who types O for 0 or I for 1 gets in, because they read the code correctly
 * and typed what they saw. Rejecting them would be technically right and
 * practically useless.
 *
 * Entropy: 32^6 ≈ 1.07 billion. The code is not a secret — it is an
 * invitation, and a league is a private group of friends, not a vault. Guessing
 * one gets an attacker into somebody's air rifle league.
 * ===========================================================================
 */

/** Crockford Base32. No I, L, O or U. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const CODE_LENGTH = 6;

/** Rendered as `ABC-123`. The hyphen is presentation only. */
export function formatJoinCode(code: string): string {
  const clean = code.replace(/-/g, "");
  return `${clean.slice(0, 3)}-${clean.slice(3)}`;
}

/**
 * A new join code.
 *
 * Uses rejection sampling rather than `% ALPHABET.length`. With a 32-character
 * alphabet, 256 divides evenly so modulo would in fact be unbiased here — but
 * that property silently breaks the moment someone edits the alphabet, and a
 * biased code generator is invisible until it collides. Rejecting out-of-range
 * bytes is correct for any alphabet length.
 */
export function generateJoinCode(): string {
  const max = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let out = "";

  while (out.length < CODE_LENGTH) {
    const bytes = new Uint8Array(CODE_LENGTH);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (out.length === CODE_LENGTH) break;
      if (byte >= max) continue;
      out += ALPHABET[byte % ALPHABET.length];
    }
  }

  return out;
}

/**
 * Canonical form of a code the member typed.
 *
 * Forgives everything a person plausibly does with a code read aloud:
 * lowercase, spaces, the hyphen we printed, and the four confusable letters.
 *
 * Returns null when the result is not a valid code, so the caller has one
 * check rather than a sequence of them.
 */
export function normaliseJoinCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    /* Crockford's decoding rules: O reads as zero, I and L read as one. */
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");

  if (cleaned.length !== CODE_LENGTH) return null;
  for (const char of cleaned) {
    if (!ALPHABET.includes(char)) return null;
  }
  return cleaned;
}

/** Whether a string could be a join code at all. */
export const isValidJoinCode = (input: string): boolean =>
  normaliseJoinCode(input) !== null;
