import { randomBytes } from "node:crypto";
import {
  handleWrite,
  malformed,
  readWrite,
  requireStaff,
} from "@/server/armory/http";
import {
  revokeMemberPassword,
  setMemberPassword,
} from "@/server/armory/member-password";
import { applied, refused } from "@/server/armory/record";

/**
 * POST /api/people/:id/password — the club sets a member's first password.
 *
 * The interim credential has a chicken-and-egg problem that every password
 * system has and most solve badly: a member cannot set a first password without
 * already being able to prove who they are, and the thing that would prove it
 * is the password.
 *
 * §9's answer is an SMS passcode, and it is not built. This is the answer until
 * then, and it is deliberately the oldest one there is: a human who knows the
 * member hands them a secret, out of band, and the member changes it. The
 * member is asked to change it on first sign-in, because a password two people
 * know is not yet a credential.
 *
 * ===========================================================================
 * THE CLUB CHOOSES THE PASSWORD, NOT THE FOUNDER
 *
 * The route generates it. There is no way for a caller to supply one, and that
 * is the interesting decision here.
 *
 * A founder typing a password for a member types a memorable one, and a
 * memorable one chosen by somebody else is `Armory2026` for all hundred of
 * them. The system would then have a hundred accounts sharing one guessable
 * secret — which is the shared login §10 forbids for staff, arriving through
 * the member door instead.
 *
 * So the secret is from a CSPRNG, shown once, and never stored in readable
 * form. The founder reads it out or messages it; the member changes it within
 * a minute of using it.
 *
 * ===========================================================================
 * FOUNDER ONLY
 *
 * Issuing a credential for somebody else's membership is the ability to become
 * them — their bookings, their allowance, their account balance. §10 restricts
 * the licence scan to the founder for weaker reasons than this.
 */

export const dynamic = "force-dynamic";

/**
 * Long enough that the throttle is not the only thing standing between an
 * attacker and an account, short enough to read down a phone line.
 *
 * base32-ish alphabet, no vowels and no look-alikes: nothing that can be
 * misheard as something else, and no accidental words. A code read aloud in a
 * noisy range office is the actual delivery mechanism.
 */
const ALPHABET = "23456789BCDFGHJKMNPQRSTVWXZ";
const CODE_LENGTH = 12;

function generatePassword(): string {
  const bytes = randomBytes(CODE_LENGTH);

  /* Rejection-free modulo bias is not worth the complexity at this alphabet
     size: 256 % 27 leaves a bias under half a percent on a 12-character secret
     drawn from 27 symbols, which is ~57 bits either way. */
  const body = [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join("");

  /* Grouped for reading aloud. The hyphens are part of the password — they are
     what stop somebody transcribing twelve characters as eleven. */
  return `${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireStaff(request, { atLeast: "founder" });
  if ("response" in auth) return auth.response;

  const { id } = await context.params;

  const write = await readWrite(request);
  if ("response" in write) return write.response;

  const password = generatePassword();

  return handleWrite(
    {
      envelope: write.envelope,
      operation: "member.set_password",
      staff: auth.staff,
    },
    async () => {
      const result = await setMemberPassword({
        personId: id,
        password,
        /* Somebody else has seen it. The portal asks them to change it. */
        mustChange: true,
        now: new Date(),
      });

      if (!result.ok) {
        return refused({ code: "PASSWORD_NOT_SET", message: result.reason });
      }

      return applied(
        /**
         * The password is in the RESULT, which means it is in the write
         * receipt — `record()` stores a completed result so a replay can
         * reproduce it (§7).
         *
         * That is deliberate and it is the reason this endpoint generates a
         * fresh secret rather than accepting one. A retried request must hand
         * back the SAME password, or a founder who lost the response would
         * reset a member's credential by asking again — and the member, who is
         * standing in front of them, would be holding a code that no longer
         * works.
         *
         * The receipt is short-lived operational data in a table nobody
         * queries for content. The alternative — a fresh secret per delivery —
         * trades a real, everyday failure for a theoretical one.
         */
        { personId: id, password },
        [
          {
            action: "member.set_password",
            entityType: "person",
            entityId: id,
            /* The password is NOT in the audit row. `audit_log` is append-only
               and cannot be redacted (drizzle/0002), so a credential written
               there would outlive every reset and every erasure. */
            after: { issued: true },
          },
        ],
      );
    },
  );
}

/**
 * DELETE — take a member's password away.
 *
 * The other half, and the one that makes this switchable off: §9's OTP arriving
 * does not require a migration, only that these rows stop existing. A member
 * whose password is revoked can still sign in by email link; they simply cannot
 * use a password, which is the state every member starts in.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireStaff(request, { atLeast: "founder" });
  if ("response" in auth) return auth.response;

  const { id } = await context.params;

  const write = await readWrite(request);
  if ("response" in write) return write.response;

  return handleWrite(
    {
      envelope: write.envelope,
      operation: "member.revoke_password",
      staff: auth.staff,
    },
    async () => {
      await revokeMemberPassword(id);

      return applied({ personId: id }, [
        {
          action: "member.revoke_password",
          entityType: "person",
          entityId: id,
          after: { revoked: true },
        },
      ]);
    },
  );
}

/** Rejected: a caller-supplied password. See the header. */
export const PUT = () =>
  malformed("A password cannot be supplied. The club generates it.");
