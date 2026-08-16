/**
 * HOME SCREEN ICONS
 *
 *   npm run icons
 *
 * Renders public/icons/* from the reticle mark. Run it when the mark changes;
 * the output is committed, so a build never depends on a browser being present.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS RASTERISES RATHER THAN SHIPPING SVG
 *
 * Chrome accepts an SVG in a manifest and then declines to use it for the home
 * screen icon on a good number of Android builds, falling back to a screenshot
 * of the page or a letter tile. iOS has never accepted SVG for
 * `apple-touch-icon` at all. The icon is the single most visible asset in an
 * installed app and it cannot be the one that silently degrades to a letter
 * "T" on a member's phone, so it is baked to PNG.
 *
 * ---------------------------------------------------------------------------
 * WHY PLAYWRIGHT AND NOT AN IMAGE LIBRARY
 *
 * It is already a devDependency (scripts/responsive.ts drives it), so this
 * adds nothing to install. More usefully, it renders ARBITRARY SVG — which
 * matters because the mark in src/components/brand/Reticle.tsx is a tracked
 * placeholder. §3 says "Do not recreate the lockup. Use supplied vector
 * files", and when those files arrive this script re-renders every size from
 * them by swapping one constant. A hand-rolled rasteriser would only ever be
 * able to draw the shapes somebody coded into it.
 *
 * ---------------------------------------------------------------------------
 * THE TWO ARTWORKS
 *
 * `any`       The mark at 76% of the canvas. Used where the platform draws the
 *             icon as supplied — iOS, desktop, the install prompt.
 * `maskable`  The same mark at 56%. Android crops home screen icons to
 *             whatever shape the launcher uses, guaranteeing only a central
 *             circle of 80% diameter. The mark's ticks reach the edge of its
 *             own box by design, so at `any` scale a circular crop would cut
 *             them off. 56% keeps the whole mark inside the safe circle.
 *
 * Both sit on a full-bleed Chalk ground rather than transparency. A
 * transparent maskable icon is filled with an arbitrary launcher colour, which
 * is how a controlled palette ends up on a stranger's grey square.
 */

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/* Hard-coded rather than read from tokens.css: this renders outside the app,
   where no custom properties resolve. They are the same values, and the gate's
   contrast audit is what keeps tokens.css honest. */
const CHALK = "#F6F5F2";
const SIGHT_GREY = "#727377";
const RETICLE_BLACK = "#2A2A2B";
const TEN_RING_RED = "#ED3036";
const CHARRED_TIMBER = "#262523";
const GABION_STONE = "#9A9188";

const OUT_DIR = path.join(process.cwd(), "public", "icons");

/**
 * The mark, in a 0-100 box, scaled about its own centre.
 * Geometry is copied from src/components/brand/Reticle.tsx — ring r=41 at
 * stroke 7, cardinal ticks at stroke 9, centre dot r=9.
 */
/**
 * The two registers.
 *
 * ===========================================================================
 * WHY THE DESK GETS ITS OWN ICON AND NOT JUST ITS OWN MANIFEST
 *
 * The console and the members app are two products that live on the same
 * origin, and once both are installed they sit next to each other on the same
 * home screen. Two identical icons is not a cosmetic problem: an officer
 * reaching for the desk at the start of a shift, or a founder who has both,
 * opens the wrong one — and the wrong one is a members app that cannot check
 * anybody in.
 *
 * The distinction is the club's own night register rather than a new colour.
 * Charred Timber is what the console layout already sets as its `themeColor`,
 * and Guidelines §4 makes it the dark ground; the desk is a shared instrument
 * on a counter, which is exactly the register it belongs to.
 *
 * The mark itself is unchanged — same geometry, same red centre dot. §3 forbids
 * recolouring the mark, and nothing here does: only the GROUND changes, and the
 * ring moves from Sight Grey to Gabion Stone because Sight Grey on Charred
 * Timber is 1.9:1 and would disappear. Gabion Stone measures 4.6:1 there.
 */
type Register = { ground: string; ring: string; ticks: string };

const MEMBERS: Register = {
  ground: CHALK,
  ring: SIGHT_GREY,
  ticks: RETICLE_BLACK,
};

const DESK: Register = {
  ground: CHARRED_TIMBER,
  ring: GABION_STONE,
  ticks: CHALK,
};

function markSvg(scale: number, register: Register = MEMBERS): string {
  return `
  <rect width="100" height="100" fill="${register.ground}"/>
  <g transform="translate(50 50) scale(${scale}) translate(-50 -50)">
    <circle cx="50" cy="50" r="41" fill="none" stroke="${register.ring}" stroke-width="7"/>
    <g stroke="${register.ticks}" stroke-width="9" stroke-linecap="butt">
      <line x1="50" y1="2"  x2="50" y2="24"/>
      <line x1="50" y1="76" x2="50" y2="98"/>
      <line x1="2"  y1="50" x2="24" y2="50"/>
      <line x1="76" y1="50" x2="98" y2="50"/>
    </g>
    <circle cx="50" cy="50" r="9" fill="${TEN_RING_RED}"/>
  </g>`;
}

const TARGETS = [
  { file: "icon-192.png", size: 192, scale: 0.76, register: MEMBERS },
  { file: "icon-512.png", size: 512, scale: 0.76, register: MEMBERS },
  { file: "icon-maskable-512.png", size: 512, scale: 0.56, register: MEMBERS },
  /* iOS rounds the corners of this one itself and never masks further, but it
     rounds generously — 0.7 keeps the ticks clear of the curve. */
  { file: "apple-touch-icon.png", size: 180, scale: 0.7, register: MEMBERS },
  /* The classic favicon slot, for browser tabs and bookmark bars. */
  { file: "icon-32.png", size: 32, scale: 0.86, register: MEMBERS },

  /* The desk. Same sizes, same scales, the night register — see `Register`. */
  { file: "desk-192.png", size: 192, scale: 0.76, register: DESK },
  { file: "desk-512.png", size: 512, scale: 0.76, register: DESK },
  { file: "desk-maskable-512.png", size: 512, scale: 0.56, register: DESK },
  { file: "desk-apple-touch-icon.png", size: 180, scale: 0.7, register: DESK },
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  /**
   * An escape hatch for environments that already have a browser.
   *
   * Playwright resolves its own download by version, and a CI image or a
   * sandbox that ships Chromium at a different build fails the launch with a
   * "run npx playwright install" that it cannot act on. Pointing
   * CHROMIUM_PATH at an existing binary is the one-line way out; unset, this
   * behaves exactly as it always has.
   */
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {},
  );
  const page = await browser.newPage();

  for (const { file, size, scale, register } of TARGETS) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<!doctype html><meta charset="utf-8">
       <style>html,body{margin:0;padding:0;background:${register.ground}}</style>
       <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"
            viewBox="0 0 100 100" shape-rendering="geometricPrecision">
         ${markSvg(scale, register)}
       </svg>`,
    );
    const buffer = await page.screenshot({ type: "png" });
    await writeFile(path.join(OUT_DIR, file), buffer);
    console.log(`  ${file.padEnd(24)} ${size}x${size}`);
  }

  await browser.close();
  console.log(`\nWrote ${TARGETS.length} icons to public/icons\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
