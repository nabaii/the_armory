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
   WHY THIS IS A SOLID BAR AND NOT A TRANSLUCENT OVERLAY

   The obvious treatment for a photography-led site is a transparent header
   floating over the full-bleed hero. Two rules rule it out, and it is worth
   recording so it is not reintroduced later as a "polish" change:

   1. §3 misuse: "Do not place the full lockup over busy photography. Use a
      clear zone or a single-colour variant." A header that overlays the hero
      puts the full lockup over exactly that, on the site's most important
      screen and on every reload.
   2. Performance: `backdrop-filter` is expensive on the mid-range Android
      hardware the 2.5s LCP target is measured against.

   So: a solid Chalk bar with a hairline rule, and the hero begins beneath it.
   The brand guidelines settled the layout question, not taste.
   ========================================================================= */

export function Header() {
  return (
    <header
      className={[
        "sticky top-0 z-50 h-[var(--header-h)]",
        "bg-chalk",
        "border-b border-sight-grey/25",
        // The header is a light ground, so CTA colours resolve correctly.
        "[--ink:var(--color-reticle-black)]",
        "[--btn-fill:var(--color-ten-ring-deep)] [--btn-fill-ink:#fff]",
      ].join(" ")}
    >
      <Container className="flex h-full items-center justify-between gap-1 sm:gap-2">
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

        <div className="flex shrink-0 items-center gap-1 sm:gap-2 xl:gap-4">
          <Nav />

          {/* Desktop: the persistent Apply CTA, per spec §5.

              Measured before this was written: with the full "Apply for
              membership" label the button was 233px wide and 88px tall inside an
              80px header — it wrapped to two lines and overflowed the bar
              vertically, which is what made it look like it was bleeding off the
              top-right corner.

              The short label fixes it at source. The header CTA sits beside a
              lockup that already says what the club is, so "Apply" is
              unambiguous there; the full phrase still carries every hero and
              in-page CTA, where it has the room and does the persuading. */}
          <div className="hidden lg:block">
            <Button
              href={cta.primary.href}
              variant="primary"
              className="whitespace-nowrap"
            >
              {cta.primary.shortLabel}
            </Button>
          </div>

          {/* Mobile: condensed. A text link rather than a filled button —
              there are ~120px left beside the lockup, and a filled button at
              that width would either clip the label or push the lockup below
              its legible minimum.

              ------------------------------------------------------------------
              THE BUDGET, RE-MEASURED

              This block previously carried the note "24 + 140 + 12 + 45 + 12 +
              44 + 24 = 301px, so it clears a 320px viewport with room". Every
              term in it was wrong, and the sum was checked against the wrong
              number, so it read as verified when it had never been measured in
              a browser:

                lockup   191px, not 140. 140px is the §3 MINIMUM, and the
                         minimum cannot bind — see the note in Lockup.tsx. The
                         sum used the floor as though it were the actual width.
                gaps     16px, not 12. --spacing is 8px here, so gap-2 is 16.
                Apply    66px, not 45.
                gutters  24px each side, which was the one correct term.

              Actual: 24 + 191 + 16 + 44 + 16 + 66 + 24 = 381px. The header
              overflowed a 320px viewport by 37px and had done since it was
              written — invisibly, because `body { overflow-x: hidden }` in
              base.css turns an overflow into a silent clip. `npm run
              responsive` is what caught it, and exists so the next one is
              caught in CI rather than on someone's phone.

              At 16px gutters (Container, below sm) the budget now reads:

                320px   16 + 191 + 8 + 44 + 16          = 275  ✓  Apply hidden
                360px   16 + 191 + 8 + 44 + 8 + 66 + 16 = 349  ✓  all present
                390px   same 349, with 41px to spare    ✓

              Below 360px the Apply link is withdrawn rather than the lockup
              being shrunk. Two reasons. The brand mark is first contact and §2
              makes the descriptor non-negotiable, so degrading it to keep a
              66px text link is the wrong trade; and the link is not lost — the
              menu panel one tap away opens with "Apply for membership" as a
              full-width primary CTA, which is a better target than this link
              on a 320px screen anyway. */}
          <Link
            href={cta.primary.href}
            className={[
              "u-kicker lg:hidden",
              "max-[359px]:hidden",
              "flex min-h-6 items-center px-1",
              "text-reticle-black underline decoration-1 underline-offset-4",
            ].join(" ")}
          >
            Apply
          </Link>
        </div>
      </Container>
    </header>
  );
}
