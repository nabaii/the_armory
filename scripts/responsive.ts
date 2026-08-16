/**
 * RESPONSIVE AUDIT
 *
 *   npm run responsive              (requires a dev or prod server running)
 *   npm run responsive -- --url http://localhost:3000
 *
 * Design Specification §6 fixes the breakpoints at 480 / 768 / 1024 / 1440 and
 * §9 makes mobile behaviour an acceptance criterion. Neither was measured
 * anywhere — `npm run audit` reads prerendered HTML, which is layout-blind by
 * construction. A page can satisfy every existing check and still clip its
 * content in half on a 360px Android.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS CANNOT USE scrollWidth
 *
 * The obvious overflow test is `documentElement.scrollWidth > innerWidth`. It
 * reports clean on every page of this site, and it is wrong every time.
 *
 * base.css sets `body { overflow-x: hidden }` — "guard against any single
 * element forcing a horizontal scrollbar". That comment describes the intent;
 * the effect is different. `overflow-x: hidden` does not stop an element being
 * too wide, it stops you SEEING that it is too wide. The scrollbar disappears
 * and the content is clipped instead, silently, with no scroll offered to
 * reach it. So the one automated signal everybody reaches for is precisely the
 * signal that rule suppresses.
 *
 * This audit therefore measures element geometry directly: every element's
 * border box against the viewport box. That sees through the clip, and it also
 * names the culprit rather than reporting that the page is broken somewhere.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT ASSERTS
 *
 *   overflow   No element extends past the viewport, at any tested width.
 *              Content inside a declared scroll container is exempt — that is
 *              the SpecificationTable pattern and it is correct.
 *   tap        Interactive controls are >= 44px (WCAG 2.5.5). The Button
 *              component promises 48px; this checks the promise survives
 *              contact with real labels.
 *   clip       No element is taller than its own overflow-hidden parent, which
 *              is how a fluid headline loses its descenders.
 *
 * Widths are real devices, not round numbers: 320 is the smallest viewport
 * still in use, 360 and 393 are the Android sizes this audience actually
 * carries, 1440 is the top of the fluid type ramp and 2560 is past it — the
 * range where a max-width container stops growing and a naive `vw` unit does
 * not.
 */

import { chromium, type Browser, type Page } from "playwright";

/* --------------------------------------------------------------------------
   WIDTHS — chosen from the spec's breakpoints and from the devices the Brief
   names, plus one either side of every breakpoint. Bugs live at the boundary,
   not in the middle of a range.
   ----------------------------------------------------------------------- */

const WIDTHS = [
  320, // smallest viewport still in real use
  360, // the common mid-range Android this site is measured against
  393, // Pixel / modern Android
  414, // larger iPhone
  479, // one below the sm breakpoint
  480, // sm
  640,
  767, // one below md
  768, // md — tablet portrait
  834, // iPad Air portrait
  1023, // one below lg
  1024, // lg — the desktop nav appears here
  1280, // container max-width
  1439, // one below xl
  1440, // xl — top of the fluid type ramp
  1920,
  2560, // past the ramp: catches unclamped vw units
] as const;

/** Height is fixed; this audit is about horizontal behaviour. */
const HEIGHT = 900;

/* Routes worth measuring. The screen display is deliberately excluded: it is a
   fixed-install television view sized in vw on purpose, and holding it to a
   phone viewport would be a false positive. */
const ROUTES = [
  "/",
  "/membership",
  "/first-visit",
  "/ranges",
  "/the-club",
  "/groups",
  "/sport",
  "/leagues",
  "/enquire",
  "/institutional",
  "/legal/privacy",
  "/legal/terms",
  "/legal/refunds",
  "/sign-in",
  "/brand",
  "/brand/components",
] as const;

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

type Finding = {
  route: string;
  width: number;
  kind: "overflow" | "tap" | "clip";
  selector: string;
  detail: string;
  /** How far past the viewport, in px. Used to rank output. */
  amount: number;
};

