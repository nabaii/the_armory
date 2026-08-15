"use server";

/**
 * THE GUEST LINK'S SUBMISSION — §6.3.
 *
 *   "Two minutes, on a phone, in poor signal, by someone who has never heard of
 *    you… completed end to end in under two minutes on a mid-range Android over
 *    throttled 3G, with no account creation and no password."
 *
 * ===========================================================================
 * A SERVER ACTION, FOR THE REASON src/app/actions/intake.ts ALREADY GIVES
 *
 *   "A form that only works once a JavaScript bundle has parsed is a form that
 *    loses applications on Nigerian mobile data."
 *
 * That sentence was written about the marketing site's application form. It
 * applies with more force here, because §6.3 attaches a NUMBER to it. Two
 * minutes on throttled 3G is roughly enough for one HTML document and one round
 * trip — it is not enough to download a React bundle, hydrate it, and then
 * discover the form was interactive all along.
 *
 * So this form posts. Without JavaScript the browser submits it, this runs, and
 * the page re-renders with field errors in place and nothing the guest typed
 * lost. With JavaScript it is the same code path, faster. The two-minute budget
 * is met by the version that does not depend on the bundle.
 *
 * ===========================================================================
 * THE IDS ARE MINTED HERE, NOT IN THE BROWSER
 *
 * §7 wants a client-generated UUIDv7 so a write is safe to replay. This form has
 * no client — that is the point of it — so the ids come from the hidden fields
 * the page rendered, which were minted server-side when the form was drawn.
 *
 * The effect is the same and it is the effect that matters: a guest on a bad
 * connection who taps "Confirm" twice, or whose browser retries the POST, sends
 * the same person id and the same signature id both times. One person, one
 * signature. A guest double-tapping in a car park is the single most likely
 * duplicate in the entire system, and it is prevented by two hidden inputs.
 */

import { headers } from "next/headers";
import { getArmoryDb, isArmoryDatabaseConfigured } from "@/db/armory/client";
import { log } from "@/server/log";
import { completeVisit } from "@/server/armory/visit";
import { LIMITS, clientKey, rateLimit } from "@/server/rate-limit";
import type { FieldErrors } from "@/server/validation";

import type { VisitState } from "@/lib/visit-state";

/** E.164, the armoury's account identifier (§3.1). */
const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Normalise a Nigerian number typed the way Nigerians type it.
 *
 * `0801 234 5678` is how the number appears on every form the guest has ever
 * filled in, and refusing it would be the club asking someone in a car park to
 * know what E.164 means. §3.1 needs the stored value canonical; nothing says the
 * guest has to produce it.
 */
function normalisePhone(raw: string): string {
  const trimmed = raw.replace(/[\s()-]/g, "");
  if (trimmed.startsWith("+")) return trimmed;
  if (trimmed.startsWith("0")) return `+234${trimmed.slice(1)}`;
  if (trimmed.startsWith("234")) return `+${trimmed}`;
  return trimmed;
}

function readDetails(form: FormData) {
  const text = (name: string) => String(form.get(name) ?? "").trim();

  const errors: FieldErrors = {};

  const firstName = text("firstName");
  const lastName = text("lastName");
  const phone = normalisePhone(text("phone"));
  const email = text("email");
  const dateOfBirth = text("dateOfBirth");
  const emergencyContactName = text("emergencyContactName");
  const emergencyContactPhone = normalisePhone(text("emergencyContactPhone"));

  if (!firstName) errors.firstName = "We need your first name.";
  if (!lastName) errors.lastName = "We need your last name.";

  if (!phone) errors.phone = "We need a number we can reach you on.";
  else if (!E164.test(phone)) {
    errors.phone = "That does not look like a phone number. Try 0801 234 5678.";
  }

  if (!dateOfBirth) errors.dateOfBirth = "We need your date of birth.";
  else if (Number.isNaN(Date.parse(dateOfBirth))) {
    errors.dateOfBirth = "That date could not be read.";
  }

  if (!emergencyContactName) {
    errors.emergencyContactName = "We need somebody to call if anything happens.";
  }
  if (!emergencyContactPhone) {
    errors.emergencyContactPhone = "We need a number for your emergency contact.";
  } else if (!E164.test(emergencyContactPhone)) {
    errors.emergencyContactPhone =
      "That does not look like a phone number. Try 0801 234 5678.";
  }

  if (form.get("waiver") !== "accepted") {
    errors.waiver = "The waiver has to be accepted before you can shoot.";
  }

  return {
    errors,
    details: {
      firstName,
      lastName,
      phone,
      email: email || null,
      dateOfBirth: new Date(`${dateOfBirth}T00:00:00.000Z`),
      emergencyContactName,
      emergencyContactPhone,
    },
  };
}

export async function submitVisit(
  _previous: VisitState,
  form: FormData,
): Promise<VisitState> {
  const token = String(form.get("token") ?? "");
  const personId = String(form.get("personId") ?? "");
  const signatureId = String(form.get("signatureId") ?? "");

  if (!token || !personId || !signatureId) {
    return {
      ok: false,
      formError: "Something went wrong with this link. Open it again from your message.",
    };
  }

  /* §10 rate-limits the guest token endpoint. The same limit covers the write:
     this is the one place in the management system where a stranger can insert
     a row, and it is reached without any credential but the token.

     A server action has no Request object, so the headers come from next/headers
     and are wrapped in the shape `clientKey` reads. Sharing that function rather
     than re-deriving the client identity keeps one definition of who a caller
     is — two would eventually disagree about which proxy header to trust. */
  const limit = rateLimit(
    clientKey(new Request("https://visit", { headers: await headers() }), "guest-visit"),
    LIMITS.guestToken,
  );
  if (!limit.allowed) {
    return {
      ok: false,
      formError: "Too many attempts just now. Wait a moment and try again.",
    };
  }

  const { errors, details } = readDetails(form);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  if (!isArmoryDatabaseConfigured()) {
    return {
      ok: false,
      formError:
        "The club's system is not reachable right now. Call the club and they will take your details at the door.",
    };
  }

  try {
    const written = await getArmoryDb().transaction((tx) =>
      completeVisit(tx, {
        token,
        details,
        now: new Date(),
        personId,
        signatureId,
      }),
    );

    if (written.outcome === "refused") {
      /* §4.3: a sentence, and one this guest can act on. The refusals in
         visit.ts name the host where they can — "ask Ada to send you another"
         is a route forward; "invalid invitation" is a dead end in a car park. */
      return { ok: false, formError: written.refusal.message };
    }

    return { ok: true };
  } catch (error) {
    log.error("visit.submit.failed", {
      message: error instanceof Error ? error.message : String(error),
    });

    return {
      ok: false,
      formError:
        "We could not save that just now. Try once more — and if it still fails, the club can take your details at the door.",
    };
  }
}
