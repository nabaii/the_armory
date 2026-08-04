"use server";

/**
 * FLOW B — FIRST-VISIT BOOKING WITH DEPOSIT.
 *
 * Target from spec §4: "complete in under three minutes on a mobile device."
 * That budget is why this is one form and one payment redirect, with no account
 * creation, no party names, and no optional steps.
 *
 * ---------------------------------------------------------------------------
 * ORDER OF OPERATIONS, AND WHY IT IS THIS ORDER
 *
 *   1. Guard      — rate limit, honeypot, bot check.
 *   2. Readiness  — refuse unless price, deposit AND a published refund policy
 *                   version all exist. Taking a deposit against terms that do
 *                   not exist is the specific thing the Brief warns against.
 *   3. Validate   — including that the policy version the visitor was SHOWN
 *                   matches the one now in force.
 *   4. Re-derive  — the slot is looked up from the generator, never trusted from
 *                   the form. A posted slot id that is not currently bookable is
 *                   rejected, so a stale tab cannot book a lapsed session.
 *   5. HOLD       — capacity is reserved before the visitor leaves for Paystack,
 *                   with a short expiry. Without this, two people in the payment
 *                   gap can both buy the last place.
 *   6. Initialise — server-side, with the amount computed here. A
 *                   client-supplied amount is a client-controlled price.
 *   7. Redirect   — to Paystack. Money is confirmed later by the signed webhook,
 *                   never by the visitor returning to a success URL.
 *
 * If initialisation fails after the hold is taken, the hold is RELEASED before
 * returning the error. Otherwise a Paystack outage would silently consume the
 * session's capacity for twenty minutes at a time.
 * ---------------------------------------------------------------------------
 */

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { validateBookingRequest, isHoneypotTripped, type FieldErrors } from "@/server/validation";
import { bookingConfig, bookingIsLive } from "@/content/booking";
import { findSlot } from "@/server/slots";
import { bookingStore, HOLD_TTL_MS } from "@/server/booking-store";
import { initializeTransaction, nairaToKobo } from "@/server/paystack";
import { LIMITS, clientKey, rateLimit } from "@/server/rate-limit";
import { verifyTurnstile } from "@/server/turnstile";
import { isConfigured, env } from "@/server/env";
import { log, redactEmail } from "@/server/log";
import { routes } from "@/lib/site";

export type BookingState = {
  ok: boolean;
  errors?: FieldErrors;
  formError?: string;
};

export const emptyBookingState: BookingState = { ok: false };

export async function requestBooking(
  _previous: BookingState,
  form: FormData,
): Promise<BookingState> {
  const headerList = await headers();
  const pseudoRequest = new Request("https://internal.invalid", {
    headers: headerList,
  });

  /* 1. Guard ------------------------------------------------------------- */
  const limited = rateLimit(clientKey(pseudoRequest, "booking"), LIMITS.booking);
  if (!limited.allowed) {
    return {
      ok: false,
      formError:
        "That is a few too many attempts in a short time. Please wait a moment, or call us to book.",
    };
  }

  if (isHoneypotTripped(form, "organisation")) {
    log.info("honeypot tripped", { scope: "booking" });
    return { ok: true };
  }

  const turnstile = await verifyTurnstile(
    typeof form.get("cf-turnstile-response") === "string"
      ? (form.get("cf-turnstile-response") as string)
      : null,
    headerList.get("cf-connecting-ip"),
  );
  if (!turnstile.ok) {
    return {
      ok: false,
      formError: "We could not verify that you are a person. Please reload and try again.",
    };
  }

  /* 2. Readiness --------------------------------------------------------- */
  if (!bookingIsLive()) {
    log.error("booking refused: pricing or refund policy not published");
    return {
      ok: false,
      formError:
        "Online booking is not open yet. Please call the club and we will arrange your visit directly.",
    };
  }
  if (!isConfigured.payments()) {
    log.error("booking refused: payments not configured");
    return {
      ok: false,
      formError:
        "We cannot take payment through the website at the moment. Please call the club to book.",
    };
  }

  /* 3. Validate ---------------------------------------------------------- */
  const validated = validateBookingRequest(form, bookingConfig.policyVersion);
  if (!validated.ok) return { ok: false, errors: validated.errors };
  const request = validated.value;

  /* 4. Re-derive the slot. Never trust a posted slot id. ------------------ */
  const slot = findSlot(request.slotId);
  if (!slot) {
    return {
      ok: false,
      errors: {
        slotId:
          "That session is no longer available. Please choose another date and time.",
      },
    };
  }

  /* 5. Hold capacity BEFORE sending the visitor to pay. ------------------- */
  const reference = bookingReference();
  const hold = await bookingStore.hold(
    {
      reference,
      slotId: slot.id,
      partySize: request.partySize,
      name: request.name,
      email: request.email,
      phone: request.phone,
      policyVersion: request.policyVersion,
      expiresAt: Date.now() + HOLD_TTL_MS,
    },
    slot.capacity,
  );

  if (!hold.ok) {
    if (hold.reason === "slot-full") {
      return {
        ok: false,
        errors: {
          partySize:
            hold.remaining > 0
              ? `That session has ${hold.remaining} ${hold.remaining === 1 ? "place" : "places"} left. Please reduce your party or choose another time.`
              : "That session is now full. Please choose another date and time.",
        },
      };
    }
    return {
      ok: false,
      formError: "Something went wrong starting your booking. Please try again.",
    };
  }

  /* 6. Initialise the transaction. Amount computed here, never posted. ---- */
  const depositKobo = nairaToKobo(
    bookingConfig.pricing.depositNaira! * request.partySize,
  );

  const init = await initializeTransaction({
    email: request.email,
    amountKobo: depositKobo,
    reference,
    callbackUrl: absolute(`${routes.bookingConfirmed}?ref=${reference}`),
    metadata: {
      slotId: slot.id,
      slotLabel: slot.label,
      partySize: request.partySize,
      policyVersion: request.policyVersion,
      /* Staff-facing, shown in the Paystack dashboard against the transaction. */
      purpose: "First visit deposit",
    },
  });

  if (!init.ok) {
    /* Release the hold, or a gateway outage eats the session's capacity. */
    await bookingStore.release(reference);
    log.error("paystack initialise failed", {
      reference,
      email: redactEmail(request.email),
      error: init.error,
    });
    return {
      ok: false,
      formError:
        "We could not start the payment. Nothing has been charged. Please try again, or call us to book.",
    };
  }

  log.info("booking held, redirecting to payment", {
    reference,
    slotId: slot.id,
    partySize: request.partySize,
    depositKobo,
    email: redactEmail(request.email),
  });

  /* 7. Off to Paystack. */
  redirect(init.authorizationUrl);
}

/**
 * Booking reference, and the Paystack idempotency key.
 *
 * Human-quotable on a phone call, and unguessable enough that the confirmation
 * page cannot be enumerated — it is reachable with only `?ref=`, so a
 * sequential reference would let anyone page through other people's bookings.
 */
function bookingReference(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const random = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `ARM-${random}`;
}

function absolute(path: string): string {
  return env.origin ? new URL(path, env.origin).toString() : path;
}
