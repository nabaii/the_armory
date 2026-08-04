/**
 * Typography loading — Brand Guidelines §5.
 *
 * `next/font/google` downloads these at BUILD time and serves them from our
 * own origin. Nothing is requested from Google at runtime, which matters for
 * three reasons here: no third-party request on pages handling personal data
 * (spec §7), no extra DNS round-trip on Nigerian mobile data, and no layout
 * shift because Next injects `size-adjust` fallback metrics automatically.
 *
 * Budget: two variable files, latin subset, ~100KB total against a 1.5MB
 * initial payload target.
 *
 * IBM Plex Mono — offered in the guidelines as an optional face for score
 * readouts and lane numbering — is deliberately not loaded. It belongs with
 * Leagues in Phase 2 and buys nothing at launch.
 */

import { Archivo, Inter } from "next/font/google";

/**
 * Display face. An institutional grotesque with sporting authority.
 *
 * The `wdth` axis is requested so the "Archivo Expanded" register is reachable
 * through `font-stretch` (see `.u-display-wide`) instead of a second font
 * file. Slight width is what makes headings read as a governing body.
 *
 * Only weights 400 and 700 are used — the guidelines forbid light weights,
 * which "read fragile and fail on low-quality screens".
 */
export const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
  variable: "--font-archivo",
  preload: true,
});

/**
 * Body face. Chosen specifically for legibility at small sizes on the
 * mid-range Android devices this audience uses.
 */
export const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
  preload: true,
});

/** Applied to <html> so the CSS custom properties in tokens.css resolve. */
export const fontVariables = `${archivo.variable} ${inter.variable}`;
