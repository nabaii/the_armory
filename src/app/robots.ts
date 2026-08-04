import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

/* ============================================================================
   robots.txt

   ----------------------------------------------------------------------------
   WHY THE PRIVATE ROUTES ARE NOT LISTED HERE

   The instinct is to add `Disallow: /institutional` and `Disallow: /brand`.
   That would be a mistake, for two reasons:

   1. robots.txt IS A PUBLIC DOCUMENT. Listing a private path advertises that
      the path exists. On a site whose Brief identifies its own data as "an
      attractive target", publishing a directory of the pages we would rather
      nobody read is precisely the wrong move. It is the first file an attacker
      or a curious journalist opens.

   2. DISALLOW DOES NOT MEAN DEINDEX. A disallowed URL can still be indexed if
      it is linked from anywhere, and because the crawler is forbidden from
      fetching it, it never sees the `noindex` directive that would remove it.
      The result is a URL in search results with no snippet — worse than either
      alternative.

   So private routes are kept out of the index by `robots: { index: false }` in
   their own metadata, which is the mechanism search engines document for this,
   and they are kept out of sitemap.ts. They are linked from nowhere public.

   And to be clear about what this file is not: none of the above is access
   control. `/institutional` is unlisted, not protected. If it ever carries real
   capability or client detail it needs a token or auth — see the note in that
   route.
   ========================================================================= */

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    /* Absolute URL required, so this appears only once the domain is confirmed.
       Tracked as a gate blocker (`domain`). */
    ...(site.origin ? { sitemap: `${site.origin}/sitemap.xml` } : {}),
  };
}
