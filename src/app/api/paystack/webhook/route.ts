/**
 * PAYSTACK WEBHOOK — the authoritative confirmation that money moved.
 *
 * Flow B step 5 (confirmation email) and step 6 (24-hour reminder) both hang off
 * this endpoint, because it is the only place the system learns a deposit was
 * actually paid. The visitor returning to the callback URL proves nothing except
 * that they can follow a redirect.
 *
 * ---------------------------------------------------------------------------
 * FOUR RULES, ALL LOAD-BEARING
 *
 * 1. VERIFY THE SIGNATURE ON THE RAW BODY. `request.text()` is read first and
 *    parsed only after verification. Parsing to JSON and re-serialising changes
 *    key order and whitespace, which breaks the HMAC — a subtle bug that makes
 *    every webhook look forged.
 *
 * 2. UNSIGNED OR BADLY SIGNED REQUESTS GET 401 AND CHANGE NOTHING. This endpoint
 *    confirms paid bookings. Without signature verification it is an open
 *    endpoint for creating them.
 *
 * 3. IDEMPOTENT. Paystack retries. `confirm` is set-once in the store, so a
 *    replayed `charge.success` neither double-counts capacity nor sends a second
 *    confirmation email.
 *
 * 4. ALWAYS RETURN 200 ONCE THE SIGNATURE IS VALID — even for events we ignore,
 *    and even if our own downstream work fails. A non-2xx makes Paystack retry
 *    with backoff and eventually disable the webhook; losing the endpoint is far
 *    worse than losing one confirmation email, which staff can resend. Genuine
 *    internal failures are logged at error level for alerting instead.
 * ---------------------------------------------------------------------------
 */

import { verifyWebhookSignature, parseEvent } from "@/server/paystack";
import { bookingStore } from "@/server/booking-store";
import { mailer } from "@/server/mailer";
import { env } from "@/server/env";
import { log, redactEmail } from "@/server/log";
import { bookingConfig } from "@/content/booking";
import { formatNaira } from "@/server/paystack";
import { routes, site } from "@/lib/site";

/** Never cached, never prerendered. */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  /* 1. Raw body first. Do not parse before verifying. */
  const rawBody = await request.text();
  const signature = request.headers.get("x-paystack-signature");

  const valid = await verifyWebhookSignature(rawBody, signature);
  if (!valid) {
    /* Deliberately terse. A verbose error tells a prober what to fix. */
    log.warn("paystack webhook rejected: bad signature", {
      hasSignature: Boolean(signature),
      bodyBytes: rawBody.length,
    });
    return new Response("Unauthorised", { status: 401 });
  }

  const event = parseEvent(rawBody);
  if (!event) {
    log.error("paystack webhook: signature valid but body unparseable");
    return ok();
  }

  if (event.event !== "charge.success") {
    /* Not an error. We simply do not act on refunds, transfers or disputes here
       — those are handled by staff against the refund policy. */
    log.info("paystack webhook ignored", { event: event.event });
    return ok();
  }

  const reference = event.data.reference;
  if (!reference) {
    log.error("paystack charge.success carried no reference");
    return ok();
  }

  if (event.data.status !== "success") {
    log.warn("charge.success with non-success status", {
      reference,
      status: event.data.status,
    });
    return ok();
  }

  const outcome = await bookingStore.confirm(reference, event.data.amount ?? 0);

  switch (outcome.status) {
    case "already-confirmed":
      /* Expected. Paystack retried. Nothing to do, deliberately. */
      log.info("webhook replay ignored", { reference });
      return ok();

    case "unknown-reference":
      /* Money taken against a reference we have no record of. Never silent:
         a real person paid and expects a visit. Alert loudly so staff can
         reconcile manually from the Paystack dashboard. */
      log.error("PAID BOOKING WITH NO HOLD — manual reconciliation required", {
        reference,
        amountKobo: event.data.amount ?? 0,
      });
      await alertStaff(
        "Paid booking with no matching hold",
        [
          `Reference: ${reference}`,
          `Amount: ${formatNaira(event.data.amount ?? 0)}`,
          "",
          "A deposit was paid but no held booking matches this reference.",
          "This usually means the hold expired, or the booking store was",
          "restarted between the hold and the payment.",
          "",
          "Reconcile from the Paystack dashboard and contact the customer.",
        ].join("\n"),
      );
      return ok();

    case "expired":
      log.error("booking hold expired before payment confirmed", { reference });
      return ok();

    case "confirmed": {
      const record = outcome.record;
      log.info("booking confirmed", {
        reference,
        slotId: record.slotId,
        partySize: record.partySize,
        amountKobo: record.amountKobo ?? 0,
        email: redactEmail(record.email),
        /* Recorded because a dispute must reference the terms actually shown. */
        policyVersion: record.policyVersion,
      });

      await sendBookingConfirmation(record);
      await notifyStaffOfBooking(record);
      return ok();
    }
  }
}

