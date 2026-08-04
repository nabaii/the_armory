import { cn } from "@/lib/cn";
import { Container } from "@/components/layout/Container";
import { CtaPair } from "@/components/ui/Button";
import { Display, Kicker, Lead } from "@/components/ui/Text";
import { ImageSlot } from "@/components/media/ImageSlot";
import type { Photo } from "@/lib/content";

/* ============================================================================
   HERO — spec §5: full-bleed image, headline, sub-line, dual CTA.

   The hierarchy, from the Brief: the headline carries the competition-standard
   claim ("the single most powerful claim available — it does the work of a
   hundred adjectives"), and the sub-line carries the welcome. "The headline
   sells the club; the second line rescues the hesitant. Lose the second line
   and you sell only to people who already feel entitled to be there."

   The sub-line is typography, not a badge or a pill. As a UI element it reads
   as an apology for the sport rather than a welcome into it.

   ----------------------------------------------------------------------------
   TWO REGISTERS, ONE COMPONENT

   photographic — full-bleed frame with the derived scrim (see .u-hero-zone in
       base.css). Text sits in the lower-left third, which is also the
       text-safe zone the photographer is briefed to leave clear.

   typographic — no photograph: Chalk ground, Reticle Black type, no scrim.

   The fallback is not a placeholder. Photography is the critical path, and if
   the shoot slips this is what launches: a spare, confident, typographic hero
   that is entirely on-brand. It exists so that "no photography yet" never
   becomes an argument for shipping an architectural render as a room.
   ========================================================================= */

export function Hero({
  headline,
  subline,
  kicker,
  primary,
  secondary,
  photo,
  awaiting,
}: {
  /** The competition-standard claim. True from opening day. */
  headline: string;
  /** The welcome. Everything provided; no experience needed. */
  subline: string;
  /** Small-caps label above the headline — typically the location credential. */
  kicker?: string;
  primary: { href: string; label: string };
  secondary: { href: string; label: string };
  photo?: Photo;
  /** Which frame from the §7 shot list this slot is waiting for. */
  awaiting: string;
}) {
  if (!photo) return <TypographicHero {...{ headline, subline, kicker, primary, secondary, awaiting }} />;

  return (
    <section
      className={cn(
        "relative isolate flex flex-col justify-end",
        "min-h-[560px] lg:min-h-[calc(100svh-var(--header-h))] lg:max-h-[860px]",
        // Chalk type on the scrim, so CTAs and text resolve to the dark register.
        "[--ink:var(--color-chalk)] [--ink-muted:var(--color-terrazzo)]",
        "[--btn-fill:var(--color-chalk)] [--btn-fill-ink:var(--color-reticle-black)]",
      )}
    >
      {/* The photograph. `priority` because this is the LCP element. */}
      <div className="absolute inset-0 -z-10">
        <ImageSlot
          photo={photo}
          awaiting={awaiting}
          aspect="fill"
          layout="full"
          priority
          className="h-full w-full"
          /* Bias the crop away from the text zone on narrow viewports, so the
             subject is not sitting behind the headline on a phone. */
          imageClassName="object-[68%_center] lg:object-center"
        />
      </div>

      {/* Aesthetic gradient only — no contrast guarantee is claimed here. */}
      <div className="u-hero-veil -z-10" aria-hidden="true" />

      {/* The guaranteed zone. Flat 0.80 Charred Timber: 7.32:1 for Chalk text
          against a pure-white photograph, worst case. Feathered above. */}
      <div className="u-hero-zone">
        <Container className="py-6 lg:py-8">
          <div className="max-w-[46rem]">
            {kicker && <Kicker className="mb-3">{kicker}</Kicker>}
            <Display>{headline}</Display>
            <Lead muted className="mt-3">
              {subline}
            </Lead>
            <CtaPair primary={primary} secondary={secondary} className="mt-4" />
          </div>
        </Container>
      </div>
    </section>
  );
}

/**
 * The no-photography register. Same hierarchy, no scrim, Chalk ground.
 * The reserved frame sits alongside rather than behind the type, so the
 * outstanding shot stays visible to the team without pretending to be a hero.
 */
function TypographicHero({
  headline,
  subline,
  kicker,
  primary,
  secondary,
  awaiting,
}: {
  headline: string;
  subline: string;
  kicker?: string;
  primary: { href: string; label: string };
  secondary: { href: string; label: string };
  awaiting: string;
}) {
  return (
    <section
      className={cn(
        "bg-chalk py-12 lg:py-16",
        "[--ink:var(--color-reticle-black)] [--ink-muted:var(--color-sight-ink)]",
        "[--btn-fill:var(--color-ten-ring-deep)] [--btn-fill-ink:#fff]",
      )}
    >
      <Container>
        <div className="grid gap-6 lg:grid-cols-2 lg:items-center lg:gap-8">
          <div>
            {kicker && <Kicker className="mb-3">{kicker}</Kicker>}
            <Display>{headline}</Display>
            <Lead muted className="mt-3">
              {subline}
            </Lead>
            <CtaPair primary={primary} secondary={secondary} className="mt-4" />
          </div>
          <div className="lg:order-last">
            <ImageSlot awaiting={awaiting} aspect="portrait" layout="half" />
          </div>
        </div>
      </Container>
    </section>
  );
}
