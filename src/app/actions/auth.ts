"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { generateToken, normaliseEmail, AUTH_REQUEST_LIMIT } from "@/server/auth/tokens";
import {
  findOrCreateMember,
  issueAuthToken,
  redeemAuthToken,
} from "@/server/auth/repository";
import { endSession, safeReturnTo, startSession } from "@/server/auth/session";
import { isDatabaseConfigured } from "@/db/client";
import { mailer } from "@/server/mailer";
import { clientKey, rateLimit } from "@/server/rate-limit";
import { isHoneypotTripped } from "@/server/validation";
import { log, redactEmail } from "@/server/log";
import { env } from "@/server/env";
import { routes, site } from "@/lib/site";
import type { SignInState } from "@/lib/sign-in-state";

/**
 * SIGN-IN — request a link.
 *
 * ===========================================================================
 * THE RESPONSE IS IDENTICAL WHETHER OR NOT THE ACCOUNT EXISTS
 *
 * This is a private club. "That address isn't registered" confirms, to anyone
 * who asks, whether a named person is a member — and the Brief describes the
 * membership list as an attractive target in its own right. Someone could walk
 * a list of Abuja names through this form and learn who belongs.
 *
 * So: every request returns the same confirmation, takes a token row either
 * way, and only actually sends mail when there is somewhere to send it. The
 * member sees "check your email"; a prober learns nothing.
 *
 * The corollary is that a genuine typo also shows success. That is the right
 * trade — the recovery is to try again, and the check page says so plainly.
 * ===========================================================================
 */

export async function requestSignInLink(
  _previous: SignInState,
  form: FormData,
): Promise<SignInState> {
  const headerList = await headers();
  const pseudoRequest = new Request("https://internal.invalid", { headers: headerList });

  /* Rate limited per client. Generous enough that a member mistyping their
     address twice is not locked out; tight enough that this is not a free
     email-sending service. */
  const limited = rateLimit(clientKey(pseudoRequest, "sign-in"), AUTH_REQUEST_LIMIT);
  if (!limited.allowed) {
    return {
      ok: false,
      error: "That is a few too many attempts. Please wait a few minutes and try again.",
    };
  }

  if (isHoneypotTripped(form, "surname")) {
    log.info("honeypot tripped", { scope: "sign-in" });
    /* Looks like success to the bot. */
    redirect(routes.signInCheck);
  }

  const email = normaliseEmail(String(form.get("email") ?? ""));
  const next = safeReturnTo(String(form.get("next") ?? "") || null);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return { ok: false, error: "Please check the email address." };
  }

  if (!isDatabaseConfigured()) {
    log.error("sign-in unavailable: DATABASE_URL not set");
    return {
      ok: false,
      error:
        "Member sign-in is not available yet. Please contact the club and we will help directly.",
    };
  }

  const raw = generateToken();

  try {
    await issueAuthToken(raw, email);
    await sendSignInEmail(email, raw, next);
  } catch (error) {
    log.error("sign-in link failed", {
      email: redactEmail(email),
      error: error instanceof Error ? error.message : String(error),
    });
    /* A real failure IS reported — unlike a non-existent account, which is
       silent. The member would otherwise wait for an email that never comes. */
    return {
      ok: false,
      error: "We could not send your sign-in link. Please try again in a moment.",
    };
  }

  log.info("sign-in link sent", { email: redactEmail(email) });
  redirect(routes.signInCheck);
}

async function sendSignInEmail(email: string, rawToken: string, next: string) {
  const url = new URL(routes.signInVerify, env.origin ?? "http://localhost:3000");
  url.searchParams.set("token", rawToken);
  if (next !== routes.portal) url.searchParams.set("next", next);

  const result = await mailer.send({
    to: email,
    subject: `Sign in to ${site.legalName}`,
    text: [
      "Use the link below to sign in. It works once and expires in fifteen minutes.",
      "",
      url.toString(),
      "",
      "If you did not ask to sign in, you can ignore this email — nobody can",
      "use the link without opening it, and it will expire on its own.",
      "",
      site.legalName,
    ].join("\n"),
    tag: "sign-in",
  });

  if (!result.ok) throw new Error(result.error);
}

/* ---------------------------------------------------------------------------
   COMPLETE SIGN-IN — the POST half of the email link.

   ===========================================================================
   WHY THE LINK DOES NOT SIGN YOU IN ON ITS OWN

   A sign-in link is a GET, and GETs get followed by things that are not the
   member: corporate email security scanners, link-preview bots, antivirus
   gateways, and the browser's own prefetcher. Any of them hitting a
   self-redeeming URL burns a single-use token before the member has clicked,
   producing the classic "my sign-in link says it's already been used" report —
   which is unfixable from the member's side and looks like the club's fault.

   So the link lands on a page that does nothing, and redemption happens on an
   explicit POST. Scanners do not submit forms. The cost is one click; the
   alternative is a support burden that falls hardest on members with corporate
   email, who are exactly this club's audience.
   ===========================================================================
   -------------------------------------------------------------------------- */

export type VerifyState = { error?: string };

export async function completeSignIn(
  _previous: VerifyState,
  form: FormData,
): Promise<VerifyState> {
  const token = String(form.get("token") ?? "");
  const next = safeReturnTo(String(form.get("next") ?? "") || null);

  if (!token) return { error: "That sign-in link is incomplete." };

  if (!isDatabaseConfigured()) {
    return { error: "Member sign-in is not available yet." };
  }

  const redeemed = await redeemAuthToken(token);
  if (!redeemed.ok) {
    /* One message for expired, already-used and never-existed. Distinguishing
       them tells someone holding a stale link which it is. */
    return {
      error:
        "That link has expired or has already been used. Sign-in links work once and last fifteen minutes — please request a new one.",
    };
  }

  const member = await findOrCreateMember(redeemed.email);
  await startSession(member.id);

  log.info("signed in", { email: redactEmail(redeemed.email) });
  redirect(next);
}

/* ---------------------------------------------------------------------------
   SIGN OUT
   -------------------------------------------------------------------------- */

export async function signOut(): Promise<void> {
  await endSession();
  redirect(routes.home);
}
