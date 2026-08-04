import { Caption } from "@/components/ui/Text";
import { Pending } from "@/components/ui/Pending";

/**
 * "Call us on …" — the prompt and the number, bound together.
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS EXISTS TO PREVENT
 *
 * `Pending` renders nothing in production, which is correct: it stops invented
 * placeholder data reaching a real visitor. But it makes a specific mistake very
 * easy to write, and this codebase had it in five places:
 *
 *     <Caption>
 *       Prefer to book by phone?{" "}
 *       <Resolved value={contact.bookingsPhone} label="…" />
 *     </Caption>
 *
 * In development that reads correctly. In production, with the number still
 * outstanding, it renders "Prefer to book by phone?" followed by nothing — an
 * instruction the page cannot help anyone follow. That breaks the §9 criterion
 * that every claim on the site is true on the day it ships, by omission rather
 * than by invention.
 *
 * It was invisible to the output audit too, because there is no forbidden string
 * to grep for: the failure is the ABSENCE of text after a prompt.
 *
 * So the prompt and the number are a single unit here. If there is no number,
 * neither appears, and a fallback can be offered instead.
 * ---------------------------------------------------------------------------
 */
export function CallUs({
  value,
  prompt,
  label,
  fallback,
  className,
}: {
  /** The number, or null while it is outstanding. */
  value: string | null | undefined;
  /** Lead-in text. Rendered ONLY when there is a number to follow it. */
  prompt?: string;
  /** What is missing, for the development marker. */
  label: string;
  /** Shown instead when there is no number — e.g. a link to the enquiry page. */
  fallback?: React.ReactNode;
  className?: string;
}) {
  if (!value) {
    return (
      <div className={className}>
        {fallback}
        <Pending label={label} />
      </div>
    );
  }

  return (
    <Caption className={className}>
      {prompt ? `${prompt} ` : null}
      <a
        href={`tel:${value.replace(/\s/g, "")}`}
        className="underline decoration-1 underline-offset-2"
      >
        Call {value}
      </a>
    </Caption>
  );
}
