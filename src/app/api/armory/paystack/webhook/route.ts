import { getArmoryDb, isArmoryDatabaseConfigured } from "@/db/armory/client";
import { readIntent } from "@/server/armory/billing";
import { recordGatewayPayment } from "@/server/armory/money";
import { kobo } from "@/lib/money";
import { log } from "@/server/log";
import { parseEvent, verifyWebhookSignature } from "@/server/paystack";

/**
 * THE CLUB'S PAYSTACK WEBHOOK — §9, §12.1.
 *
 *   §9: "Webhook-driven state, never client-reported success. Idempotent on
 *    gateway_reference."
 *   §12.1: "Duplicate webhook from Paystack → ONE PAYMENT ROW. Idempotent on
 *    gateway_reference."
 *
 * ===========================================================================
 * WHY THIS IS A SECOND WEBHOOK ROUTE AND NOT A BRANCH IN THE FIRST
 *
 * `/api/paystack/webhook` already exists and confirms first-visit bookings for
 * the marketing site. Both use one Paystack account, so both receive every
 * event — and the obvious tidy-up is one endpoint with a branch on metadata.
 *
 * That was rejected. The two write to different databases with different
 * drivers (the leagues product's Neon HTTP client, and the management system's
 * pooled TCP one — see src/db/armory/client.ts), have different failure modes,
 * and the management one holds the club's money. A branch means a change to the
 * booking flow can break subscription payments, and the blast radius of a
 * mistake in either grows to cover both.
 *
 * Paystack allows one webhook URL per account, so BOTH endpoints must exist and
 * be reachable, and the account is configured with whichever the club is
 * running. The one that does not recognise an event's metadata answers 200 and
 * does nothing, which is what `readIntent` returning null means below. That is
 * the same discipline the other route already applies to events it ignores.
 *
 * ===========================================================================
 * FOUR RULES, ALL LOAD-BEARING — the same four the booking webhook states
 *
 * 1. VERIFY THE SIGNATURE ON THE RAW BODY, before parsing. Re-serialising JSON
 *    changes key order and breaks the HMAC.
 * 2. UNSIGNED OR BADLY SIGNED REQUESTS GET 401 AND CHANGE NOTHING. Without
 *    that this is an open endpoint for crediting member accounts.
 * 3. IDEMPOTENT. The unique index on `gateway_reference` carries it; see
 *    `recordGatewayPayment`.
 * 4. ALWAYS RETURN 200 ONCE THE SIGNATURE IS VALID. A non-2xx makes Paystack
 *    retry with backoff and eventually disable the webhook, and losing the
 *    endpoint is far worse than losing one event — every payment is still
 *    recoverable through §9's reconciliation job, and a disabled webhook is
 *    not recoverable at all.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  /* Rule 1. Raw body first, always. */
  const rawBody = await request.text();
  const signature = request.headers.get("x-paystack-signature");

  const valid = await verifyWebhookSignature(rawBody, signature);
  if (!valid) {
    /* Deliberately terse. A verbose error tells a prober what to fix. */
    log.warn("armory paystack webhook rejected: bad signature", {
      hasSignature: Boolean(signature),
      bodyBytes: rawBody.length,
    });
    return new Response("Unauthorised", { status: 401 });
  }

  const event = parseEvent(rawBody);
  if (!event) {
    log.error("armory paystack webhook: signature valid but body unparseable");
    return ok();
  }

  if (event.event !== "charge.success") {
    log.info("armory paystack webhook ignored", { event: event.event });
    return ok();
  }

  const intent = readIntent(event.data.metadata);
  if (!intent) {
    /* Not ours — very likely a first-visit booking, which the other route
       handles. Not an error and not logged as one. */
    log.info("armory paystack webhook: event carries no club intent");
    return ok();
  }

  const reference = event.data.reference;
  const amount = event.data.amount;

  if (!reference || typeof amount !== "number" || amount <= 0) {
    /* Signed, ours, and unusable. Loud, because a member has been debited and
       the club now has no record — exactly what §9's reconciliation exists for,
       and this log is how a human learns to run it. */
    log.error("ARMORY PAYMENT WITHOUT A USABLE REFERENCE OR AMOUNT", {
      personId: intent.personId,
      purpose: intent.purpose,
      hasReference: Boolean(reference),
      amount,
    });
    return ok();
  }

  if (event.data.status !== "success") {
    log.warn("armory charge.success with non-success status", {
      reference,
      status: event.data.status,
    });
    return ok();
  }

  if (!isArmoryDatabaseConfigured()) {
    /* Rule 4 still applies, and this is the one case where answering 200 loses
       something: the event will not be redelivered. Logged at error so the
       reference can be replayed from the Paystack dashboard, which is the
       recovery path §9's reconciliation job automates. */
    log.error("ARMORY PAYMENT RECEIVED WITH NO DATABASE CONFIGURED", {
      reference,
      personId: intent.personId,
    });
    return ok();
  }

  try {
    const outcome = await getArmoryDb().transaction((tx) =>
      recordGatewayPayment(tx, {
        personId: intent.personId,
        /* §2, §9: kobo throughout. Paystack's `amount` is already minor units,
           and `kobo()` refuses anything that is not a whole number — so a
           gateway that ever sent naira fails here rather than crediting a
           member one hundredth of what they paid. */
        amountKobo: kobo(amount),
        purpose: intent.purpose,
        gateway: "paystack",
        gatewayReference: reference,
        method: null,
        paidAt: new Date(),
        chargeId: intent.chargeId,
      }),
    );

    log.info("armory payment recorded", {
      reference,
      outcome: outcome.kind,
      purpose: intent.purpose,
    });
  } catch (error) {
    /* Rule 4. The event is not redelivered after a 200, so this is logged at
       error and recovered by reconciliation rather than by retry — a 500 here
       would trade one lost event for a disabled webhook. */
    log.error("ARMORY PAYMENT COULD NOT BE RECORDED", {
      reference,
      personId: intent.personId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return ok();
}

const ok = () =>
  new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
