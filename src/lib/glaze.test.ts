import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  FIELD_ALPHA_MAX,
  GLAZE_TINT,
  auditGlazedPairs,
  composite,
  contrast,
  glazeOver,
  palette,
} from "./contrast";

/**
 * THE GLAZING PROOF, AND THE ONE GAP IT WOULD OTHERWISE HAVE.
 *
 * `glaze.css` puts content-grade glass over a known ground, and the entire
 * argument for doing so is that the resulting colour can be COMPUTED — which is
 * what `glazeOver` does and what `npm run gate` now audits.
 *
 * The gap is that the tint lives in two places. CSS cannot import a TypeScript
 * constant, so `--glaze-tint: 62%` is declared in the stylesheet and 0.62 is
 * declared in `contrast.ts`, and nothing stops somebody changing one of them.
 * The gate would keep passing, against a number the browser had stopped using.
 *
 * So this reads the stylesheet. It is the same move §13.2's lint rule made —
 * "a lint rule rather than institutional memory" — applied to the one value in
 * this system whose drift would be silent and would ship a contrast failure.
 */

const GLAZE_CSS = readFileSync(
  new URL("../styles/glaze.css", import.meta.url),
  "utf8",
);

describe("the stylesheet and the proof agree", () => {
  it("declares the tint the composites are computed from", () => {
    const declared = /--glaze-tint:\s*(\d+)%/.exec(GLAZE_CSS);
    assert.ok(declared, "glaze.css must declare --glaze-tint");
    assert.equal(
      Number(declared[1]) / 100,
      GLAZE_TINT,
      "GLAZE_TINT in contrast.ts must match --glaze-tint in glaze.css, or the gate is auditing a surface the browser never renders",
    );
  });

  it("keeps the field at or under the density the proof assumes", () => {
    /* The proof is written against the worst case. If the field is ever turned
       up past it, every glazed figure in the audit is optimistic. */
    for (const property of ["--field-minor-alpha", "--field-major-alpha"]) {
      const declared = new RegExp(`${property}:\\s*(\\d+)%`).exec(GLAZE_CSS);
      assert.ok(declared, `glaze.css must declare ${property}`);
      assert.ok(
        Number(declared[1]) / 100 <= FIELD_ALPHA_MAX,
        `${property} is ${declared[1]}%, above the ${FIELD_ALPHA_MAX * 100}% the contrast proof assumes`,
      );
    }
  });

  it("still refuses light glazing over a dark band", () => {
    /* The measurement that produced "register follows the band". If a future
       change makes this pass, the rule can be revisited — until then a failure
       here means somebody has changed the tint far enough to matter. */
    const lightPaneOnDark = composite(
      "chalk",
      GLAZE_TINT,
      palette["charred-timber"],
    );

    assert.ok(
      contrast(palette["ten-ring-red"], lightPaneOnDark) < 3,
      "a light pane on Charred Timber is expected to fail the 3:1 a marker needs — that is why glazing takes the register of its band",
    );
  });
});

describe("every ground that carries glazing", () => {
  for (const pair of auditGlazedPairs()) {
    it(`${pair.role} clears ${pair.threshold}:1`, () => {
      assert.ok(
        pair.pass,
        `${pair.fg} on ${pair.surface} (a pane over ${pair.ground}) measures ${pair.ratio}:1, below ${pair.threshold}:1`,
      );
    });
  }
});

describe("Soffit Blue", () => {
  it("cannot carry a pane, which is why it is excluded rather than tuned", () => {
    const surface = glazeOver("soffit-blue");

    /* The decisive one: the centre dot is the app's active marker and it cannot
       be seen on this pane. If this ever passes, `groundGlaze` returning null
       for Soffit is worth revisiting — deliberately, from here, rather than
       discovered by somebody wondering why one band looks different. */
    assert.ok(
      contrast(palette["ten-ring-red"], surface) < 3,
      "markers on a pane over Soffit Blue are expected to fail the graphic threshold",
    );

    /* The supporting one, and it is about HEADROOM rather than compliance.
       Captions here measure 4.57:1 — a pass, on the smallest type the product
       sets, with seven hundredths to spare. Every other glazed ground clears
       the same test by a full point. This asserts the gap rather than the
       failure, so the reason this ground was excluded stays legible. */
    const captions = contrast(palette["sight-ink"], surface);
    assert.ok(captions >= 4.5, "the caption figure is a pass, and it is stated as one");
    assert.ok(
      captions < 4.7,
      `captions on a pane over Soffit Blue measure ${captions.toFixed(2)}:1 — the point is that this has no headroom, and if it ever gains some the exclusion should be reconsidered`,
    );
  });
});