const argUrl = process.argv.indexOf("--url");
/* 127.0.0.1 rather than localhost: on Windows, `localhost` resolves to ::1
   first and the dev server binds IPv4, so the whole run fails to connect. */
const BASE =
  argUrl !== -1 ? process.argv[argUrl + 1] : "http://127.0.0.1:3000";

/* Only report the mobile-menu state when explicitly asked, since opening it
   doubles the run time. */
const WITH_MENU = process.argv.includes("--menu");

/* ==========================================================================
   THE PROBE

   Runs in the page. Returns plain data — Playwright cannot serialise element
   handles out of an evaluate, and we want a stable text selector for the
   report anyway.
   ======================================================================== */

const PROBE = `(() => {
  const vw = window.innerWidth;
  const findings = [];

  /** A readable, copy-pasteable identifier for a DOM node. */
  const describe = (el) => {
    if (!el || el === document.documentElement) return "html";
    const tag = el.tagName.toLowerCase();
    if (el.id) return tag + "#" + el.id;
    const cls = (el.getAttribute("class") || "")
      .split(/\\s+/)
      .filter(Boolean)
      .slice(0, 4)
      .join(".");
    return cls ? tag + "." + cls : tag;
  };

  /** First few words of text, to locate the element on the page by eye. */
  const label = (el) => {
    const t = (el.textContent || "").trim().replace(/\\s+/g, " ");
    return t ? JSON.stringify(t.slice(0, 48)) : "";
  };

  /** True if any ancestor legitimately scrolls or clips horizontally, which
      makes a wide child intentional rather than a defect. */
  const inScrollContainer = (el) => {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const s = getComputedStyle(p);
      if (s.overflowX === "auto" || s.overflowX === "scroll" || s.overflowX === "hidden") {
        return true;
      }
      p = p.parentElement;
    }
    return false;
  };

  const invisible = (el, s) =>
    s.display === "none" ||
    s.visibility === "hidden" ||
    s.opacity === "0";

  /* Deliberately removed from the visual layer, in one of the two patterns
     this codebase uses. Both are correct and neither is a defect:

       honeypot   an aria-hidden, tabIndex=-1 input parked in a zero-size
                  overflow-hidden div. Bots fill it, humans never see it.
                  Its own rect is a normal 215x26 input box, so it reads as an
                  undersized tap target unless the wrapper is consulted.
       sr-only    a 1px clipped box carrying text for screen readers. Its
                  content necessarily overflows it — that is the technique.

     Getting this wrong is not a cosmetic problem for an audit. Twenty-four
     honeypot warnings on a clean site is how a check earns a reputation for
     crying wolf, and a check nobody trusts is a check nobody runs. */
  const deliberatelyHidden = (el) => {
    if (el.closest('[aria-hidden="true"]')) return true;
    if (el.closest(".sr-only")) return true;
    let p = el;
    while (p && p !== document.body) {
      const r = p.getBoundingClientRect();
      const s = getComputedStyle(p);
      const clipped = s.overflow === "hidden" || s.overflowX === "hidden";
      if (clipped && (r.width <= 1 || r.height <= 1)) return true;
      p = p.parentElement;
    }
    return false;
  };

  /* ---------------------------------------------------------------- OVERFLOW
     Every element whose border box crosses the viewport edge. We report the
     OUTERMOST offender only: if a container is too wide, every child inherits
     the fault and listing all of them buries the cause.
  */
  const offenders = [];
  for (const el of document.querySelectorAll("body *")) {
    const s = getComputedStyle(el);
    if (invisible(el, s)) continue;
    if (deliberatelyHidden(el)) continue;

    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;

    const overRight = r.right - vw;
    const overLeft = -r.left;
    const over = Math.max(overRight, overLeft);

    // 1px of tolerance: sub-pixel rounding on fractional layouts is not a bug.
    if (over > 1 && !inScrollContainer(el)) {
      offenders.push({ el, over, r });
    }
  }

  for (const o of offenders) {
    const shadowed = offenders.some(
      (other) => other !== o && other.el.contains(o.el),
    );
    if (shadowed) continue;
    findings.push({
      kind: "overflow",
      selector: describe(o.el),
      detail:
        Math.round(o.over) + "px past viewport (" +
        Math.round(o.r.width) + "px wide) " + label(o.el),
      amount: o.over,
    });
  }

  /* --------------------------------------------------------------------- TAP
     WCAG 2.5.5 target size. Applied to genuinely interactive things only;
     inline links inside a paragraph are exempt under the "inline" exception.
  */
  const INTERACTIVE = "a[href], button, input, select, textarea, [role=button]";
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    const s = getComputedStyle(el);
    if (invisible(el, s)) continue;
    if (deliberatelyHidden(el)) continue;
    /* Not reachable by keyboard or pointer, so it has no target to size. */
    if (el.getAttribute("tabindex") === "-1") continue;
    if (s.display === "inline") continue; // inline exception

    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (el.closest("p, li")) {
      // Inline link inside prose — exempt, unless it is a styled block.
      if (s.display.startsWith("inline") && !s.display.includes("flex")) continue;
    }
    if (r.height < 44 || r.width < 24) {
      findings.push({
        kind: "tap",
        selector: describe(el),
        detail:
          Math.round(r.width) + "x" + Math.round(r.height) + "px " + label(el),
        amount: 44 - r.height,
      });
    }
  }

  /* -------------------------------------------------------------------- CLIP
     An element taller than an overflow-hidden ancestor is losing content with
     no way to reach it — the vertical twin of the problem above.
  */
  for (const el of document.querySelectorAll("body *")) {
    const s = getComputedStyle(el);
    if (s.overflow !== "hidden" && s.overflowY !== "hidden") continue;
    if (deliberatelyHidden(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.height === 0) continue;
    /* An aspect-ratio frame cropping a cover image is the intended behaviour
       of ImageSlot, not content being lost. */
    if (el.querySelector(":scope > img")) continue;
    if (el.scrollHeight - el.clientHeight > 2) {
      findings.push({
        kind: "clip",
        selector: describe(el),
        detail:
          (el.scrollHeight - el.clientHeight) + "px of content clipped " + label(el),
        amount: el.scrollHeight - el.clientHeight,
      });
    }
  }

  return findings;
})()`;

