import type { MetadataRoute } from "next";
import { routes, site } from "@/lib/site";

/* ============================================================================
   sitemap.xml

   Public routes only. Two categories are deliberately excluded:

   · /institutional — unlisted by specification. Sent after a meeting, linked
     from nowhere, and it must not be discoverable through the sitemap.
   · /brand and /brand/components — internal design and component references.

   Priorities follow the spec §2 sitemap column rather than being guessed:
   Critical → 1.0 / 0.9, High → 0.8, Medium → 0.6, Required → 0.3.

   Sitemap entries require absolute URLs, so this returns nothing until the
   canonical domain is confirmed. Emitting a sitemap against a placeholder
   origin would publish wrong canonical URLs, which is harder to undo than a
   missing sitemap. Tracked as a gate blocker (`domain`).
   ========================================================================= */

type Entry = { path: string; priority: number; changeFrequency: "monthly" | "yearly" };

const PUBLIC_ROUTES: readonly Entry[] = [
  { path: routes.home, priority: 1.0, changeFrequency: "monthly" },
  { path: routes.membership, priority: 0.9, changeFrequency: "monthly" },
  { path: routes.firstVisit, priority: 0.9, changeFrequency: "monthly" },
  { path: routes.enquire, priority: 0.9, changeFrequency: "monthly" },
  { path: routes.ranges, priority: 0.8, changeFrequency: "monthly" },
  { path: routes.theClub, priority: 0.8, changeFrequency: "monthly" },
  { path: routes.sport, priority: 0.8, changeFrequency: "monthly" },
  { path: routes.groups, priority: 0.6, changeFrequency: "monthly" },
  { path: routes.leagues, priority: 0.6, changeFrequency: "monthly" },
  { path: routes.privacy, priority: 0.3, changeFrequency: "yearly" },
  { path: routes.terms, priority: 0.3, changeFrequency: "yearly" },
  { path: routes.refunds, priority: 0.3, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  if (!site.origin) return [];

  const lastModified = new Date();

  return PUBLIC_ROUTES.map((entry) => ({
    url: new URL(entry.path, site.origin!).toString(),
    lastModified,
    changeFrequency: entry.changeFrequency,
    priority: entry.priority,
  }));
}
