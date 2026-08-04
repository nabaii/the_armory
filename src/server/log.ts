/**
 * STRUCTURED LOGGING WITH PII REDACTION.
 *
 * Logs are the most commonly overlooked copy of personal data. They are shipped
 * to third-party aggregators, retained far longer than the retention schedule in
 * the privacy policy, and readable by anyone with dashboard access — which is a
 * wider group than the "named staff" spec §7 limits personal data to.
 *
 * On this project that matters more than usual. The Brief identifies the site's
 * own data as "a list of wealthy Abuja residents and where they will be, and
 * when". A log line reading `application failed for adaeze@example.com` puts a
 * name and an interest in a private club into a system nobody audited.
 *
 * So this module logs FACTS, never PEOPLE. Emails become domains, phone numbers
 * become their last two digits, names never appear at all. Enough to debug a
 * delivery failure; not enough to reconstruct who applied.
 *
 * Anything that needs the actual person is in the CRM, behind access control.
 */

/** `adaeze@example.com` → `@example.com`. Enough to spot a domain-wide issue. */
export const redactEmail = (email: string): string => {
  const at = email.lastIndexOf("@");
  return at === -1 ? "[redacted]" : `@${email.slice(at + 1)}`;
};

/** `+2348012345678` → `…78`. Enough to match against a support call. */
export const redactPhone = (phone: string): string =>
  phone.length < 2 ? "[redacted]" : `…${phone.slice(-2)}`;

type Fields = Record<string, string | number | boolean | null | undefined>;

const EMIT: Record<Level, (line: string) => void> = {
  info: (l) => console.info(l),
  warn: (l) => console.warn(l),
  error: (l) => console.error(l),
};

type Level = "info" | "warn" | "error";

function emit(level: Level, event: string, fields: Fields) {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${typeof v === "string" ? JSON.stringify(v) : v}`);

  EMIT[level](
    `[${level}] ${event}${parts.length ? ` ${parts.join(" ")}` : ""}`,
  );
}

export const log = {
  info: (event: string, fields: Fields = {}) => emit("info", event, fields),
  warn: (event: string, fields: Fields = {}) => emit("warn", event, fields),
  error: (event: string, fields: Fields = {}) => emit("error", event, fields),
};