async function probe(page: Page, route: string, width: number) {
  await page.setViewportSize({ width, height: HEIGHT });
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
  /* Fluid type settles after fonts load; measuring before that reports the
     fallback face's metrics, which are not the ones that ship. */
  await page.evaluate(() => document.fonts.ready);
  return (await page.evaluate(PROBE)) as Omit<Finding, "route" | "width">[];
}

/**
 * An explicitly provided browser binary, where the environment has one.
 *
 * `chromium.launch()` resolves a build revision pinned to the installed
 * Playwright, and a CI image that ships a different one fails with a message
 * telling the operator to download a browser they already have. That is a real
 * hour lost, and the fix is one environment variable.
 *
 * Unset in normal use, which keeps the ordinary path exactly as it was.
 */
const launchOptions = process.env.PLAYWRIGHT_CHROMIUM_PATH
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
  : {};

async function run() {
  let browser: Browser;
  try {
    browser = await chromium.launch(launchOptions);
  } catch {
    console.error(
      red(
        "\nCould not launch Chromium. Run `npx playwright install chromium`," +
          "\nor set PLAYWRIGHT_CHROMIUM_PATH to a browser this machine has.\n",
      ),
    );
    process.exit(1);
  }

  const page = await browser.newPage();

  /* Fail fast with a useful message rather than 272 confusing timeouts. */
  try {
    /* Generous: a cold dev server compiles the route on first request. */
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  } catch {
    console.error(
      red(`\nNo server at ${BASE}. Start one with \`npm run dev\`, or pass --url.\n`),
    );
    await browser.close();
    process.exit(1);
  }

  const findings: Finding[] = [];

  console.log(
    `\n${bold("Responsive audit")} ${dim(`${ROUTES.length} routes x ${WIDTHS.length} widths — ${BASE}`)}`,
  );

  for (const route of ROUTES) {
    const routeFindings: Finding[] = [];

    for (const width of WIDTHS) {
      let raw: Omit<Finding, "route" | "width">[];
      try {
        raw = await probe(page, route, width);
      } catch (e) {
        console.log(`  ${yellow("skip")}  ${route} @ ${width} ${dim(String(e).slice(0, 60))}`);
        continue;
      }
      for (const f of raw) routeFindings.push({ ...f, route, width });

      if (WITH_MENU && width < 1024) {
        const trigger = page.locator('button[aria-controls="mobile-nav"]');
        if (await trigger.count()) {
          await trigger.first().click();
          const menuRaw = (await page.evaluate(PROBE)) as Omit<Finding, "route" | "width">[];
          for (const f of menuRaw) {
            routeFindings.push({ ...f, route: `${route} (menu open)`, width });
          }
        }
      }
    }

    findings.push(...routeFindings);

    /* Collapse to one line per route: a bug present at nine widths is one bug,
       and printing it nine times hides the other eight bugs. */
    const overflow = routeFindings.filter((f) => f.kind === "overflow");
    const tap = routeFindings.filter((f) => f.kind === "tap");
    const clip = routeFindings.filter((f) => f.kind === "clip");
    const ok = routeFindings.length === 0;

    const parts = [
      overflow.length ? red(`${uniq(overflow).length} overflow`) : "",
      tap.length ? yellow(`${uniq(tap).length} tap`) : "",
      clip.length ? red(`${uniq(clip).length} clip`) : "",
    ].filter(Boolean);

    console.log(
      `  ${ok ? green("ok  ") : red("FAIL")}  ${route.padEnd(20)} ${parts.join(" ")}`,
    );
  }

  await browser.close();
  report(findings);
}

