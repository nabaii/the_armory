import { cn } from "@/lib/cn";
import { Caption } from "@/components/ui/Text";

/* ============================================================================
   FORM PRIMITIVES — spec §5: "Application and enquiry. Inline validation, clear
   error states, visible progress." Spec §7: "Correct form labelling and error
   association."

   These are server-renderable by design — no "use client". The application and
   enquiry forms are the primary conversion event on the site, and they should
   submit and validate on the server first, with client enhancement added on
   top. A form that only works once a JavaScript bundle has parsed is a form
   that loses applications on Nigerian mobile data.

   ----------------------------------------------------------------------------
   ERRORS ARE NEVER RED ALONE

   Brand Guidelines §4, and it is a real constraint rather than a nicety:
   "Never use red for error states alone — it is the brand accent. Pair errors
   with an icon and explicit text."

   Two problems are being solved at once. Accessibility: WCAG 1.4.1 forbids
   conveying information by colour alone. And brand: Ten Ring Red means "the
   centre of the target, the one thing that matters" everywhere else on the
   site. If red also means "you did something wrong", the accent stops reading
   as precision and starts reading as a warning — which inverts the positioning.

   So every error carries an icon AND explicit text, and the field also gets a
   non-colour signal (a thickened border) so the state survives greyscale.

   Error text uses Ten Ring Deep, not Ten Ring Red — 5.25:1 on Chalk against
   the 4.5:1 requirement. Ten Ring Red measures 3.79:1 and would fail at body
   size, which is exactly the trap §4 warns about.
   ========================================================================= */

/* ---------------------------------------------------------------------------
   FIELD — owns label association, error association and hint wiring.

   The ids are derived from `name`, so `htmlFor`, `aria-describedby` and
   `aria-invalid` cannot drift out of sync at a call site. Getting this wrong
   is the most common accessibility defect in forms and it is invisible until
   someone tries to complete the form with a screen reader.
   -------------------------------------------------------------------------- */

export type FieldProps = {
  name: string;
  label: string;
  /** Practical guidance. Concrete and short. */
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
};

export function Field({
  name,
  label,
  hint,
  error,
  required,
  className,
  children,
}: FieldProps & { children: (ids: FieldIds) => React.ReactNode }) {
  const ids: FieldIds = {
    id: name,
    describedBy:
      [hint ? `${name}-hint` : null, error ? `${name}-error` : null]
        .filter(Boolean)
        .join(" ") || undefined,
    invalid: Boolean(error),
  };

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={name} className="u-kicker text-[var(--ink)]">
        {label}
        {/* Not an asterisk alone — an asterisk is a convention, not a label. */}
        {/* No opacity here, deliberately.

            This was `opacity-70`, which reads fine on Chalk — the label starts
            at 13:1, so dimming it still clears AA comfortably. It failed on the
            access-register grounds: 3.50:1 on VIP Teal and 3.27:1 on Soffit
            Blue, both under the 4.5:1 required for 14px text. Caught by axe on
            /enquire, which is the one page that puts forms on three different
            grounds.

            The lesson is worth keeping: a fixed opacity is not a colour. It
            behaves differently on every ground it lands on, so it cannot be
            verified once. "(optional)" is already distinguished from the label
            by case, weight and tracking — it does not need to be dimmer too. */}
        {!required && (
          <span className="ml-1 font-normal normal-case tracking-normal">
            (optional)
          </span>
        )}
      </label>

      {hint && (
        <Caption id={`${name}-hint`} className="-mt-[2px]">
          {hint}
        </Caption>
      )}

      {children(ids)}

      {error && <FieldError id={`${name}-error`}>{error}</FieldError>}
    </div>
  );
}

export type FieldIds = {
  id: string;
  describedBy?: string;
  invalid: boolean;
};

/* ---------------------------------------------------------------------------
   ERROR — icon, plus explicit text, plus a colour that actually passes.
   -------------------------------------------------------------------------- */

export function FieldError({
  id,
  children,
}: {
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <p
      id={id}
      /* Announced when it appears, without stealing focus mid-typing. */
      role="alert"
      className="flex items-start gap-1 text-caption font-bold text-ten-ring-deep"
    >
      <AlertIcon />
      <span>{children}</span>
    </p>
  );
}

