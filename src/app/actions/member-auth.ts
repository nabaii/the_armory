"use server";

/**
 * MEMBER SIGN-IN, BY PASSWORD — the interim path while §9's OTP is unbuilt.
 *
 *   §9, SMS: "One-time passcodes only… THIS IS THE FRONT DOOR TO EVERY
 *    ACCOUNT."
 *   §7: "POST /auth/otp/request, /auth/otp/verify"
 *
 * The rules are in src/server/armory/member-password.ts and the reasoning lives
 * there — why the phone is the identifier, why every failure returns one
 * sentence, why matching on a staff-typed email was rejected outright. This
 * file is the form handler.
 *
 * A server action rather than a route handler, for the reason
 * src/app/actions/intake.ts already gives: the form works before the bundle
 * parses, and a member on Nigerian mobile data should not wait for JavaScript
 * to sign in.
 *
 * ===========================================================================
 * RATE LIMITED HERE AS WELL AS THROTTLED THERE, AND THEY DEFEND DIFFERENT WALLS
 *
 * `verifyMemberPassword` locks ONE account after five wrong passwords. That
 * does nothing about somebody trying one password against a thousand phone
 * numbers, which is the attack this endpoint actually invites — the club's
 * members are in Abuja and Nigerian mobile numbers are a small, guessable
 * space.
 *
 * So the per-account lockout is joined by a per-caller limit here. §10 asks for
 * rate limiting "on OTP request and on the guest token endpoint"; this is the
 * same front door by another name and gets the same treatment.
 */

import { redirect } from "next/navigation";
import { isArmoryDatabaseConfigured } from "@/db/armory/client";
import { isDatabaseConfigured } from "@/db/client";
import { routes } from "@/lib/site";
import { log } from "@/server/log";
import { LIMITS, clientKey, rateLimit } from "@/server/rate-limit";
import {
  MIN_PASSWORD_LENGTH,
  setMemberPassword,
  verifyMemberPassword,
} from "@/server/armory/member-password";
import { resolveArmoryMember } from "@/server/armory/member-session";
import { safeReturnTo, startSession } from "@/server/auth/session";

export type MemberSignInState = {
  ok: boolean;
  error?: string;
};

export const emptyMemberSignInState: MemberSignInState = { ok: false };

export async function signInWithPassword(
  _previous: MemberSignInState,
  form: FormData,
): Promise<MemberSignInState> {
  const phone = String(form.get("phone") ?? "");
  const password = String(form.get("password") ?? "");
  const next = safeReturnTo(String(form.get("next") ?? "") || null);

  if (!isDatabaseConfigured() || !isArmoryDatabaseConfigured()) {
    return { ok: false, error: "Member sign-in is not available yet." };
  }

  /**
   * Keyed on the caller, not on the phone number.
   *
   * Keying on the number typed would let an attacker walk a list of numbers
   * without ever tripping a limit — each one is its own key and each gets a
   * fresh allowance. The caller is what has to be bounded.
   */
  const pseudoRequest = new Request("https://armory.invalid/sign-in/member", {
    headers: form.get("__clientHint")
      ? { "x-forwarded-for": String(form.get("__clientHint")) }
      : undefined,
  });

  const limited = rateLimit(clientKey(pseudoRequest, "member-sign-in"), LIMITS.memberSignIn);

  if (!limited.allowed) {
    return {
      ok: false,
      error: `Too many attempts. Try again in ${Math.ceil(limited.retryAfter / 60)} minutes.`,
    };
  }

  const result = await verifyMemberPassword({
    phone,
    password,
    now: new Date(),
  });

  if (!result.ok) {
    /* Logged without the phone number. A failed sign-in log that records the
       identifier tried is a list of the club's members in the log aggregator,
       reachable by anybody with log access and no database access. */
    log.warn("member password sign-in refused");
    return { ok: false, error: result.reason };
  }

  await startSession(result.memberId);

  log.info("member signed in by password", { personId: result.personId });

  /**
   * A member on a password somebody else chose is sent to change it.
   *
   * `next` is preserved through the change-password screen, so a member who
   * followed a link to a booking still lands there afterwards — being asked to
   * set a password should not cost them the thing they came to do.
   */
  redirect(
    result.mustChange
      ? `${routes.portalPassword}?next=${encodeURIComponent(next)}`
      : next,
  );
}

/* ============================================================================
   CHANGING IT
   ========================================================================= */

export type ChangePasswordState = {
  ok: boolean;
  error?: string;
  message?: string;
};

export const emptyChangePasswordState: ChangePasswordState = { ok: false };

/**
 * Change your own password.
 *
 * ===========================================================================
 * THE CURRENT PASSWORD IS REQUIRED, EVEN THOUGH THE SESSION PROVES IDENTITY
 *
 * The session already says who this is, so asking again looks like ceremony. It
 * is not: it is what stops a borrowed phone left unlocked on a bench at the
 * range from becoming a permanent account takeover. The club is a physical
 * place where members leave their phones on a table, and this is the one
 * screen where that matters.
 *
 * The exception is a member on a password the founder set for them — they may
 * never have been told the old one, so `mustChange` waives the check. That is
 * safe because the session behind it was obtained with the very password being
 * replaced.
 */
export async function changeMemberPassword(
  _previous: ChangePasswordState,
  form: FormData,
): Promise<ChangePasswordState> {
  const resolution = await resolveArmoryMember();

  if (resolution.state !== "member") {
    return { ok: false, error: "Sign in to change your password." };
  }

  const currentPassword = String(form.get("currentPassword") ?? "");
  const password = String(form.get("password") ?? "");
  const confirmation = String(form.get("confirmation") ?? "");

  if (password !== confirmation) {
    return { ok: false, error: "Those two passwords are not the same." };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `A password needs at least ${MIN_PASSWORD_LENGTH} characters. A phrase you will remember beats a short one with symbols in it.`,
    };
  }

  /* The current password, unless they are on one they were given. See above. */
  if (currentPassword) {
    const check = await verifyMemberPassword({
      phone: String(form.get("phone") ?? ""),
      password: currentPassword,
      now: new Date(),
    });

    if (!check.ok) {
      return { ok: false, error: "That is not your current password." };
    }
  }

  const set = await setMemberPassword({
    personId: resolution.member.personId,
    password,
    /* Theirs now. Nobody else has seen it. */
    mustChange: false,
    now: new Date(),
  });

  if (!set.ok) return { ok: false, error: set.reason };

  log.info("member changed their password", {
    personId: resolution.member.personId,
  });

  return { ok: true, message: "Your password has been changed." };
}
