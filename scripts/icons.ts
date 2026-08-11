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

const OUT_DIR = path.join(process.cwd(), "public", "icons");

/**
 * The mark, in a 0-100 box, scaled about its own centre.
 * Geometry is copied from src/components/brand/Reticle.tsx — ring r=41 at
 * stroke 7, cardinal ticks at stroke 9, centre dot r=9.
 */
function markSvg(scale: number): string {
  return `
  <rect width="100" height="100" fill="${CHALK}"/>
  <g transform="translate(50 50) scale(${scale}) translate(-50 -50)">
    <circle cx="50" cy="50" r="41" fill="none" stroke="${SIGHT_GREY}" stroke-width="7"/>
    <g stroke="${RETICLE_BLACK}" stroke-width="9" stroke-linecap="butt">
      <line x1="50" y1="2"  x2="50" y2="24"/>
      <line x1="50" y1="76" x2="50" y2="98"/>
      <line x1="2"  y1="50" x2="24" y2="50"/>
      <line x1="76" y1="50" x2="98" y2="50"/>
    </g>
    <circle cx="50" cy="50" r="9" fill="${TEN_RING_RED}"/>
  </g>`;
}

const TARGETS = [
  { file: "icon-192.png", size: 192, scale: 0.76 },
  { file: "icon-512.png", size: 512, scale: 0.76 },
  { file: "icon-maskable-512.png", size: 512, scale: 0.56 },
  /* iOS rounds the corners of this one itself and never masks further, but it
     rounds generously — 0.7 keeps the ticks clear of the curve. */
  { file: "apple-touch-icon.png", size: 180, scale: 0.7 },
  /* The classic favicon slot, for browser tabs and bookmark bars. */
  { file: "icon-32.png", size: 32, scale: 0.86 },
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();

  for (const { file, size, scale } of TARGETS) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<!doctype html><meta charset="utf-8">
       <style>html,body{margin:0;padding:0;background:${CHALK}}</style>
       <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"
            viewBox="0 0 100 100" shape-rendering="geometricPrecision">
         ${markSvg(scale)}
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