/** Distinct selector+kind pairs — the unit a developer actually fixes. */
function uniq(list: Finding[]) {
  return [...new Set(list.map((f) => `${f.kind}|${f.selector}`))];
}

function report(findings: Finding[]) {
  if (findings.length === 0) {
    console.log(`\n${green(bold("Responsive audit passed."))}\n`);
    return;
  }

  /* Group by the thing being fixed, not by where it was seen. One component
     bug appears on twelve routes; it is still one fix. */
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = `${f.kind}|${f.selector}|${f.detail.replace(/^\d+px/, "")}`;
    const list = groups.get(key) ?? [];
    list.push(f);
    groups.set(key, list);
  }

  const ranked = [...groups.values()].sort(
    (a, b) => Math.max(...b.map((f) => f.amount)) - Math.max(...a.map((f) => f.amount)),
  );

  console.log(`\n${bold("Findings")} ${dim(`${ranked.length} distinct, ${findings.length} occurrences`)}\n`);

  for (const group of ranked) {
    const f = group[0];
    const widths = [...new Set(group.map((g) => g.width))].sort((a, b) => a - b);
    const routes = [...new Set(group.map((g) => g.route))];
    const tag =
      f.kind === "overflow" ? red("overflow") : f.kind === "clip" ? red("clip    ") : yellow("tap     ");

    console.log(`  ${tag}  ${bold(f.selector)}`);
    console.log(`            ${f.detail}`);
    console.log(
      `            ${dim(`@ ${widths.join(", ")}`)}`,
    );
    console.log(
      `            ${dim(`on ${routes.slice(0, 4).join(", ")}${routes.length > 4 ? ` +${routes.length - 4} more` : ""}`)}\n`,
    );
  }

  const blocking = findings.filter((f) => f.kind !== "tap");
  if (blocking.length) {
    console.log(red(bold(`Responsive audit failed — ${uniq(blocking).length} layout defect(s).\n`)));
    process.exit(1);
  }

  console.log(yellow(bold("Tap-target warnings only — not blocking.\n")));
}

run();
