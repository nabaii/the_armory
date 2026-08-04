import { cn } from "@/lib/cn";

/* ============================================================================
   TYPE COMPONENTS — spec §6 type scale, Brand Guidelines §5 setting rules.

   All colour comes from `--ink` / `--ink-muted`, which the enclosing Section
   sets per ground. That is what makes the palette safe: a heading cannot be
   dropped onto VIP Teal in a colour that fails contrast, because it does not
   choose its own colour.

   Rules encoded here:
     · Never set body copy in the display face; never set headlines in a stencil.
     · Two weights only — Regular and Bold. No light weights.
     · Body measure capped at 68 characters.
     · Tabular numerals wherever numbers stack.
   ========================================================================= */

type TextProps = {
  children: React.ReactNode;
  className?: string;
  id?: string;
  muted?: boolean;
};

const ink = (muted?: boolean) =>
  muted ? "text-[var(--ink-muted)]" : "text-[var(--ink)]";

/**
 * Hero headline. Carries the competition-standard claim — the single most
 * powerful claim available, per the Brief.
 *
 * `wide` engages Archivo's width axis for the "governing body" register.
 */
export function Display({
  children,
  className,
  id,
  as: Tag = "h1",
  wide = true,
}: TextProps & { as?: "h1" | "h2" | "p" | "div"; wide?: boolean }) {
  return (
    <Tag
      id={id}
      className={cn(
        "text-display font-display",
        wide && "u-display-wide",
        ink(),
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function H1({ children, className, id }: TextProps) {
  return (
    <h1 id={id} className={cn("text-h1 font-display", ink(), className)}>
      {children}
    </h1>
  );
}

export function H2({
  children,
  className,
  id,
  as: Tag = "h2",
}: TextProps & { as?: "h2" | "h3" }) {
  return (
    <Tag id={id} className={cn("text-h2 font-display", ink(), className)}>
      {children}
    </Tag>
  );
}

export function H3({
  children,
  className,
  id,
  as: Tag = "h3",
}: TextProps & { as?: "h3" | "h4" }) {
  return (
    <Tag id={id} className={cn("text-h3 font-display", ink(), className)}>
      {children}
    </Tag>
  );
}

/**
 * Lead paragraph. On the homepage hero this is the line that rescues the
 * hesitant visitor — "no experience needed, everything is provided".
 *
 * It is typography, not a badge or a pill. The moment it becomes a UI element
 * it reads as an apology for the sport rather than a welcome to it.
 */
export function Lead({ children, className, id, muted }: TextProps) {
  return (
    <p id={id} className={cn("text-body-lg u-measure", ink(muted), className)}>
      {children}
    </p>
  );
}

export function Body({ children, className, id, muted }: TextProps) {
  return (
    <p id={id} className={cn("text-body u-measure", ink(muted), className)}>
      {children}
    </p>
  );
}

/** Captions, legal, metadata. */
export function Caption({
  children,
  className,
  id,
  muted = true,
  as: Tag = "p",
}: TextProps & { as?: "p" | "span" | "div" }) {
  return (
    <Tag id={id} className={cn("text-caption", ink(muted), className)}>
      {children}
    </Tag>
  );
}

/**
 * Small capitals with wide tracking. Section kickers and labels.
 * Echoes the lockup's squared descriptor and is a signature device (§5).
 *
 * `as` accepts heading elements because a kicker is frequently the accessible
 * label for a landmark — footer nav groups, for instance. Visual weight and
 * document structure are separate concerns, and the structure has to be right.
 */
export function Kicker({
  children,
  className,
  id,
  muted = true,
  as: Tag = "p",
}: TextProps & { as?: "p" | "span" | "div" | "h2" | "h3" | "h4" }) {
  return (
    <Tag id={id} className={cn("u-kicker", ink(muted), className)}>
      {children}
    </Tag>
  );
}

/**
 * Numeric data — scores, prices, specifications, lane counts.
 * Tabular numerals are non-negotiable: figures that do not align in columns
 * "look amateur instantly, and this brand's entire claim is precision".
 */
export function Data({
  children,
  className,
  muted,
  as: Tag = "span",
}: TextProps & { as?: "span" | "td" | "div" | "p" }) {
  return (
    <Tag className={cn("text-data u-tabular font-data", ink(muted), className)}>
      {children}
    </Tag>
  );
}

/**
 * Oversized tabular figures echoing the building's own large, plain,
 * numbered firing points (Brand Guidelines §8). Used for the First Visit step
 * sequence and for specification and standings display.
 *
 * Restraint rule: one graphic device per composition. Where lane numerals
 * appear, concentric rings and mesh do not.
 */
export function LaneNumeral({
  children,
  className,
  muted,
  "aria-hidden": ariaHidden = true,
}: TextProps & { "aria-hidden"?: boolean }) {
  return (
    <span
      aria-hidden={ariaHidden}
      className={cn(
        "text-lane u-tabular font-display u-display-wide block",
        ink(muted),
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Constrains text to the 68-character measure without imposing an element. */
export function Measure({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("u-measure", className)}>{children}</div>;
}

/** The segmented rule — the mark's broken-ring geometry as a divider. */
export function SegmentedRule({ className }: { className?: string }) {
  return (
    <hr
      className={cn("u-rule-segmented text-[var(--rule)]", className)}
      aria-hidden="true"
    />
  );
}
