/**
 * THE THREE DISCIPLINES — real content.
 *
 * Every fact here is drawn directly from the source documents (Brief, "What we
 * are actually selling"; Design Spec §3, The Ranges). Nothing is invented.
 *
 * Outstanding from Operations (spec §8): per-discipline specification tables —
 * exact distances, safety systems and targeting technology. Those populate
 * `specifications` and render through SpecificationTable. The cards below work
 * without them.
 *
 * Photography is outstanding from the Founder. Each card names the frame it is
 * waiting for, from the §7 shot list.
 */

import type { Discipline } from "@/lib/content";
import { PENDING } from "@/lib/site";

export const disciplines: readonly Discipline[] = [
  {
    slug: "10m-air-rifle",
    name: "10m air rifle",
    distanceM: 10,
    lanes: 8,
    scoring: "automatic",
    setting: "Indoor, with adjoining bar seating and a viewing rail",
    /* Three strategic roles in one space, per the Brief: the beginner entry
       point, the Leagues home, and "the most commercially important space in
       the building". Also the least intimidating discipline — low recoil, low
       noise, Olympic-coded. */
    summary:
      "Eight lanes with automatic targeting and scoring. Low recoil, low noise, and the discipline most Olympic marksmen start with. The bar seating looks directly onto the firing line, so you can bring someone who has no intention of shooting.",
    featured: true,
  },
  {
    slug: "50m-range",
    name: "50m range",
    distanceM: 50,
    lanes: 6,
    scoring: "manual",
    setting: "Indoor firing point with a viewing rail",
    summary:
      "Six lanes at fifty metres, scored by a professional. This is the range that carries the competition standard.",
  },
  {
    slug: "10m-pistol",
    name: "10m pistol",
    distanceM: 10,
    /* Not stated in the source documents — outstanding from Operations. */
    lanes: PENDING,
    scoring: "manual",
    setting: "Covered outdoor firing line with multiple target frames",
    summary:
      "A covered outdoor line at ten metres with multiple target frames, scored by a professional.",
  },
];

export const featuredDiscipline = disciplines.find((d) => d.featured)!;
