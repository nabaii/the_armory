import { cn } from "@/lib/cn";

/**
 * A PANE OF GLAZING — the content material, as a component.
 *
 * The derivation, the measured tints and the argument for squareness are in
 * `src/styles/glaze.css`. This is the part that decides WHEN a thing is a pane,
 * which is the decision a stylesheet cannot make.
 *
 * ===========================================================================
 * THE RULE: A PANE IS SOMETHING YOU COULD PICK UP
 *
 * The site is a stack of full-bleed bands and that structure is correct — it is
 * how the editorial system reads, and wrapping every paragraph in a card would
 * turn a confident brochure into a dashboard. So glazing is not a replacement
 * for the bands. It is what gets SET INTO them.
 *
 * A pane is warranted when the content inside it is a discrete object the
 * member acts on or compares: a booking, a day, a tier, a session, a score. It
 * is not warranted for prose, for a section's own heading, or for anything that
 * is simply the next thing down the page. The test that has held so far: if you
 * could imagine handing it to somebody on a card, it is a pane.
 *
 * ===========================================================================
 * REGISTER FOLLOWS THE BAND — glaze.css measured why
 *
 * A Chalk pane on a Charred Timber band puts Ten Ring Red at 2.45:1 and takes a
 * 92% tint to recover, at which point it is a Chalk rectangle with an expensive
 * filter behind it. So `tone` names the register rather than the colour, and
 * dark bands take dark panes. A window reads as the room it is in.
 *
 * ===========================================================================
 * WHY `flat` IS THE DEFAULT FOR ANYTHING THAT REPEATS
 *
 * `backdrop-filter` costs in proportion to blurred area and to the number of
 * compositing layers. A Diary day renders a table board and three discipline
 * boards, each holding seven slot chips; thirty filtered chips is a dropped
 * frame per scroll on the mid-range Android this product is measured against,
 * and it buys nothing — a 44px chip has no room to show a blurred drawing
 * through itself. `flat` keeps the tint and the lit edge and drops the filter.
 */

export type PanelTone = "light" | "dark";

export function Panel({
  children,
  tone = "light",
  flat = false,
  raised = false,
  ticks = false,
  padded = true,
  className,
  as: Tag = "div",
  id,
}: {
  children: React.ReactNode;
  /**
   * Which register this pane is in. Must match the band behind it — see the
   * header. Sections that know their own answer publish it via `groundGlaze`.
   */
  tone?: PanelTone;
  /** Drop the backdrop filter, keep everything else. Use for anything repeated. */
  flat?: boolean;
  /**
   * A pane that can be picked up: a 1px lift and a tight shadow on hover.
   * For panes that are themselves a link or a control, never for static ones —
   * a card that lifts and does nothing is a promise the interface does not keep.
   */
  raised?: boolean;
  /**
   * Setting-out marks at two corners (Brand Guidelines §8's tick geometry).
   * Reserved for panes that are the subject of their screen — the calendar, the
   * next booking. On every pane at once it stops being a mark and becomes a
   * border treatment.
   */
  ticks?: boolean;
  /** Off for panes that manage their own inner rhythm, like the calendar grid. */
  padded?: boolean;
  className?: string;
  as?: "div" | "section" | "article" | "li";
  id?: string;
}) {
  return (
    <Tag
      id={id}
      className={cn(
        flat ? "u-glaze-flat" : "u-glaze",
        "u-glaze-edge",
        tone === "dark" && "u-glaze-dark",
        raised && "u-glaze-raise",
        ticks && "u-tick",
        padded && "p-3",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
