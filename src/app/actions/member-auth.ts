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

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isArmoryDatabaseConfigured } from "@/db/armory/client";
import { isDatabaseConfigured } from "@/db/client";
import { env } from "@/server/env";
import { mailer } from "@/server/mailer";
import { routes, site } from "@/lib/site";
import { log } from "@/server/log";
import { LIMITS, clientKey, rateLimit } from "@/server/rate-limit";
import {
  MIN_PASSWORD_LENGTH,
  setMemberPassword,
  verifyMemberPassword,
} from "@/server/armory/member-password";
import {
  redeemEmailVerification,
  requestEmailVerification,
} from "@/server/armory/email-verification";
import { resolveArmoryMember } from "@/server/armory/member-session";
import { safeReturnTo, startSession } from "@/server/auth/session";
import type {
  ChangePasswordState,
  ConfirmEmailState,
  EmailFormState,
  MemberSignInState,
} from "@/lib/member-auth-state";

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

/* ============================================================================
   PROVING AN EMAIL ADDRESS

   Why a member needs this at all: with no address on file there is exactly one
   way in and no way back if the password is lost. The rules are in
   src/server/armory/email-verification.ts; this file is the form handler and
   the mail.
   ========================================================================= */

export async function sendEmailVerification(
  _previous: EmailFormState,
  form: FormData,
): Promise<EmailFormState> {
  const resolution = await resolveArmoryMember();

  if (resolution.state !== "member") {
    return { ok: false, error: "Sign in to add an email address." };
  }

  /**
   * Rate limited on the caller, like every other endpoint that can cause an
   * email to be sent. This one is authenticated, so the abuse it invites is not
   * enumeration but volume — a signed-in member is still a way to make the club
   * send mail to arbitrary addresses, and a bounce rate earned that way is paid
   * for by every other message the club sends.
   */
  const headerList = await headers();
  const limited = rateLimit(
    clientKey(new Request("https://armory.invalid/portal/account", { headers: headerList }), "email-verify"),
    LIMITS.emailVerification,
  );

  if (!limited.allowed) {
    return {
      ok: false,
      error: `Too many attempts. Try again in ${Math.ceil(limited.retryAfter / 60)} minutes.`,
    };
  }

  const requested = await requestEmailVerification({
    personId: resolution.member.personId,
    email: String(form.get("email") ?? ""),
    now: new Date(),
  });

  if (!requested.ok) return { ok: false, error: requested.reason };

  const url = new URL(routes.verifyEmail, env.origin ?? "http://localhost:3000");
  url.searchParams.set("token", requested.rawToken);

  const sent = await mailer.send({
    to: requested.email,
    subject: `Confirm your email for ${site.legalName}`,
    text: [
      "Confirm this address and you can use it to sign in, and to get back in",
      "if you ever forget your password. The link works once and expires in an",
      "hour.",
      "",
      url.toString(),
      "",
      "If you did not ask for this, you can ignore this email. Nothing changes",
      "until the link is opened, and it will expire on its own.",
      "",
      site.legalName,
    ].join("\n"),
    tag: "email-verification",
  });

  if (!sent.ok) {
    /* Reported rather than swallowed. The member is about to go and look in a
       mailbox, and the one thing worse than "we could not send it" is silence
       followed by nothing arriving. */
    log.error("email verification send failed", { error: sent.error });
    return { ok: false, error: "We could not send that email. Please try again in a moment." };
  }

  log.info("email verification sent", { personId: resolution.member.personId });

  return { ok: true, sentTo: requested.email };
}

/**
 * Redeem the link.
 *
 * A POST behind a button, for the reason src/app/actions/auth.ts gives about
 * sign-in links: a GET that redeems itself is redeemed by mail scanners, link
 * previewers and the browser's prefetcher before the member ever clicks, and
 * the member is then told their brand-new link has already been used.
 *
 * It grants NO session. Whoever holds the link proves the mailbox and nothing
 * else — which is what makes it safe for this to be reachable without being
 * signed in, and necessary that it is: a member adding a first address may well
 * open it on a device the club has never seen.
 */
export async function confirmEmail(
  _previous: ConfirmEmailState,
  form: FormData,
): Promise<ConfirmEmailState> {
  const token = String(form.get("token") ?? "");

  if (!token) return { error: "That link is incomplete." };

  /* Guarded like every other action that touches the database. This one needs
     it more than most: it is the only member-record write reachable WITHOUT a
     session, so there is no `resolveArmoryMember()` upstream to have already
     failed politely, and an unconfigured database would otherwise reach the
     member as the error boundary rather than as a sentence. */
  if (!isDatabaseConfigured() || !isArmoryDatabaseConfigured()) {
    return { error: "That is not available just now. Please try again shortly." };
  }

  const redeemed = await redeemEmailVerification({ rawToken: token, now: new Date() });

  if (!redeemed.ok) return { error: redeemed.reason };

  log.info("email verified", { personId: redeemed.personId });

  redirect(routes.emailConfirmed);
}
