/**
 * CONTENT MODEL
 *
 * The shapes every page and component consumes, and the eventual CMS schema.
 * Two of the specification's hard constraints are encoded here as TYPES rather
 * than left to review, because both are the kind of rule that holds for six
 * weeks and then quietly breaks in a hurry the night before launch.
 */

import type { Pending } from "@/lib/site";

/* ---------------------------------------------------------------------------
   PHOTOGRAPHY

   Brand Guidelines §7, HARD CONSTRAINT — what must never be photographed:
   facility layout in a way that maps the building, entry and exit points,
   storage or armoury arrangements, security staffing or systems, identifiable
   members without written consent. "An operational security requirement, not
   an aesthetic preference. Brief the photographer explicitly and review every
   frame before publication."

   `securityReviewed` is therefore required and has no default. An unreviewed
   frame cannot be rendered without someone consciously asserting the review
   happened, and a grep for `securityReviewed: false` lists everything pending.
   -------------------------------------------------------------------------- */

export type Register = "day" | "night";

export type Photo = {
  src: string;
  /**
   * Alt text. Brand Guidelines §7 asks that it "convey atmosphere as well as
   * content" — but alt text is COPY, so it inherits the layout constraint
   * above. "View from the firing point toward the rear exit" is perfectly good
   * atmospheric alt text and also a facility-layout disclosure.
   *
   * Describe material, light and mood. Never spatial relationships or egress.
   */
  alt: string;
  width: number;
  height: number;
  /** Day sells that it is serious; night makes people want to be there. */
  register: Register;
  /**
   * Confirms this frame was reviewed against the §7 hard constraint.
   * Required, no default. `false` blocks nothing technically — it is a
   * declaration, and the pre-launch review greps for it.
   */
  securityReviewed: boolean;
  /**
   * Low-quality image placeholder — a base64 blur or dominant colour, used to
   * hold layout and give the hero something to show on slow Nigerian mobile
   * data before the full frame arrives.
   */
  blurDataURL?: string;
};

/* ---------------------------------------------------------------------------
   DISCIPLINES — spec §3, The Ranges

   Four distinct things to do. The 10m air rifle line gets prominence: it is
   the most beginner-accessible, the future home of Leagues, and the only one
   that scores itself.
   -------------------------------------------------------------------------- */

export type ScoringType = "automatic" | "manual";

export type Discipline = {
  slug: string;
  /** e.g. "10m air rifle" */
  name: string;
  /** Distance in metres, rendered with tabular numerals. */
  distanceM: number;
  /**
   * Lane count. `PENDING` where the documents do not state it — the 10m
   * pistol line is described only as "covered outdoor firing line", so its
   * lane count is outstanding from Operations.
   *
   * Pending rather than 0: a zero renders as "0 lanes", which is a falsehood,
   * and §9 requires every claim to be true on the day it ships.
   */
  lanes: Pending<number>;
  scoring: ScoringType;
  /** "Indoor", "Covered outdoor firing line" — never layout detail. */
  setting: string;
  /**
   * One or two sentences of character. Voice: "State facts rather than
   * adjectives. 'Eight lanes, machine-scored' beats 'world-class facilities.'"
   */
  summary: string;
  /** Air rifle leads the page and the homepage module. */
  featured?: boolean;
  photo?: Photo;
  /** Factual rows for the specification table. */
  specifications?: SpecRow[];
};

export type SpecRow = {
  label: string;
  /** Strings so units travel with the number: "10 m", "8", "Automatic". */
  value: string;
};

/* ---------------------------------------------------------------------------
   MEMBERSHIP TIERS

   Design Spec §9, acceptance criterion, verbatim:
       "No membership price is published anywhere on the public site."

   And §3: prices are "gated: display 'On application' with an enquiry CTA,
   not a number."

   `price` is therefore a literal type with exactly one legal value. A number,
   a currency string, or "From ₦250,000" is a COMPILE ERROR, not a review
   finding. This is the single most easily-broken rule in the specification —
   it breaks the first time someone helpfully adds a price to reduce enquiry
   friction — so it is the one most worth making impossible.
   -------------------------------------------------------------------------- */

export const GATED_PRICE = "On application" as const;
export type GatedPrice = typeof GATED_PRICE;

export type Tier = {
  slug: string;
  /** PENDING until the founder settles tier names (open decision, Brief). */
  name: string;
  /** One line of positioning — what this tier IS, not what it costs. */
  positioning: string;
  /** What belonging at this level means. Access to a room, not a subscription. */
  inclusions: string[];
  /** Not a price. Cannot be a price. See above. */
  price: GatedPrice;
  /**
   * Access register (Brand Guidelines §4). The top tier is the physical home
   * of the VIP deck, so it carries VIP Teal; lower tiers stay neutral.
   */
  register: "neutral" | "member" | "vip";
  /**
   * Founding-cohort framing. Subject to the founder's open decision on whether
   * the cap is real and named. Hidden until resolved rather than invented.
   */
  founding?: {
    /** What founders receive that later members never can. */
    benefit: string;
    /** Only rendered if the cap is genuine and permanent. */
    cap: Pending<number>;
  };
};

/* ---------------------------------------------------------------------------
   THE RITUAL — spec §5, "the single most important content component"

   The First Visit page, step by step: arrival and check-in, briefing,
   supervision by a range officer, equipment issued, the round itself, results.
   "Told plainly and in sequence." Anxiety is the conversion killer.
   -------------------------------------------------------------------------- */

export type RitualStep = {
  /** Short and concrete: "Arrive and check in". */
  title: string;
  /**
   * Two or three plain sentences. Address the beginner directly, without
   * condescension — "assume intelligence, not knowledge".
   */
  body: string;
};

/* ---------------------------------------------------------------------------
   LEGITIMACY — spec §3, Sport & Competition

   CLAIMS DISCIPLINE, quoted: "'Built to international competition standard' is
   a credibility claim true from opening. 'Host of the national championships'
   is a fact that can only be published once it has happened. Do not spend a
   claim that cannot yet be cashed — the audience that matters will check."

   `evidence` is required. A credential nobody can substantiate is not a
   credential, and the institutional audience is precisely the one that checks.
   -------------------------------------------------------------------------- */

export type Credential = {
  label: string;
  /** What substantiates this. Not published — it is the internal record. */
  evidence: string;
  /**
   * `true` only when the claim is true TODAY. Anything aspirational stays
   * false and does not render, however likely it is to become true.
   */
  trueOnDayOne: boolean;
};
