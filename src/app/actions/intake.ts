"use server";

/**
 * INTAKE SERVER ACTIONS — Flow A, the group enquiry, and the Leagues waitlist.
 *
 * ---------------------------------------------------------------------------
 * WHY SERVER ACTIONS RATHER THAN API ROUTES
 *
 * Spec §5 asks forms for "inline validation, clear error states, visible
 * progress". A plain `POST` to a route handler cannot deliver that without
 * JavaScript: the only way back to the page is a redirect, which loses both the
 * field errors and everything the visitor typed.
 *
 * Server actions return field-level errors to the same render AND degrade
 * correctly — without JavaScript the browser posts the form, the action runs,
 * and the page re-renders with the errors in place. Nothing the visitor typed is
 * lost either way. On a Nigerian mobile-first audience that matters: the form
 * must work before the bundle has parsed.
 *
 * The Paystack webhook stays a route handler, because it is a machine endpoint
 * called by a third party.
 * ---------------------------------------------------------------------------
 */

import { redirect } from "next/navigation";
import {
  validateApplication,
  validateGroupEnquiry,
  validateWaitlist,
  isHoneypotTripped,
} from "@/server/validation";
import type { IntakeState } from "@/lib/intake-state";
import { deliver, sendApplicantConfirmation } from "@/server/intake";
import { canAcceptSubmissions, env } from "@/server/env";
import { verifyTurnstile } from "@/server/turnstile";
import { LIMITS, clientKey, rateLimit } from "@/server/rate-limit";
import { log } from "@/server/log";
import { routes } from "@/lib/site";

/* The state every intake form renders from is in @/lib/intake-state — a
   `"use server"` file may export only async functions. */

/* ---------------------------------------------------------------------------
   Shared preamble: rate limit, honeypot, bot check, delivery readiness.
   -------------------------------------------------------------------------- */

async function guard(
  form: FormData,
  {
    scope,
    limits,
    honeypotField,
  }: {
    scope: string;
    limits: { limit: number; windowMs: number };
    honeypotField: string;
  },
): Promise<IntakeState | null> {
  /* Server actions do not hand us the Request, so headers come from next/headers. */
  const { headers } = await import("next/headers");
  const headerList = await headers();
  const pseudoRequest = new Request("https://internal.invalid", {
    headers: headerList,
  });

  const limited = rateLimit(clientKey(pseudoRequest, scope), limits);
  if (!limited.allowed) {
    log.warn("rate limited", { scope, retryAfter: limited.retryAfter });
    return {
      ok: false,
      formError:
        "That is a few too many attempts in a short time. Please wait a moment and try again, or call us.",
    };
  }

  /* Honeypot. Silently accepted from the bot's point of view — reporting the
     rejection teaches a scraper which field to leave alone next time. */
  if (isHoneypotTripped(form, honeypotField)) {
    log.info("honeypot tripped", { scope });
    return { ok: true };
  }

  const turnstile = await verifyTurnstile(
    typeof form.get("cf-turnstile-response") === "string"
      ? (form.get("cf-turnstile-response") as string)
      : null,
    headerList.get("cf-connecting-ip"),
  );
  if (!turnstile.ok) {
    log.warn("turnstile rejected", { scope, reason: turnstile.reason });
    return {
      ok: false,
      formError:
        "We could not verify that you are a person. Please reload the page and try again.",
    };
  }

  /* The durability precondition. If nothing downstream can store this, we must
     not take it — see the one rule in src/server/intake.ts. */
  if (!canAcceptSubmissions()) {
    log.error("submission refused: no durable destination configured", { scope });
    return {
      ok: false,
      formError:
        "We cannot take this through the website at the moment. Please call the club and we will handle it directly.",
    };
  }

  return null;
}

/* ===========================================================================
   FLOW A — MEMBERSHIP APPLICATION
   =========================================================================== */

