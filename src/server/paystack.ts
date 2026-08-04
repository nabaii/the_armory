/**
 * PAYSTACK — Naira deposits for first-visit bookings. Flow B step 4.
 *
 * Chosen over Flutterwave for webhook reliability and documentation. Card and
 * bank transfer, Naira-denominated, per spec §7.
 *
 * ---------------------------------------------------------------------------
 * THREE NON-NEGOTIABLES, ALL IMPLEMENTED HERE
 *
 * 1. THE TRANSACTION IS INITIALISED SERVER-SIDE. The amount never originates in
 *    the browser. A client-supplied amount is a client-controlled price.
 *
 * 2. THE WEBHOOK SIGNATURE IS VERIFIED, AND THE CLIENT CALLBACK IS NEVER
 *    TRUSTED. A visitor returning to the success URL proves only that they can
 *    type a URL. Money is confirmed by a signed webhook, or by an explicit
 *    server-to-server verify call — never by a redirect.
 *
 * 3. IDEMPOTENCY. Paystack retries webhooks. A retried `charge.success` must not
 *    double-book a slot, so the booking reference is the idempotency key and the
 *    store treats confirmation as set-once. See booking-store.ts.
 *
 * ---------------------------------------------------------------------------
 * WEB CRYPTO, NOT node:crypto
 *
 * Signature verification uses `crypto.subtle` and a hand-written constant-time
 * comparison rather than `node:crypto` and `timingSafeEqual`. That keeps this
 * module runtime-agnostic, which was a deliberate architectural decision: the
 * hosting choice for this project should be made from measured Nigerian latency
 * rather than from vendor documentation, and it stays cheap to change only as
 * long as nothing depends on a Node-specific API.
 * ---------------------------------------------------------------------------
 */

import { env, isConfigured } from "@/server/env";
import { describe } from "@/server/mailer";
import { log } from "@/server/log";

const API = "https://api.paystack.co";

/* ---------------------------------------------------------------------------
   MONEY

   Paystack denominates in the minor unit. For NGN that is kobo, 100 to the
   naira. Every amount crossing this boundary is an integer number of kobo, and
   naira never appear as floats anywhere — 0.1 + 0.2 problems in a payment path
   are not worth the convenience.
   -------------------------------------------------------------------------- */

export const nairaToKobo = (naira: number): number => {
  if (!Number.isFinite(naira) || naira < 0) {
    throw new Error(`Invalid naira amount: ${naira}`);
  }
  return Math.round(naira * 100);
};

export const koboToNaira = (kobo: number): number => kobo / 100;

/** Naira, formatted for display. Tabular numerals are applied by the Data component. */
export const formatNaira = (kobo: number): string =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(koboToNaira(kobo));

/* ---------------------------------------------------------------------------
   INITIALISE
   -------------------------------------------------------------------------- */

export type InitResult =
  | { ok: true; authorizationUrl: string; reference: string }
  | { ok: false; error: string };

export async function initializeTransaction({
  email,
  amountKobo,
  reference,
  callbackUrl,
  metadata,
}: {
  email: string;
  amountKobo: number;
  /** Our booking reference. Also the idempotency key. */
  reference: string;
  callbackUrl: string;
  metadata: Record<string, string | number>;
}): Promise<InitResult> {
  if (!isConfigured.payments()) {
    return { ok: false, error: "payments not configured" };
  }
  if (!Number.isInteger(amountKobo) || amountKobo <= 0) {
    return { ok: false, error: `invalid amount: ${amountKobo}` };
  }

  try {
    const response = await fetch(`${API}/transaction/initialize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.paystackSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        amount: amountKobo,
        currency: "NGN",
        reference,
        callback_url: callbackUrl,
        /* Card and bank transfer. Both matter in Nigeria — a card-only flow
           loses bookings from visitors whose cards fail online. */
        channels: ["card", "bank_transfer", "bank", "ussd"],
        metadata,
      }),
      signal: AbortSignal.timeout(12_000),
    });

    const body = (await response.json().catch(() => null)) as {
      status?: boolean;
      message?: string;
      data?: { authorization_url?: string; reference?: string };
    } | null;

    if (!response.ok || !body?.status || !body.data?.authorization_url) {
      return {
        ok: false,
        error: `paystack init ${response.status}: ${body?.message ?? "unexpected response"}`,
      };
    }

    return {
      ok: true,
      authorizationUrl: body.data.authorization_url,
      reference: body.data.reference ?? reference,
    };
  } catch (error) {
    return { ok: false, error: `paystack init failed: ${describe(error)}` };
  }
}

/* ---------------------------------------------------------------------------
   VERIFY — server to server. The authoritative answer on whether money moved.
   -------------------------------------------------------------------------- */

export type VerifyResult =
  | { ok: true; paid: boolean; amountKobo: number; reference: string }
  | { ok: false; error: string };

export async function verifyTransaction(reference: string): Promise<VerifyResult> {
  if (!isConfigured.payments()) {
    return { ok: false, error: "payments not configured" };
  }

  try {
    const response = await fetch(
      `${API}/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: { Authorization: `Bearer ${env.paystackSecretKey}` },
        signal: AbortSignal.timeout(12_000),
      },
    );

    const body = (await response.json().catch(() => null)) as {
      status?: boolean;
      data?: { status?: string; amount?: number; reference?: string };
    } | null;

    if (!response.ok || !body?.status || !body.data) {
      return { ok: false, error: `paystack verify ${response.status}` };
    }

    return {
      ok: true,
      paid: body.data.status === "success",
      amountKobo: body.data.amount ?? 0,
      reference: body.data.reference ?? reference,
    };
  } catch (error) {
    return { ok: false, error: `paystack verify failed: ${describe(error)}` };
  }
}

/* ---------------------------------------------------------------------------
   WEBHOOK SIGNATURE

   Paystack signs the RAW request body with HMAC-SHA512 keyed on the secret key,
   and sends the hex digest in `x-paystack-signature`.

   The body must be verified byte-for-byte as received. Parsing to JSON and
   re-serialising changes key order and whitespace and breaks the digest — so
   the route reads `await request.text()` and passes that string here, parsing
   only after verification succeeds.
   -------------------------------------------------------------------------- */

export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader || !env.paystackSecretKey) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.paystackSecretKey),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );

  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );

  return constantTimeEquals(toHex(digest), signatureHeader.trim().toLowerCase());
}

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/**
 * Length-independent, constant-time-ish string comparison.
 *
 * Returns early only on length, which leaks the length of an HMAC digest — a
 * fixed, public constant. Content comparison always walks every character so a
 * timing signal cannot be used to recover the digest byte by byte.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/* ---------------------------------------------------------------------------
   EVENT PARSING — only after the signature has been verified.
   -------------------------------------------------------------------------- */

export type PaystackEvent = {
  event: string;
  data: {
    reference?: string;
    status?: string;
    amount?: number;
    metadata?: Record<string, unknown>;
  };
};

export function parseEvent(rawBody: string): PaystackEvent | null {
  try {
    const parsed = JSON.parse(rawBody) as PaystackEvent;
    if (typeof parsed?.event !== "string" || typeof parsed?.data !== "object") {
      return null;
    }
    return parsed;
  } catch (error) {
    log.warn("paystack webhook body was not valid json", {
      error: describe(error),
    });
    return null;
  }
}
