/**
 * WCAG 2.1 relative luminance and contrast.
 *
 * This exists so the palette's accessibility is COMPUTED rather than asserted.
 * Spec §9 makes WCAG 2.1 AA an acceptance criterion and §4 of the Brand
 * Guidelines asks specifically that the red accent "be verified against WCAG AA
 * below 18px". A number written into a comment drifts the moment a hex changes;
 * a function does not.
 *
 * Used by the /brand reference page and by `npm run gate`.
 */

/** WCAG 2.1 relative luminance of an sRGB hex colour. */
export function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;

  const channels = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const linear = channels.map((v) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );

  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** Contrast ratio between two hex colours, 1–21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export type Level = "AA body" | "AA large" | "fail";

/**
 * Thresholds:
 *   4.5:1  normal body text
 *   3.0:1  large text (>=24px, or >=18.66px bold), and non-text UI/graphics
 */
export function level(ratio: number): Level {
  if (ratio >= 4.5) return "AA body";
  if (ratio >= 3) return "AA large";
  return "fail";
}

export const round = (n: number) => Math.round(n * 100) / 100;

/* ---------------------------------------------------------------------------
   THE PALETTE, mirrored from tokens.css.

   Kept in TypeScript as well as CSS so it can be audited programmatically.
   These two lists must agree; `npm run gate` verifies the pairs below.
   -------------------------------------------------------------------------- */

export const palette = {
  "reticle-black": "#2A2A2B",
  "sight-grey": "#727377",
  "sight-ink": "#5A5B5E",
  "ten-ring-red": "#ED3036",
  "ten-ring-deep": "#C81E24",
  chalk: "#F6F5F2",
  terrazzo: "#DCD8D1",
  "range-teak": "#8A5A2E",
  "deck-oak": "#C29A63",
  "charred-timber": "#262523",
  "gabion-stone": "#9A9188",
  "soffit-blue": "#8FA6B2",
  "vip-teal": "#2F6E78",
  white: "#FFFFFF",
} as const;

export type PaletteName = keyof typeof palette;

/**
 * Pairs the build actually relies on. Each must hold at the stated level or
 * the gate fails — these are the combinations that appear in Section grounds,
 * Text components and Button variants.
 */
export const requiredPairs: Array<{
  fg: PaletteName;
  bg: PaletteName;
  need: "body" | "graphic";
  role: string;
}> = [
  // Light grounds — primary and secondary text
  { fg: "reticle-black", bg: "chalk", need: "body", role: "Body text on the default ground" },
  { fg: "sight-ink", bg: "chalk", need: "body", role: "Secondary text on Chalk" },
  { fg: "reticle-black", bg: "terrazzo", need: "body", role: "Body text on Terrazzo panels" },
  { fg: "sight-ink", bg: "terrazzo", need: "body", role: "Secondary text on Terrazzo" },

  // Dark grounds
  { fg: "chalk", bg: "charred-timber", need: "body", role: "Footer and dark-section text" },
  { fg: "terrazzo", bg: "charred-timber", need: "body", role: "Footer secondary text" },
  { fg: "chalk", bg: "range-teak", need: "body", role: "Text on Range Teak panels" },
  { fg: "chalk", bg: "vip-teal", need: "body", role: "Text on VIP Teal — member register" },
  { fg: "reticle-black", bg: "soffit-blue", need: "body", role: "Text on Soffit Blue — open register" },

  // Calls to action
  { fg: "white", bg: "ten-ring-deep", need: "body", role: "Primary CTA label on light grounds" },
  { fg: "reticle-black", bg: "chalk", need: "body", role: "Primary CTA label on dark grounds" },
  { fg: "chalk", bg: "reticle-black", need: "body", role: "Primary CTA label on Soffit Blue" },

  // Non-text: the brand accent and the focus ring, which only need 3:1
  { fg: "ten-ring-red", bg: "chalk", need: "graphic", role: "Centre dot / focus ring on Chalk" },
  { fg: "ten-ring-red", bg: "charred-timber", need: "graphic", role: "Centre dot / focus ring on Charred Timber" },
  { fg: "sight-grey", bg: "chalk", need: "graphic", role: "Hairline rules and dividers on Chalk" },
];

export function auditRequiredPairs() {
  return requiredPairs.map((pair) => {
    const ratio = round(contrast(palette[pair.fg], palette[pair.bg]));
    const threshold = pair.need === "body" ? 4.5 : 3;
    return { ...pair, ratio, threshold, pass: ratio >= threshold };
  });
}
