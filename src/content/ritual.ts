/**
 * THE FIRST VISIT, STEP BY STEP — draft copy.
 *
 * The sequence is specified, not invented. Design Spec §3, The First Visit:
 * "Arrival and check-in, briefing, supervision by a range officer, equipment
 * issued, the round itself, results. Told plainly and in sequence."
 *
 * ---------------------------------------------------------------------------
 * DRAFT — requires Operations to confirm operational accuracy, specifically:
 *   · whether the briefing precedes or follows equipment issue
 *   · the actual round length and shot count for a first visit
 *   · whether results are printed, emailed, or shown on screen
 *
 * The words are ours; the facts must be theirs. Nothing here states a price,
 * a duration or a guarantee that Operations has not confirmed.
 * ---------------------------------------------------------------------------
 *
 * Voice, per Brand Guidelines §9: short sentences, plain words, facts rather
 * than adjectives. Address the beginner and the spectator directly, without
 * condescension — "assume intelligence, not knowledge". Describe the sport,
 * the standard and the hospitality; never the weapon.
 *
 * This page exists to remove fear. The Brief: "Anxiety is the conversion
 * killer", and this is "the highest-leverage page on the site for the growth
 * segment — women, first-timers, couples, corporate groups."
 */

import type { RitualStep } from "@/lib/content";

export const ritual: readonly RitualStep[] = [
  {
    title: "Arrive and check in",
    body:
      "Come as you are. Reception will have your booking, and someone will meet you and take you through what the evening looks like. You do not need to bring anything with you.",
  },
  {
    title: "Your briefing",
    body:
      "A short, plain explanation of how the range works and what you will be doing. No prior knowledge is assumed, and no question is too basic to ask. Everyone who shoots here has had this briefing.",
  },
  {
    title: "Equipment is issued",
    body:
      "Everything is provided — the rifle, the ammunition, eye and ear protection. All firearms belong to the range and never leave it. You will not be asked to own, licence or transport anything.",
  },
  {
    title: "A range officer stays with you",
    body:
      "A professional is on the line with you for the whole session. They set you up, correct your position, and stay within arm's reach. Nobody shoots unsupervised.",
  },
  {
    title: "The round",
    body:
      "A set number of shots at a set distance. On the air rifle line the targets score themselves, so you see each shot register as you take it. Most people find their group tightens noticeably by the end.",
  },
  {
    title: "Your results",
    body:
      "You leave with your score. If you enjoyed it, the same round is what our leagues are built on — and many of our members started with exactly this visit.",
  },
];

/**
 * What to wear and bring — spec §3: "Concrete, short, practical."
 * Draft. Operations to confirm footwear requirements.
 */
export const whatToBring: readonly string[] = [
  "Flat, closed shoes. No open toes on the firing line.",
  "Clothing you can stand and hold still in. Nothing loose at the wrist.",
  "Long hair tied back.",
  "Nothing else. Equipment, protection and ammunition are all provided.",
];
