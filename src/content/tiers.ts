/**
 * MEMBERSHIP TIERS — deliberately empty.
 *
 * The Brief lists tier count, names and structure as an OPEN DECISION:
 *
 *   "Three tiers assumed: an entry / frequent-visitor pass, a full membership
 *    (the actual club), and a scarce, status-priced top tier (capped, possibly
 *    founder-only). Required to write enquiry routing and design the membership
 *    page. Are names given, or scoped to this project?"
 *
 * Spec §9 also names the tier structure as one of three decisions that block
 * work. So this file is the seam: the components, layout, register colours,
 * per-tier CTAs and enquiry routing are all built and working, and the moment
 * the founder supplies names and inclusions they land here and the page is
 * finished. No rebuild, no redesign.
 *
 * It is empty rather than pre-filled with plausible names because tier names
 * are positioning, not placeholders — inventing them would put words in the
 * founder's mouth and then route real enquiries against them.
 *
 * `TierComparison` and `ApplicationForm` both render an explicit outstanding
 * state while this is empty. See src/lib/fixtures.ts for the reference-page
 * samples that demonstrate the populated layout.
 *
 * Reminder when populating: `price` accepts exactly one value, `"On
 * application"`. A figure is a compile error, by design.
 */

import type { Tier } from "@/lib/content";

export const tiers: readonly Tier[] = [];
