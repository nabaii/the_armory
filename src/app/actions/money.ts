"use server";

/**
 * TOPPING UP AND SETTLING — §6.2's Account screen, §9's Paystack.
 *
 *   §6.2, Account: "Charges, payments, balance, renewal date, tier and its
 *    privileges stated plainly."
 *   §9: "Subscriptions, guest overage, account top-up. WEBHOOK-DRIVEN STATE,
 *    NEVER CLIENT-REPORTED SUCCESS."
 *
 * ===========================================================================
 * THIS ACTION MOVES NO MONEY AND MARKS NOTHING PAID
 *
 * All it does is start a transaction at the gateway and hand back a URL. The
 * payment becomes real when Paystack says so, at
 * /api/armory/paystack/webhook — which is the only place in this codebase that
 * writes a `succeeded` payment.
 *
 * The member will return to a callback URL after paying, and that return proves
 * nothing: §9 says so directly, and src/server/paystack.ts says it at greater
 * length ("a visitor returning to the success URL proves only that they can
 * type a URL"). So the callback lands on the Account page, which shows whatever
 * the webhook has recorded — including "awaiting confirmation from the bank"
 * when the webhook has not arrived yet. A member who paid and sees that is
 * being told the truth; a member shown a success screen the club cannot back up
 * is being told a guess.
 *
 * ===========================================================================
 * THE AMOUNT COMES FROM A FIXED LIST, NOT FROM THE FORM
 *
 * §9's first rule and src/server/paystack.ts's first non-negotiable: "the amount
 * never originates in the browser. A client-supplied amount is a
 * client-controlled price."
 *
 * The form posts an INDEX into `TOP_UP_AMOUNTS` and this action reads the
 * amount from that array. A member cannot top up ₦1 and cannot top up ₦0, and
 * neither refusal has to be written as a validation rule — there is no path
 * that carries an arbitrary number.
 */

import { isArmoryDatabaseConfigured } from "@/db/armory/client";
import { TOP_UP_AMOUNTS } from "@/content/top-up";
import { type MoneyState } from "@/lib/money-state";
import { routes } from "@/lib/site";
import { log } from "@/server/log";
import { startPayment } from "@/server/armory/billing";
import { resolveArmoryMember } from "@/server/armory/member-session";
import { settleFromBalance } from "@/server/armory/money";
import { record } from "@/server/armory/record";
import { PostgresRecordStore } from "@/server/armory/postgres-store";
import { env } from "@/server/env";
import { getMember } from "@/server/auth/session";
import { revalidatePath } from "next/cache";

const store = new PostgresRecordStore();

export async function startTopUp(
  _previous: MoneyState,
  form: FormData,
): Promise<MoneyState> {
  const resolution = await resolveArmoryMember();

  if (resolution.state !== "member") {
    return { ok: false, message: "Top-ups are for members." };
  }

  const account = await getMember();
  if (!account?.email) {
    /* Paystack requires an email and the club has one — a portal session is
       email-based. Stated rather than substituted: a placeholder address would
       send the receipt into a void. */
    return {
      ok: false,
      message: "The club has no email address for this account.",
    };
  }

  const index = Number(form.get("amount"));
  const amountKobo = Number.isInteger(index) ? TOP_UP_AMOUNTS[index] : undefined;

  if (amountKobo === undefined) {
    return { ok: false, message: "Choose an amount to top up." };
  }

  const started = await startPayment({
    email: account.email,
    amountKobo,
    intent: {
      personId: resolution.member.personId,
      purpose: "account_topup",
      /* No charge. A top-up puts money on account; what it later settles is a
         separate decision the member or the desk makes. */
      chargeId: null,
    },
    callbackUrl: absolute(routes.portalAccount),
  });

  if (!started.ok) {
    /* The gateway's own words are not shown to the member — they are an
       operational detail and often name Paystack's internals. Logged in full,
       said plainly on screen. */
    log.error("armory top-up could not be started", {
      personId: resolution.member.personId,
      reason: started.reason,
    });

    return {
      ok: false,
      message: "Payments are not reachable just now. Please try again shortly.",
    };
  }

  return { ok: true, authorizationUrl: started.authorizationUrl };
}

/**
 * Settle an outstanding charge from money already on account.
 *
 * No gateway involved and no webhook to wait for, so unlike a top-up this one
 * completes here — and it goes through `record()` because it is a
 * server-authoritative operation rather than a row: it reads a balance, guards
 * it, and writes two rows. §7's replay requirement applies, and the receipt is
 * what carries it.
 */
export async function settleCharge(
  _previous: MoneyState,
  form: FormData,
): Promise<MoneyState> {
  const resolution = await resolveArmoryMember();

  if (resolution.state !== "member") {
    return { ok: false, message: "Sign in to settle a charge." };
  }

  if (!isArmoryDatabaseConfigured()) {
    return { ok: false, message: "The club's system is not reachable just now." };
  }

  const chargeId = String(form.get("chargeId") ?? "");
  const requestId = String(form.get("requestId") ?? "");

  if (!chargeId || !requestId) {
    return { ok: false, message: "That charge could not be identified." };
  }

  const outcome = await record(
    store,
    {
      requestId,
      operation: "charge.settle_from_balance",
      actor: {
        /* §10's attribution. A member settling their own charge is not staff,
           and inventing a staff id here would put a name on an action nobody
           took. The audit row carries the entity and the amount; who did it is
           the charge's own payer. */
        staffUserId: null,
        deviceId: null,
      },
      occurredAt: new Date(),
    },
    (tx) => settleFromBalance(tx, { chargeId }),
  );

  if (outcome.status === "refused") {
    return { ok: false, message: outcome.refusal.message };
  }

  revalidatePath(routes.portalAccount);
  return { ok: true, message: "Settled from your account balance." };
}

/**
 * Paystack needs a URL it can redirect a browser back to, and a relative path
 * is not one.
 *
 * Falls back to the path when no origin is configured, which is the local
 * development case — Paystack is not configured there either, so
 * `startPayment` has already refused and this value is never used. Guessing a
 * production hostname here would be worse: it would send a real member to a
 * domain nobody chose.
 */
function absolute(path: string): string {
  return env.origin ? new URL(path, env.origin).toString() : path;
}
