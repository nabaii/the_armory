"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { primaryNav, routes } from "@/lib/site";
import { CentreDot } from "@/components/brand/Reticle";

/* ============================================================================
   DESKTOP NAVIGATION — the header's only client island.

   The hero itself ships zero client JavaScript, which is what the 2.5s LCP
   target on mid-range Android actually depends on. This island exists for the
   active-route indicator, which needs the current pathname.

   The active indicator is the centre dot, per Brand Guidelines §8 — "a single
   red dot as marker: list bullets, active navigation, map pins, current
   position on a ladder". It is paired with a font-weight change so the state
   is not conveyed by colour alone (WCAG 1.4.1).

   ----------------------------------------------------------------------------
   WHAT USED TO BE HERE

   A mobile panel: a hamburger trigger, a full-screen dialog, a focus trap,
   Escape handling and a scroll lock. All of it is gone, replaced by the
   permanently visible tab bar in BottomNav.tsx.

   The accessibility machinery went with it, and that is the quiet win. A modal
   navigation panel has to be TOLD not to leak focus to the page behind it, and
   the correctness of that is invisible until it breaks. A bar of five links
   that is always on screen has no trap to escape, no open state to manage, no
   focus to return, and no failure mode where the page scrolls underneath it.

   `primaryNav` still drives this nav. The tab bar deliberately uses a separate
   list — a marketing nav and a thumb-reachable app nav are different problems.
   See the note at the top of src/lib/app-nav.ts.
   ========================================================================= */

function isActive(pathname: string, href: string) {
  if (href === routes.home) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Nav() {
  const pathname = usePathname();

  return (
    /* Five items maximum (spec §2). Rendered only above `lg`; the enclosing
       block in Header.tsx is what hides it, so there is no second breakpoint
       to keep in step here.

       `shrink-0` on the items and `whitespace-nowrap` on the labels. Without
       both, flex shrinking wrapped every multi-word label onto two lines at
       every desktop width — measured at 1024, 1280, 1440 and 1600. A nav item
       is either on one line or it does not belong in the nav; wrapping made
       the header 45px of ragged text.

       The gap opens at `xl` rather than starting wide. Five items means four
       gaps, so every step here costs 32px of header — and at 1024px the header
       did not have 32px to give: measured, it wanted 1102px of content in a
       1024px viewport and ran 79px past its own right gutter. That had been
       true since this nav was written and was invisible because
       `body { overflow-x: hidden }` clips rather than scrolls. 16px still
       clears the 8px rhythm and reads as deliberate; the wider setting returns
       at 1440 where there is room for it. */
    <nav aria-label="Primary">
      <ul className="flex items-center gap-2 xl:gap-4">
        {primaryNav.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "u-kicker inline-flex items-center gap-1 py-1 no-underline",
                  "whitespace-nowrap",
                  "transition-colors duration-[var(--duration-fast)]",
                  active
                    ? "text-reticle-black"
                    : "text-sight-ink hover:text-reticle-black",
                )}
              >
                {active && <CentreDot className="size-[5px]" />}
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
