/**
 * FORM VALIDATION
 *
 * Hand-rolled rather than pulled from a schema library. Two reasons, both
 * specific to this project: the dependency surface on a build that handles
 * "a list of wealthy Abuja residents and where they will be, and when" is worth
 * keeping small and readable, and the rules here are few enough that a library
 * would add indirection without removing work.
 *
 * Validation is server-side and authoritative. The client may also validate for
 * responsiveness, but nothing is trusted from the browser — spec §5 asks for
 * "inline validation, clear error states", and §7 for "correct form labelling
 * and error association", both of which are presentation on top of this.
 *
 * Error messages are written in the brand voice: plain, specific, and never
 * scolding. They tell the visitor what to do, not what they did wrong.
 */

export type FieldErrors = Record<string, string>;

export type Validated<T> =
  | { ok: true; value: T }
  | { ok: false; errors: FieldErrors };

/* ---------------------------------------------------------------------------
   PRIMITIVES
   -------------------------------------------------------------------------- */

const clean = (v: FormDataEntryValue | null | undefined): string =>
  typeof v === "string" ? v.trim() : "";

/**
 * Deliberately permissive. An over-strict email regex rejects real addresses,
 * and on the primary conversion event of the site a false rejection costs more
 * than a bounced email does. Shape only; deliverability is the mailer's problem.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Nigerian and international formats, spaces and punctuation allowed.
 * Normalised to digits (and a leading +) before use.
 */
const PHONE_CHARS = /^[+\d\s()\-.]{7,24}$/;

export const normalisePhone = (raw: string): string => {
  const kept = raw.replace(/[^\d+]/g, "");
  return kept.startsWith("+") ? `+${kept.slice(1).replace(/\+/g, "")}` : kept;
};

/* ---------------------------------------------------------------------------
   LENGTH CAPS

   Not cosmetic. Unbounded free text on a public endpoint is a payload-size and
   log-flooding vector, and any of these fields exceeding its cap is a bot
   rather than an applicant.
   -------------------------------------------------------------------------- */

const MAX = {
  name: 120,
  email: 254, // RFC 5321 practical maximum
  phone: 24,
  note: 2000,
  short: 64,
} as const;

/* ---------------------------------------------------------------------------
   MEMBERSHIP APPLICATION — Flow A step 2.

   "Short. Name, email, phone, tier of interest, referral source, optional note.
    No ID documents, no payment."

   There is no file field and there must never be one. Spec §7: no ID documents
   collected via the website in Phase 1; identity verification happens in person.
   -------------------------------------------------------------------------- */

export type Application = {
  name: string;
  email: string;
  phone: string;
  tier: string | null;
  referral: string;
  note: string | null;
};

export function validateApplication(form: FormData): Validated<Application> {
  const errors: FieldErrors = {};

  const name = clean(form.get("name"));
  const email = clean(form.get("email"));
  const phone = clean(form.get("phone"));
  const tier = clean(form.get("tier"));
  const referral = clean(form.get("referral"));
  const note = clean(form.get("note"));

  if (name.length < 2) errors.name = "Please give us your full name.";
  else if (name.length > MAX.name) errors.name = "That name is longer than we can store.";

  if (!EMAIL.test(email)) errors.email = "Please check the email address — we reply to it.";
  else if (email.length > MAX.email) errors.email = "That email address is too long.";

  if (!PHONE_CHARS.test(phone)) errors.phone = "Please give a phone number we can reach you on.";

  /* Tier is optional while the founder's tier structure is unresolved — the
     form omits the field entirely in that state rather than inventing options,
     so requiring it here would make the form unsubmittable. */
  if (tier && tier.length > MAX.short) errors.tier = "Unrecognised tier.";

  if (!referral) errors.referral = "Let us know how you heard about the club.";
  else if (referral.length > MAX.short) errors.referral = "Unrecognised value.";

  if (note.length > MAX.note) errors.note = "Please shorten your note a little.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name,
      email,
      phone: normalisePhone(phone),
      tier: tier || null,
      referral,
      note: note || null,
    },
  };
}

/* ---------------------------------------------------------------------------
   GROUP & EVENT ENQUIRY — routed to bookings, never to the membership pipeline.
   -------------------------------------------------------------------------- */

export type GroupEnquiry = {
  name: string;
  email: string;
  phone: string;
  partySize: number;
  visitType: string;
  note: string | null;
};

