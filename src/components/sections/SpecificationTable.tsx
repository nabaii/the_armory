import { cn } from "@/lib/cn";
import { Kicker } from "@/components/ui/Text";
import type { SpecRow } from "@/lib/content";

/* ============================================================================
   SPECIFICATION TABLE — spec §5: "Factual facility and discipline data.
   Tabular numerals required."

   Why this component carries more weight than it looks: the entire
   competition-standard claim rests on facts a sceptical visitor can check.
   Brand Guidelines §5 is explicit that misaligned figures undo it —
   "specification tables whose numerals do not align in columns look amateur
   instantly, and this brand's entire claim is precision. A small technical
   detail with disproportionate effect on perceived quality."

   Tabular figures come from the base stylesheet, which applies
   `font-variant-numeric: tabular-nums` to every `table`, so it cannot be
   forgotten at a call site.

   ----------------------------------------------------------------------------
   TWO THINGS DELIBERATELY CONSTRAINED

   Overflow: wide tables scroll inside their OWN container. The page body must
   never scroll horizontally — on a 360px Android viewport a four-column table
   would otherwise break the whole layout. The scroll region is focusable and
   labelled so it is reachable by keyboard, which a bare `overflow-x: auto`
   is not.

   Content: rows carry lanes, distances, targeting and safety systems. They must
   not carry anything that maps the building. Spec §3, hard constraint: "No
   imagery or copy revealing facility layout, entry and exit points, storage or
   armoury arrangements, or security staffing."
   ========================================================================= */

export function SpecificationTable({
  caption,
  rows,
  className,
}: {
  /** Describes the table for assistive technology and for sighted readers. */
  caption: string;
  rows: readonly SpecRow[];
  className?: string;
}) {
  return (
    <div
      /* Focusable so keyboard users can scroll it; labelled so its purpose is
         announced when it receives focus. */
      role="region"
      aria-label={caption}
      tabIndex={0}
      className={cn("overflow-x-auto", className)}
    >
      <table className="w-full border-collapse text-left">
        <caption className="pb-2 text-left">
          <Kicker as="span">{caption}</Kicker>
        </caption>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-[var(--rule)]/30">
              <th
                scope="row"
                className="py-2 pr-4 align-top text-body font-normal text-[var(--ink-muted)]"
              >
                {row.label}
              </th>
              <td className="py-2 align-top text-body font-bold whitespace-nowrap">
                {row.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
