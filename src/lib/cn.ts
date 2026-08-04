/**
 * Minimal class joiner.
 *
 * Deliberately not `clsx` + `tailwind-merge`. Together they are ~4KB gzipped
 * of client JavaScript on a build with a 1.5MB total budget and an LCP target
 * of 2.5s on a mid-range Android over Nigerian 4G (spec §7). Variants here are
 * closed sets defined in the component, so there is nothing to merge.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
