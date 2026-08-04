import { cn } from "@/lib/cn";

/**
 * Renderer for content the client still owes us (spec §8).
 *
 * The failure mode this exists to prevent: a plausible-looking placeholder —
 * an invented phone number, a rounded price, "Coming soon" — passes review,
 * ships, and breaks the §9 acceptance criterion that "every claim on the site
 * is true on the day it goes live".
 *
 * So there are exactly two behaviours and no third:
 *   development → a loud, visibly unfinished marker naming the missing item
 *   production   → nothing at all
 *
 * Neither can ship a falsehood. `npm run gate` is what actually stops a launch
 * while blockers remain; this only governs what a page does in the meantime.
 */
export function Pending({
  label,
  className,
}: {
  /** What is missing, phrased for the founder. e.g. "Bookings phone number". */
  label: string;
  className?: string;
}) {
  if (process.env.NODE_ENV === "production") return null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 border border-dashed border-ten-ring-deep",
        "px-1 py-[2px] align-middle",
        "font-body text-caption font-normal text-ten-ring-deep not-italic",
        className,
      )}
      data-pending={label}
    >
      <span aria-hidden="true" className="size-[5px] rounded-full bg-ten-ring-red" />
      Pending: {label}
    </span>
  );
}

/**
 * Renders `value` when present, and a Pending marker when it is not.
 * Keeps call sites free of conditionals.
 */
export function Resolved({
  value,
  label,
  render,
}: {
  value: string | null | undefined;
  label: string;
  render?: (value: string) => React.ReactNode;
}) {
  if (value == null) return <Pending label={label} />;
  return <>{render ? render(value) : value}</>;
}