export function validateGroupEnquiry(form: FormData): Validated<GroupEnquiry> {
  const errors: FieldErrors = {};

  const name = clean(form.get("group-name"));
  const email = clean(form.get("group-email"));
  const phone = clean(form.get("group-phone"));
  const sizeRaw = clean(form.get("group-size"));
  const visitType = clean(form.get("group-type"));
  const note = clean(form.get("group-note"));

  if (name.length < 2) errors["group-name"] = "Please give us your name.";
  if (!EMAIL.test(email)) errors["group-email"] = "Please check the email address.";
  if (!PHONE_CHARS.test(phone)) errors["group-phone"] = "Please give a phone number we can reach you on.";

  /* Party size is required because the stated success measure for the groups
     page is "enquiry volume and average party size". It cannot be recovered
     later if it is not captured here. */
  const partySize = Number.parseInt(sizeRaw, 10);
  if (!Number.isInteger(partySize) || partySize < 2 || partySize > 200) {
    errors["group-size"] = "Roughly how many people? Between 2 and 200.";
  }

  if (!visitType) errors["group-type"] = "Tell us what kind of visit you have in mind.";
  if (note.length > MAX.note) errors["group-note"] = "Please shorten your note a little.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: { name, email, phone: normalisePhone(phone), partySize, visitType, note: note || null },
  };
}

/* ---------------------------------------------------------------------------
   LEAGUES WAITLIST — one field, plus its attribution source.
   -------------------------------------------------------------------------- */

export type WaitlistSignup = { email: string; source: string };

export function validateWaitlist(form: FormData): Validated<WaitlistSignup> {
  const email = clean(form.get("email"));
  const source = clean(form.get("source")) || "unknown";

  if (!EMAIL.test(email) || email.length > MAX.email) {
    return { ok: false, errors: { email: "Please check the email address." } };
  }
  return { ok: true, value: { email, source: source.slice(0, MAX.short) } };
}

/* ---------------------------------------------------------------------------
   FIRST-VISIT BOOKING — Flow B step 3.

   "Name, contact, party names optional. Age confirmation and eligibility check."

   Party NAMES are deliberately not collected. Flow B allows them as optional,
   but collecting the names of everyone attending, against a date and a time,
   builds exactly the dataset the Brief identifies as the site's core risk. A
   head count is sufficient to run the session; names are taken at reception.
   -------------------------------------------------------------------------- */

export type BookingRequest = {
  slotId: string;
  partySize: number;
  name: string;
  email: string;
  phone: string;
  /** Explicit affirmation, not a pre-ticked box. */
  ageConfirmed: boolean;
  /** Version of the refund policy the visitor was shown. */
  policyVersion: string;
};

export function validateBookingRequest(
  form: FormData,
  currentPolicyVersion: string,
): Validated<BookingRequest> {
  const errors: FieldErrors = {};

  const slotId = clean(form.get("slotId"));
  const sizeRaw = clean(form.get("partySize"));
  const name = clean(form.get("name"));
  const email = clean(form.get("email"));
  const phone = clean(form.get("phone"));
  const ageConfirmed = clean(form.get("ageConfirmed")) === "yes";
  const shownPolicy = clean(form.get("policyVersion"));

  if (!slotId) errors.slotId = "Choose a date and time.";

  const partySize = Number.parseInt(sizeRaw, 10);
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 12) {
    errors.partySize = "How many people are coming? Up to 12 per booking.";
  }

  if (name.length < 2) errors.name = "Please give us your full name.";
  if (!EMAIL.test(email)) errors.email = "Please check the email address — we send your confirmation to it.";
  if (!PHONE_CHARS.test(phone)) errors.phone = "Please give a phone number we can reach you on.";

  if (!ageConfirmed) {
    errors.ageConfirmed = "Please confirm everyone in your party meets the age requirement.";
  }

  /* If the policy changed between page render and submission, the visitor has
     not seen the terms now in force. §9 requires the terms to appear BEFORE
     payment, so the only correct action is to send them back to re-read. */
  if (shownPolicy !== currentPolicyVersion) {
    errors.policyVersion =
      "Our deposit terms were updated while you were booking. Please review them and try again.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      slotId,
      partySize,
      name,
      email,
      phone: normalisePhone(phone),
      ageConfirmed,
      policyVersion: shownPolicy,
    },
  };
}

/* ---------------------------------------------------------------------------
   HONEYPOT

   Bots complete fields humans cannot see. Field names differ per form so a
   bot cannot learn one name and skip it everywhere.
   -------------------------------------------------------------------------- */

export function isHoneypotTripped(form: FormData, fieldName: string): boolean {
  return clean(form.get(fieldName)).length > 0;
}
