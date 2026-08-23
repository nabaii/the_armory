/**
 * ⚠ REFERENCE-PAGE FIXTURES ONLY — NOT PRODUCTION CONTENT.
 *
 * These exist so /brand/components can demonstrate components whose real
 * content is still outstanding from the client. They are imported by that route
 * and by nothing else.
 *
 * Tier names below are the STRUCTURE the Brief assumes ("an entry /
 * frequent-visitor pass, a full membership (the actual club), and a scarce,
 * status-priced top tier"), not names the founder has given. They are
 * deliberately generic so they read as scaffolding rather than as decisions.
 *
 * Do not import this file from a public route.
 */

import { GATED_PRICE, type Credential, type Tier } from "@/lib/content";
import { PENDING } from "@/lib/site";

export const fixtureTiers: readonly Tier[] = [
  {
    slug: "pass",
    name: "Range Pass",
    positioning:
      "For the frequent visitor. Range access and priority booking, without the club.",
    inclusions: [
      "Priority booking on all three ranges",
      "Range fees included",
      "Guest rate for anyone you bring",
    ],
    price: GATED_PRICE,
    register: "neutral",
  },
  {
    slug: "member",
    name: "Full Membership",
    positioning:
      "The club itself. The room, the ladder, and the people in it.",
    inclusions: [
      "Everything in Range Pass",
      "Create and captain leagues",
      "A place on the season-long club ladder",
      "League entry priced in",
      "Eligible for the championship and season finale",
    ],
    price: GATED_PRICE,
    register: "member",
  },
  {
    slug: "founding",
    name: "Founding Member",
    positioning:
      "Closed permanently at launch. The VIP deck, and a standing later members cannot obtain.",
    inclusions: [
      "Everything in Full Membership",
      "VIP deck access",
      "First access to Leagues",
      "Permanently distinguished on your membership card",
    ],
    price: GATED_PRICE,
    register: "vip",
    founding: {
      benefit:
        "Founding members are recognised permanently and visibly. The designation cannot be granted again once the cohort closes.",
      /* Unresolved by design — the Brief flags the cap as an open decision and
         warns that "a soft cap you quietly exceed becomes a lie your best
         members eventually notice". */
      cap: PENDING,
    },
  },
];

/**
 * Demonstrates the claims filter. Only `trueOnDayOne` entries render, so the
 * second item below is deliberately absent from output — it is the exact
 * example both source documents use for a claim that must wait.
 */
export const fixtureCredentials: readonly Credential[] = [
  {
    label: "Built to national and international competition standard",
    evidence:
      "Facility specification and build standard. Locked as always-true from opening day, per the Brief.",
    trueOnDayOne: true,
  },
  {
    label: "Host of the national championships",
    evidence:
      "Not yet true. Publishable only once it has happened — 'do not spend a claim you cannot yet cash'.",
    trueOnDayOne: false,
  },
];
