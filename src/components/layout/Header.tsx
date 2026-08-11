import Link from "next/link";
import { Container } from "@/components/layout/Container";
import { Lockup } from "@/components/brand/Lockup";
import { Nav } from "@/components/layout/Nav";
import { Button } from "@/components/ui/Button";
import { cta, routes, site } from "@/lib/site";

/* ============================================================================
   HEADER

   Spec §5: five nav items maximum, sticky on scroll, persistent Apply CTA on
   desktop, condensed on mobile. Brand Guidelines §10: full lockup in the header.

   ----------------------------------------------------------------------------
   TWO HEADERS, BECAUSE THERE ARE NOW TWO PRODUCTS

   Above `lg` this is the website's header and it is unchanged: a solid Chalk
   bar, a hairline rule, five nav items, a persistent Apply CTA. Everything
   below still applies there.

   Below `lg` it is an installed app's title bar. It carries the lockup and
   nothing else, because the navigation moved to the thumb — see BottomNav.tsx.
   What was removed, and why:

     the hamburger    Replaced outright. A menu button in the top-left corner
                      of a phone is the single detail that marks a product as a
                      website; it is also the corner a thumb cannot reach. The
                      five destinations it hid are now permanently visible at
                      the bottom of the screen.
     the Apply link   Redundant. Apply is slot 5 of the tab bar on every screen
                      a signed-out visitor sees, rendered as a filled accent —
                      a far better target than a 66px text link was.

   That frees the entire top-right budget, which is what the long measurement
   note that used to live here was fighting over. The arithmetic is no longer
   contested: at 320px the bar holds a 191px lockup inside 16px gutters and has
   97px spare.

   ----------------------------------------------------------------------------
   WHY THE MOBILE BAR IS NOW GLASS, WHEN THIS FILE USED TO FORBID IT

   It forbade it for two reasons and both were right. The one that still binds
   is §3 misuse: "Do not place the full lockup over busy photography. Use a
   clear zone or a single-colour variant." This bar carries the lockup and it
   does overlay the hero.

   So it uses `.u-glass-strong` — a 78% Chalk tint, not the 62% the tab bar
   uses. At 78% the backdrop is no longer legible as photography; it is a warm
   frosted plate. That IS the clear zone §3 asks for, and it is a stronger
   guarantee than the old solid bar gave, because the old bar simply started
   the hero underneath itself and never proved anything about what sat behind.
   Measured: Reticle Black on the strong tint over a pure black backdrop is
   7.81:1. The derivation is in glass.css.

   The performance objection does not survive the change of scale. It was
   written about blurring a full-bleed hero; this is a 72px bar, roughly 9% of
   a 360x800 viewport, at a 12px radius rather than the 30-40px the style
   usually reaches for, and it degrades to a solid fill wherever the platform
   or the user's preferences ask it to.
   ========================================================================= */

export function Header() {
  return (
    <header
      className={[
        "sticky top-0 z-50",
        /* Under `viewport-fit=cover` the status bar sits inside the viewport
           once installed, so the bar carries that inset itself. `--safe-t` is
           0 in a browser tab, so this changes nothing off-device. */
        "pt-[var(--safe-t)]",
        /* Desktop: the solid bar, exactly as before. */
        "lg:bg-chalk lg:border-b lg:border-sight-grey/25",
        /* The header is a light ground on both sides of the breakpoint, so CTA
           colours resolve correctly. Declared here rather than inherited from
           the glass layer below, which is a sibling of the content. */
        "[--ink:var(--color-reticle-black)]",
        "[--btn-fill:var(--color-ten-ring-deep)] [--btn-fill-ink:#fff]",
      ].join(" ")}
    >
      {/* The material, as its own layer rather than as classes on the header.
          `.u-glass` sets `backdrop-filter`, and there is no clean way to
          unset that at a breakpoint with utilities — so the glass is simply
          not rendered above `lg`, where the solid bar takes over. */}
      <span
        aria-hidden="true"
        className="u-glass u-glass-strong u-glass-edge-bottom absolute inset-0 lg:hidden"
      />

      <Container className="relative flex h-[var(--header-h)] items-center justify-between gap-1 sm:gap-2">
        {/* Home link. The lockup is `decorative` so the accessible name comes
            from the anchor once, rather than being announced twice. */}
        {/* The lockup is pinned to a fixed size here rather than riding the h3
            type token as it does elsewhere. A logo is identity, not copy: it
            has no reason to grow 15% between a phone and a desktop, and in
            this particular bar every pixel it takes is a pixel the five-item
            nav does not have at 1024px, which is the tightest width on the
            site. 19px is the token's own value at the low end, so the header
            mark renders exactly as it always has on mobile. */}
        <Link
          href={routes.home}
          className="shrink-0 no-underline [--lockup-fs:1.1875rem]"
          aria-label={`${site.legalName} — home`}
        >
          <Lockup decorative className="text-reticle-black" />
        </Link>

        {/* Desktop only. Below `lg` the tab bar carries both of these. */}
        <div className="hidden shrink-0 items-center gap-1 lg:flex xl:gap-4">
          <Nav />
          <Button
            href={cta.primary.href}
            variant="primary"
            className="whitespace-nowrap"
          >
            {cta.primary.shortLabel}
          </Button>
        </div>
      </Container>
    </header>
  );
}