/** A plain warning glyph. Nothing from the reticle system — the brand's marks
    mean precision and belonging, and must not be recruited to mean failure. */
function AlertIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="mt-[0.15em] size-2 shrink-0"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 4.5v4.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="8" cy="11.4" r="0.9" fill="currentColor" />
    </svg>
  );
}

/* ---------------------------------------------------------------------------
   CONTROLS

   48px minimum height — a thumb is the primary input and the booking flow has
   a three-minute budget. Font size never below 16px, or iOS zooms the viewport
   on focus and the visitor loses their place in the form.
   -------------------------------------------------------------------------- */

const CONTROL = [
  "min-h-6 w-full rounded-control px-2 py-1",
  "bg-white text-body text-reticle-black",
  "border border-sight-grey",
  "transition-colors duration-[var(--duration-fast)]",
  "placeholder:text-sight-ink/60",
].join(" ");

/** Non-colour error signal: a thicker, darker border. Survives greyscale. */
const CONTROL_INVALID = "border-2 border-ten-ring-deep";

export function TextInput({
  ids,
  type = "text",
  ...rest
}: {
  ids: FieldIds;
  type?: "text" | "email" | "tel" | "number" | "date";
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "type">) {
  return (
    <input
      {...rest}
      id={ids.id}
      name={ids.id}
      type={type}
      aria-describedby={ids.describedBy}
      aria-invalid={ids.invalid || undefined}
      className={cn(CONTROL, ids.invalid && CONTROL_INVALID)}
    />
  );
}

export function TextArea({
  ids,
  rows = 4,
  ...rest
}: { ids: FieldIds } & Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "id"
>) {
  return (
    <textarea
      {...rest}
      id={ids.id}
      name={ids.id}
      rows={rows}
      aria-describedby={ids.describedBy}
      aria-invalid={ids.invalid || undefined}
      className={cn(CONTROL, "py-2", ids.invalid && CONTROL_INVALID)}
    />
  );
}

export function SelectInput({
  ids,
  options,
  placeholder,
  ...rest
}: {
  ids: FieldIds;
  options: readonly { value: string; label: string }[];
  placeholder?: string;
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "id">) {
  return (
    <select
      {...rest}
      id={ids.id}
      name={ids.id}
      aria-describedby={ids.describedBy}
      aria-invalid={ids.invalid || undefined}
      defaultValue={placeholder ? "" : undefined}
      className={cn(CONTROL, ids.invalid && CONTROL_INVALID)}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/* ---------------------------------------------------------------------------
   SUBMIT — a real <button>, not the Link-based Button component.
   -------------------------------------------------------------------------- */

export function SubmitButton({
  children,
  pending = false,
  className,
}: {
  children: React.ReactNode;
  pending?: boolean;
  className?: string;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "inline-flex min-h-6 items-center justify-center gap-2 rounded-control px-4 py-2",
        "bg-[var(--btn-fill)] text-[var(--btn-fill-ink)]",
        "font-display text-body font-bold",
        "transition-opacity duration-[var(--duration-fast)]",
        "disabled:opacity-60",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------------------
   FORM STATUS — the on-screen confirmation Flow A step 3 requires.

   Spec Flow A: "Immediate on-screen confirmation stating what happens next and
   within what timeframe." The Brief is specific about why: "'We will email you
   back' loses half of them in the gap."
   -------------------------------------------------------------------------- */

export function FormStatus({
  tone,
  heading,
  children,
}: {
  tone: "success" | "error";
  heading: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "border-l-2 p-3",
        tone === "success"
          ? "border-vip-teal bg-terrazzo"
          : "border-ten-ring-deep bg-terrazzo",
      )}
    >
      <p className="flex items-start gap-1 font-display text-h3 font-bold text-reticle-black">
        {tone === "error" && (
          <span className="mt-[0.2em] text-ten-ring-deep">
            <AlertIcon />
          </span>
        )}
        {heading}
      </p>
      {children && (
        <div className="mt-1 text-body text-sight-ink">{children}</div>
      )}
    </div>
  );
}
