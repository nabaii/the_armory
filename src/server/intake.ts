/**
 * INTAKE — the durability guarantee.
 *
 * ===========================================================================
 * THE ONE RULE
 *
 * A submission is accepted ONLY if it reached somewhere durable. If it did not,
 * the visitor is told so and asked to call instead. We never show a
 * confirmation for a submission we dropped.
 *
 * This is the failure mode most likely to go unnoticed on this build, because
 * it looks like success from every angle: the form clears, the confirmation
 * renders, the visitor believes they have applied, and the club never hears
 * about them. The Brief describes exactly what is at stake — "a membership-first
 * site with nobody answering applications is a prettier waitlist" — and the
 * audience is a sceptical, wealthy visitor who will not apply twice.
 *
 * So: two independent delivery paths, and an explicit refusal if both fail.
 * ===========================================================================
 *
 * DURABILITY LADDER
 *
 *   1. CRM record        — the intended destination. Flow A step 5.
 *   2. Owner email       — fallback. A named person receives the full details.
 *
 * Either one counts as durable. A dropped duplicate is a nuisance; a dropped
 * application is unrecoverable, so we always prefer over-delivery.
 *
 * The applicant's own confirmation email (Flow A step 4) is best-effort and
 * deliberately NOT part of the durability test. If the record landed with a
 * human but the courtesy email bounced, the application is safe — the club can
 * still act on it. Refusing the submission in that case would throw away a
 * captured lead to protect a nicety.
 */

import { crm, type CrmContact } from "@/server/crm";
import { mailer } from "@/server/mailer";
import { env } from "@/server/env";
import { log, redactEmail, redactPhone } from "@/server/log";

export type IntakeSubmission = {
  /** Pipeline key: routes the record and tags the email. */
  pipeline: "membership-application" | "group-enquiry" | "leagues-waitlist";
  /** Human-readable label for the notification subject line. */
  label: string;
  contact: { name: string; email: string; phone?: string };
  /** Ordered detail lines for the owner notification. No ID documents. */
  details: Array<[string, string]>;
  crmProperties?: Record<string, string>;
};

export type IntakeOutcome = {
  /** True only if the submission reached the CRM or a named person. */
  durable: boolean;
  via: Array<"crm" | "owner-email">;
  failures: string[];
};

export async function deliver(
  submission: IntakeSubmission,
): Promise<IntakeOutcome> {
  const via: IntakeOutcome["via"] = [];
  const failures: string[] = [];

  /* Both paths are attempted in parallel rather than in sequence. A CRM
     timeout of ten seconds followed by a mail timeout of ten more would leave
     the visitor staring at a spinner for twenty; running them together also
     means a CRM outage costs nothing in latency. Over-delivery is acceptable
     and under-delivery is not. */
  const [crmResult, ownerResult] = await Promise.all([
    writeToCrm(submission),
    notifyOwner(submission),
  ]);

  if (crmResult.ok) via.push("crm");
  else failures.push(crmResult.error);

  if (ownerResult.ok) via.push("owner-email");
  else failures.push(ownerResult.error);

  const outcome: IntakeOutcome = { durable: via.length > 0, via, failures };

  log[outcome.durable ? "info" : "error"]("intake", {
    pipeline: submission.pipeline,
    durable: outcome.durable,
    via: via.join(",") || "none",
    /* Redacted. See log.ts — logs record facts, never people. */
    email: redactEmail(submission.contact.email),
    phone: submission.contact.phone
      ? redactPhone(submission.contact.phone)
      : undefined,
    failures: failures.length ? failures.join(" | ") : undefined,
  });

  return outcome;
}

async function writeToCrm(submission: IntakeSubmission) {
  const contact: CrmContact = {
    email: submission.contact.email,
    name: submission.contact.name,
    phone: submission.contact.phone,
    pipeline: submission.pipeline,
    properties: submission.crmProperties,
  };
  return crm.upsertContact(contact);
}

async function notifyOwner(submission: IntakeSubmission) {
  if (!env.mailFallbackTo) {
    return { ok: false as const, error: "no owner address configured" };
  }

  const lines = [
    submission.label,
    "",
    `Name:   ${submission.contact.name}`,
    `Email:  ${submission.contact.email}`,
    ...(submission.contact.phone ? [`Phone:  ${submission.contact.phone}`] : []),
    "",
    ...submission.details.map(([k, v]) => `${k}: ${v}`),
    "",
    "— Sent by the website. Reply directly to the applicant.",
  ];

  const result = await mailer.send({
    to: env.mailFallbackTo,
    subject: `${submission.label} — ${submission.contact.name}`,
    text: lines.join("\n"),
    replyTo: submission.contact.email,
    tag: submission.pipeline,
  });

  return result.ok
    ? { ok: true as const }
    : { ok: false as const, error: result.error };
}

/* ---------------------------------------------------------------------------
   APPLICANT CONFIRMATION — Flow A step 4. Best-effort, never gating.

   Spec: "Confirmation with a direct link to book a tour or a first visit. The
   visit is the sales meeting." And the Brief on why the on-screen confirmation
   is not enough on its own: "'We will email you back' loses half of them in
   the gap."
   -------------------------------------------------------------------------- */

export async function sendApplicantConfirmation({
  to,
  name,
  firstVisitUrl,
}: {
  to: string;
  name: string;
  firstVisitUrl: string;
}): Promise<void> {
  const text = [
    `${name.split(" ")[0]},`,
    "",
    "Thank you for applying to The Armory Shooting Sports Club.",
    "",
    "Your application is with a member of the club rather than an inbox, and",
    "we will be in touch to arrange a tour or a first visit. That visit is",
    "where we talk through the tiers and what each includes.",
    "",
    "If you would rather not wait, you can book a first visit now:",
    firstVisitUrl,
    "",
    "Everything is provided. No experience, licence or equipment needed.",
    "",
    "The Armory Shooting Sports Club",
    "Abuja National Stadium, FCT",
  ].join("\n");

  const result = await mailer.send({
    to,
    subject: "Your application — The Armory Shooting Sports Club",
    text,
    tag: "application-confirmation",
  });

  if (!result.ok) {
    /* Logged, not surfaced. The record is already durable at this point, and
       the on-screen confirmation has told them what happens next. */
    log.warn("applicant confirmation failed", {
      email: redactEmail(to),
      error: result.error,
    });
  }
}
