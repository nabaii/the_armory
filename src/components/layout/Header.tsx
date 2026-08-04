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
      <Container className="flex h-full items-center justify-between gap-2">
        {/* Home link. The lockup is `decorative` so the accessible name comes
            from the anchor once, rather than being announced twice. */}
        <Link
          href={routes.home}
          className="shrink-0 no-underline"
          aria-label={`${site.legalName} — home`}
        >
          <Lockup decorative className="text-reticle-black" />
        </Link>

        <div className="flex shrink-0 items-center gap-2 lg:gap-3 xl:gap-4">
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
              there are ~120px left beside a 140px minimum lockup, and a
              filled button at that width would either clip the label or push
              the lockup below its legible minimum. */}
          <Link
            href={cta.primary.href}
            className={[
              "u-kicker lg:hidden",
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
