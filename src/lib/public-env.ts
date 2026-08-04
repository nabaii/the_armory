/**
 * PUBLIC environment values — safe to reach the browser.
 *
 * Separate from src/server/env.ts on purpose. That module reads secrets, and a
 * client component importing it would either fail the build or, worse, bundle a
 * key. Keeping the two files apart makes the boundary obvious at the import site
 * rather than depending on everyone remembering which fields are safe.
 *
 * Only `NEXT_PUBLIC_*` values belong here, and they must be referenced as
 * literal `process.env.NEXT_PUBLIC_X` expressions so the bundler can inline
 * them — a dynamic lookup returns undefined in the browser.
 */

export const turnstileSiteKey = (): string | undefined =>
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || undefined;

export const isTurnstileEnabled = (): boolean =>
  Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
