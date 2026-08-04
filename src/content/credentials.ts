/**
 * CREDENTIALS — real content, governed by claims discipline.
 *
 * Both source documents state the rule twice, in almost the same words.
 * Design Spec §3: "'Built to international competition standard' is a
 * credibility claim true from opening. 'Host of the national championships' is
 * a fact that can only be published once it has happened. Do not spend a claim
 * that cannot yet be cashed — the audience that matters will check."
 *
 * Only `trueOnDayOne: true` entries render. The rest are kept here rather than
 * deleted so the claim is not re-litigated every time someone writes copy, and
 * so flipping one to true is a deliberate, reviewable act.
 *
 * `evidence` is the internal record and is never published — verified to appear
 * in neither the rendered document nor the RSC payload.
 */

import type { Credential } from "@/lib/content";

export const credentials: readonly Credential[] = [
  {
    label: "Built to national and international competition standard",
    evidence:
      "Facility build standard. The Brief locks this as always-true from opening: " +
      "'a credibility claim true on day one regardless'. The single most powerful " +
      "claim available and the one every section traces back to.",
    trueOnDayOne: true,
  },
  {
    label: "At the Abuja National Stadium",
    evidence:
      "Private lease. The Brief is explicit that this is 'a borrowed credential " +
      "(\"at the Abuja National Stadium\"), not a governance frame' — so it is " +
      "stated as a location and never implies public-institution status.",
    trueOnDayOne: true,
  },
  {
    label: "Range-owned firearms, professionally supervised",
    evidence:
      "Operating model, settled ground in the Brief: range-owned firearms " +
      "exclusively. Framed as hospitality rather than restriction — everything " +
      "is provided — which is also what makes the safety story airtight.",
    trueOnDayOne: true,
  },
  {
    label: "Automatic targeting and scoring on the air rifle range",
    evidence:
      "Stated in the Brief and Design Spec §3. Substantiates the competition- " +
      "standard claim and is what makes Leagues scores machine-verified. " +
      "Confirm the system is installed and operational before publishing.",
    trueOnDayOne: true,
  },
  {
    /* Outstanding from the Founder (spec §8) — "Sporting body relationships and
       any certifications, with evidence". Stays false until supplied. */
    label: "Affiliated to recognised sporting bodies",
    evidence:
      "OUTSTANDING. Founder to supply relationships and certifications with " +
      "evidence. Not publishable until named and verifiable — the institutional " +
      "audience is precisely the one that checks.",
    trueOnDayOne: false,
  },
  {
    label: "Host of the national championships",
    evidence:
      "Not yet true. Publishable only once it has happened. Held deliberately: " +
      "'do not spend a claim you cannot yet cash'.",
    trueOnDayOne: false,
  },
];
