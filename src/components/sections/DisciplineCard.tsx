import { cn } from "@/lib/cn";
import { Body, Caption, Data, H3, Kicker } from "@/components/ui/Text";
import { ImageSlot } from "@/components/media/ImageSlot";
import { CentreDot } from "@/components/brand/Reticle";
import type { Discipline } from "@/lib/content";

/* ============================================================================
   DISCIPLINE CARD — spec §5: "Per-range module: name, distance, lanes, scoring
   type, image. Reused across Ranges and Home."

   Voice rule this component exists to enforce (Brand Guidelines §9): "State
   facts rather than adjectives. 'Eight lanes, machine-scored' beats
   'world-class facilities.'" So the card leads with the specification line and
   there is no slot for a marketing adjective. The facts ARE the claim — they
   are what substantiates "built to international competition standard".

   The 10m air rifle line takes the `featured` variant. Spec §3: "Give it
   prominence: most beginner-accessible, and the future home of Leagues." It is
   also the only discipline that scores itself, which is why Leagues anchors
   there — machine-scored results are trusted by default.
   ========================================================================= */

export function DisciplineCard({
  discipline,
  className,
}: {
  discipline: Discipline;
  className?: string;
}) {
  const {
    name,
    distanceM,
    lanes,
    scoring,
    setting,
    summary,
    photo,
    featured,
  } = discipline;

  return (
    <article
      className={cn(
        featured && "lg:grid lg:grid-cols-2 lg:items-center lg:gap-6",
        className,
      )}
    >
      <ImageSlot
        photo={photo}
        awaiting={`${name} — ${featured ? "the firing line, lanes and lighting" : "firing line"}`}
        aspect={featured ? "wide" : "landscape"}
        layout={featured ? "half" : "third"}
      />

      <div className={cn("mt-2", featured && "lg:mt-0")}>
        {/* Machine-scored disciplines say so, prominently. Score integrity is
            the load-bearing problem for Leagues, and automatic scoring is the
            proof of the competition-standard claim. */}
        {scoring === "automatic" && (
          <Kicker className="mb-1 flex items-center gap-1" muted={false}>
            <CentreDot className="size-[5px]" />
            Automatic scoring
          </Kicker>
        )}

        <H3>{name}</H3>

        {/* The specification line. Tabular numerals; facts, not adjectives.
            An unknown lane count is omitted rather than rendered as zero —
            "0 lanes" is a falsehood, and §9 requires every claim to be true on
            the day it ships. The line reads correctly without it. */}
        <Data as="p" muted className="mt-1">
          {distanceM} m
          {lanes !== null && (
            <>
              <Separator />
              {lanes} {lanes === 1 ? "lane" : "lanes"}
            </>
          )}
          <Separator />
          {scoring === "automatic" ? "Machine-scored" : "Scored by a professional"}
        </Data>

        <Caption className="mt-[2px]">{setting}</Caption>

        <Body muted className="mt-2">
          {summary}
        </Body>
      </div>
    </article>
  );
}

/** Middle dot separator, spaced and non-announcing. */
function Separator() {
  return (
    <span aria-hidden="true" className="px-1 opacity-50">
      ·
    </span>
  );
}

/**
 * The grid used on both /ranges and the homepage range module.
 * Featured disciplines break out to full width; the rest sit three-up.
 */
export function DisciplineGrid({
  disciplines,
  className,
}: {
  disciplines: readonly Discipline[];
  className?: string;
}) {
  const featured = disciplines.filter((d) => d.featured);
  const rest = disciplines.filter((d) => !d.featured);

  return (
    <div className={cn("flex flex-col gap-8", className)}>
      {featured.map((d) => (
        <DisciplineCard key={d.slug} discipline={d} />
      ))}
      {rest.length > 0 && (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {rest.map((d) => (
            <DisciplineCard key={d.slug} discipline={d} />
          ))}
        </div>
      )}
    </div>
  );
}
