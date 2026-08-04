import Image from "next/image";
import { cn } from "@/lib/cn";
import { Caption } from "@/components/ui/Text";
import { Pending } from "@/components/ui/Pending";
import type { Photo } from "@/lib/content";

/* ============================================================================
   IMAGE SLOT

   Photography is the critical path (Brief: "the one thing that gates
   everything"), and it is also the single largest asset class on a site with a
   1.5MB budget and a 2.5s LCP target on mid-range Android. Every image-bearing
   component therefore goes through here, for three reasons:

   1. PAGES CAN BE BUILT BEFORE THE SHOOT. With no photo, the slot renders a
      reserved frame at the correct aspect ratio naming the shot it is waiting
      for. Layout, rhythm and scroll depth are all developable now, and the
      frame is visible in development and silent in production.

   2. PERFORMANCE IS CENTRAL, NOT PER-CALL-SITE. `sizes` is derived from the
      declared layout rather than guessed, so the browser never downloads a
      2000px file to fill a 400px column. Everything is lazy except an
      explicitly declared priority image.

   3. NO ARCHITECTURAL RENDERS AS PHOTOGRAPHS. There is no code path that lets
      a render stand in for a room. Spec §9: every claim true on the day it
      goes live.
   ========================================================================= */

const ASPECT = {
  /** Hero and wide architectural frames. */
  wide: "aspect-16/9",
  /** Portrait — reception, equipment still life, instruction moments. */
  portrait: "aspect-4/5",
  /** Discipline cards and grid items. */
  landscape: "aspect-3/2",
  square: "aspect-square",
  /** Fills its container — for the full-bleed hero. */
  fill: "",
} as const;

/**
 * `sizes` per layout context. Declared once here so no call site has to reason
 * about breakpoints, and so a wrong value is fixed in one place.
 * Breakpoints are the project's own: 480 / 768 / 1024 / 1440.
 */
const SIZES = {
  /** Full-bleed, edge to edge at every width. */
  full: "100vw",
  /** Half of a 1280px container on desktop, full width below lg. */
  half: "(min-width: 1024px) 640px, 100vw",
  /** Three-up grid inside the container. */
  third: "(min-width: 1024px) 416px, (min-width: 768px) 50vw, 100vw",
  /** Two-up grid inside the container. */
  twoUp: "(min-width: 768px) 50vw, 100vw",
} as const;

export type ImageSlotProps = {
  photo?: Photo;
  /** Names the frame we are waiting for, from the §7 shot list. */
  awaiting: string;
  aspect?: keyof typeof ASPECT;
  layout?: keyof typeof SIZES;
  /**
   * Only the hero image on a page should be priority. It disables lazy loading
   * and preloads, which is exactly right once and wasteful twice.
   */
  priority?: boolean;
  className?: string;
  /** Applied to the <img>. Use for object-position on art-directed crops. */
  imageClassName?: string;
};

export function ImageSlot({
  photo,
  awaiting,
  aspect = "landscape",
  layout = "half",
  priority = false,
  className,
  imageClassName,
}: ImageSlotProps) {
  const frame = cn("relative overflow-hidden bg-terrazzo", ASPECT[aspect], className);

  if (!photo) {
    return (
      <div
        className={cn(
          frame,
          "grid place-items-center border border-sight-grey/40 p-3 text-center",
        )}
        data-awaiting={awaiting}
      >
        <div>
          <Pending label={awaiting} />
          <Caption className="mt-2 text-reticle-black">
            Reserved for commissioned photography
          </Caption>
        </div>
      </div>
    );
  }

  return (
    <div className={frame}>
      <Image
        src={photo.src}
        alt={photo.alt}
        fill
        sizes={SIZES[layout]}
        priority={priority}
        loading={priority ? undefined : "lazy"}
        placeholder={photo.blurDataURL ? "blur" : "empty"}
        blurDataURL={photo.blurDataURL}
        className={cn("object-cover", imageClassName)}
      />
    </div>
  );
}

/* ----------------------------------------------------------------------------
   FIGURE — image plus a restrained caption (spec §5, "Image + caption").
   ------------------------------------------------------------------------- */

export function Figure({
  caption,
  className,
  ...slot
}: ImageSlotProps & { caption?: string }) {
  return (
    <figure className={className}>
      <ImageSlot {...slot} />
      {caption && (
        <figcaption className="mt-1">
          <Caption>{caption}</Caption>
        </figcaption>
      )}
    </figure>
  );
}

/* ----------------------------------------------------------------------------
   IMAGE GRID — the two and three-up variants spec §5 asks for.

   `sizes` is selected from the column count rather than passed in, so a
   three-up grid cannot accidentally request full-width files.
   ------------------------------------------------------------------------- */

export function ImageGrid({
  items,
  columns = 2,
  className,
}: {
  items: Array<{ photo?: Photo; awaiting: string; caption?: string }>;
  columns?: 2 | 3;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-3",
        columns === 3 ? "md:grid-cols-2 lg:grid-cols-3" : "md:grid-cols-2",
        className,
      )}
    >
      {items.map((item) => (
        <Figure
          key={item.awaiting}
          photo={item.photo}
          awaiting={item.awaiting}
          caption={item.caption}
          aspect="landscape"
          layout={columns === 3 ? "third" : "twoUp"}
        />
      ))}
    </div>
  );
}
