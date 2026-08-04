/**
 * THE CLUB — hospitality spaces.
 *
 * Every space and its role is drawn from the source documents (Brief, "What we
 * are actually selling"; Design Spec §3, The Club). Nothing invented.
 *
 * Why this page exists at all, from the Brief: "The shooting is the anchor; the
 * hospitality is the dwell time. A range visit is forty-five minutes. An
 * evening here is four hours with food and drink attached — and dwell time is
 * where membership economics live." A range-only site would omit half the offer.
 *
 * Outstanding from Operations (spec §8): snack bar offer, deck capacities, VIP
 * deck access rules. Capacities are therefore absent rather than estimated.
 */

import type { Photo } from "@/lib/content";
import type { Ground } from "@/components/layout/Section";

export type Space = {
  slug: string;
  name: string;
  /**
   * Whether the space is indoors or out. A FACT about the space, not a
   * derivable one.
   *
   * This field exists because the page originally derived the label from the
   * layout index — `i % 2 === 0 ? "Inside" : "Outside"` — which alternated with
   * position rather than describing the room. It labelled the viewing rail
   * "outside" (it is indoors, overlooking the air rifle line) and the public
   * deck "inside" (it is outdoor seating). Two of four spaces were wrong.
   *
   * Nothing caught it: it typechecks, it passes the output audit, and there is
   * no forbidden string in it. It was visible only by looking at the page. The
   * voice rule is "state facts rather than adjectives" and §9 requires every
   * claim to be true on the day it ships — so the fact lives in the content.
   */
  location: "inside" | "outside";
  /**
   * Access register. Brand Guidelines §4: "Soffit Blue for the public deck,
   * VIP Teal for the VIP deck — carried into menus, table numbers and signage
   * so the tiering is felt, not announced."
   */
  register: Extract<Ground, "soffit" | "teal" | "terrazzo" | "charred">;
  summary: string;
  /** Which frame from the §7 shot list this space is waiting for. */
  awaiting: string;
  photo?: Photo;
};

export const spaces: readonly Space[] = [
  {
    slug: "snack-bar",
    name: "The snack bar",
    location: "inside",
    /* Open context — blue. Substantial indoor seating adjoining the air rifle
       range. "Converts a visit into an evening." */
    register: "soffit",
    summary:
      "Indoor seating with food and drink, adjoining the air rifle range. The pale blue soffit and the lit shelving are the first thing most people notice, and the reason a forty-five minute visit turns into an evening.",
    awaiting: "Snack bar interior (day and night registers)",
  },
  {
    slug: "viewing-rail",
    name: "The viewing rail",
    location: "inside",
    /* The single most commercially significant detail in the building. */
    register: "soffit",
    summary:
      "Bar seating and a rail directly overlooking the air rifle firing line. Bring someone who does not shoot: they have a seat, a drink and a clear view. The 50m range has a viewing rail too.",
    awaiting: "Air rifle bar seating — the viewing rail and stools (both registers)",
  },
  {
    slug: "public-deck",
    name: "The public deck",
    location: "outside",
    register: "soffit",
    summary:
      "Outdoor seating, lit after dark. Blue and teal furniture under painted soffits. Groups, corporate evenings, and anyone who would rather sit outside.",
    awaiting: "Public deck — light columns, glowing deck edge, occupied tables (night)",
  },
  {
    slug: "vip-deck",
    name: "The VIP deck",
    location: "outside",
    /* Member register — teal. "The physical home of the top membership tier."
       Positioned as member territory, not booked ad hoc. */
    register: "teal",
    summary:
      "A separate deck with lounge seating under tensile canopies. This is member territory rather than a space to book for an evening, and it is where the top tier of membership physically lives.",
    awaiting: "VIP deck — lounge seating, canopies, teal furniture (night)",
  },
];