const ok = () =>
  new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/* ---------------------------------------------------------------------------
   FLOW B STEP 5 — "On-screen confirmation, email with what to expect, what to
   wear, where to arrive."

   The arrival detail is sent HERE rather than published on the site. Spec §3 and
   Brand Guidelines §7 forbid revealing approach routes and entry points
   publicly; a confirmed booking is a different context from a public page.
   -------------------------------------------------------------------------- */

async function sendBookingConfirmation(record: {
  reference: string;
  slotId: string;
  partySize: number;
  name: string;
  email: string;
  amountKobo?: number;
}) {
  const slotLabel = humaniseSlotId(record.slotId);

  const text = [
    `${record.name.split(" ")[0]},`,
    "",
    "Your first visit is booked.",
    "",
    `When:      ${slotLabel}`,
    `Party:     ${record.partySize} ${record.partySize === 1 ? "person" : "people"}`,
    `Reference: ${record.reference}`,
    ...(record.amountKobo
      ? [`Deposit:   ${formatNaira(record.amountKobo)} received`]
      : []),
    "",
    "WHAT TO EXPECT",
    "You will be met at reception and taken through a short briefing. A range",
    "officer stays with you for the whole session. Everything is provided —",
    "the rifle, ammunition, and eye and ear protection.",
    "",
    "WHAT TO WEAR",
    "Flat, closed shoes. Clothing you can stand still in, with nothing loose at",
    "the wrist. Long hair tied back. Bring nothing else.",
    "",
    "WHERE TO ARRIVE",
    `${site.legalName}, ${site.location}.`,
    "Please arrive fifteen minutes before your session.",
    "",
    "Bring someone who does not shoot if you like — the bar seating looks",
    "directly onto the firing line, so they have a seat and a clear view.",
    "",
    `Deposit terms: ${absolute(routes.refunds)}`,
    "",
    site.legalName,
  ].join("\n");

  const result = await mailer.send({
    to: record.email,
    subject: `Your first visit — ${slotLabel}`,
    text,
    tag: "booking-confirmation",
  });

  if (!result.ok) {
    /* The booking is confirmed and paid regardless. Alert so staff can resend
       rather than leaving the visitor without arrival details. */
    log.error("booking confirmation email failed", {
      reference: record.reference,
      email: redactEmail(record.email),
      error: result.error,
    });
    await alertStaff(
      "Booking confirmed but confirmation email failed",
      `Reference ${record.reference} for ${slotLabel}. Please contact the customer with arrival details.`,
    );
  }
}

async function notifyStaffOfBooking(record: {
  reference: string;
  slotId: string;
  partySize: number;
  name: string;
  email: string;
  phone: string;
  policyVersion: string;
}) {
  await alertStaff(
    `First visit booked — ${humaniseSlotId(record.slotId)}`,
    [
      `Reference:      ${record.reference}`,
      `When:           ${humaniseSlotId(record.slotId)}`,
      `Party size:     ${record.partySize}`,
      `Name:           ${record.name}`,
      `Email:          ${record.email}`,
      `Phone:          ${record.phone}`,
      `Policy version: ${record.policyVersion}`,
      "",
      `Session length: ${bookingConfig.durationMinutes} minutes`,
    ].join("\n"),
  );
}

async function alertStaff(subject: string, text: string) {
  if (!env.mailFallbackTo) {
    log.error("cannot alert staff: no fallback address configured", { subject });
    return;
  }
  await mailer.send({
    to: env.mailFallbackTo,
    subject,
    text,
    tag: "staff-alert",
  });
}

/** `2026-08-07T18:00` → `Friday 7 August, 6:00 pm`. */
export function humaniseSlotId(slotId: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(slotId);
  if (!match) return slotId;
  const [, y, mo, d, h, mi] = match.map(Number);

  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  /* Midday UTC avoids any edge where the weekday could shift. */
  const weekday = weekdays[new Date(Date.UTC(y, mo - 1, d, 12)).getUTCDay()];
  const period = h >= 12 ? "pm" : "am";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  const time = mi === 0 ? `${twelve}:00 ${period}` : `${twelve}:${String(mi).padStart(2, "0")} ${period}`;

  return `${weekday} ${d} ${months[mo - 1]}, ${time}`;
}

function absolute(path: string): string {
  return env.origin ? new URL(path, env.origin).toString() : path;
}