export async function submitApplication(
  _previous: IntakeState,
  form: FormData,
): Promise<IntakeState> {
  const blocked = await guard(form, {
    scope: "application",
    limits: LIMITS.application,
    honeypotField: "website",
  });
  if (blocked) return blocked;

  const validated = validateApplication(form);
  if (!validated.ok) return { ok: false, errors: validated.errors };

  const application = validated.value;

  const outcome = await deliver({
    pipeline: "membership-application",
    label: "Membership application",
    contact: {
      name: application.name,
      email: application.email,
      phone: application.phone,
    },
    details: [
      ["Tier of interest", application.tier ?? "not specified"],
      ["Heard about us via", application.referral],
      ["Note", application.note ?? "—"],
    ],
    crmProperties: {
      armory_tier_interest: application.tier ?? "unspecified",
      armory_referral_source: application.referral,
      ...(application.note ? { armory_note: application.note } : {}),
    },
  });

  /* Never confirm what we did not capture. */
  if (!outcome.durable) {
    return {
      ok: false,
      formError:
        "Something went wrong at our end and your application was not saved. Please call the club rather than trying again — we do not want to lose it.",
    };
  }

  /* Best-effort, and deliberately not awaited into the durability decision. */
  await sendApplicantConfirmation({
    to: application.email,
    name: application.name,
    firstVisitUrl: absolute(routes.firstVisit),
  });

  redirect(routes.membershipReceived);
}

/* ===========================================================================
   GROUP & EVENT ENQUIRY — routed to bookings, never the membership pipeline.
   =========================================================================== */

export async function submitGroupEnquiry(
  _previous: IntakeState,
  form: FormData,
): Promise<IntakeState> {
  const blocked = await guard(form, {
    scope: "group-enquiry",
    limits: LIMITS.groupEnquiry,
    honeypotField: "fax",
  });
  if (blocked) return blocked;

  const validated = validateGroupEnquiry(form);
  if (!validated.ok) return { ok: false, errors: validated.errors };

  const enquiry = validated.value;

  const outcome = await deliver({
    pipeline: "group-enquiry",
    label: "Group & event enquiry",
    contact: { name: enquiry.name, email: enquiry.email, phone: enquiry.phone },
    details: [
      ["Party size", String(enquiry.partySize)],
      ["Visit type", enquiry.visitType],
      ["Note", enquiry.note ?? "—"],
    ],
    crmProperties: {
      armory_party_size: String(enquiry.partySize),
      armory_visit_type: enquiry.visitType,
    },
  });

  if (!outcome.durable) {
    return {
      ok: false,
      formError:
        "Something went wrong at our end and your enquiry was not saved. Please call the club rather than trying again.",
    };
  }

  redirect(routes.groupEnquiryReceived);
}

/* ===========================================================================
   LEAGUES WAITLIST — one field, plus attribution.

   A waitlist is personal data: a list of people interested in a private club.
   It goes through the same delivery path as an application, with the same
   durability guarantee. It is not an email field bolted onto a marketing page.
   =========================================================================== */

export async function joinWaitlist(
  _previous: IntakeState,
  form: FormData,
): Promise<IntakeState> {
  const blocked = await guard(form, {
    scope: "waitlist",
    limits: LIMITS.waitlist,
    honeypotField: "company",
  });
  if (blocked) return blocked;

  const validated = validateWaitlist(form);
  if (!validated.ok) return { ok: false, errors: validated.errors };

  const signup = validated.value;

  const outcome = await deliver({
    pipeline: "leagues-waitlist",
    label: "Leagues waitlist signup",
    /* No name is collected — one field, per spec §3. The email is the contact. */
    contact: { name: signup.email, email: signup.email },
    details: [["Source", signup.source]],
    crmProperties: {
      /* The stated success measure is the proportion of waitlist signups that
         convert to membership applications. That cannot be computed later
         without recording where each signup came from. */
      armory_waitlist_source: signup.source,
    },
  });

  if (!outcome.durable) {
    return {
      ok: false,
      formError: "We could not save that just now. Please try again shortly.",
    };
  }

  redirect(routes.waitlistJoined);
}

/** Absolute URL for email links. Falls back to a relative path if unset. */
function absolute(path: string): string {
  return env.origin ? new URL(path, env.origin).toString() : path;
}
