/**
 * WORKSTREAM 5 — HARDENING GATE
 *
 *   npm run start   # in another terminal, against a PRODUCTION build
 *   npm run harden
 *
 * Design Specification §9 makes two things acceptance criteria that cannot be
 * asserted, only measured:
 *
 *   "The site passes WCAG 2.1 AA and meets the stated performance budget on a
 *    mid-range Android device over Nigerian mobile data."
 *
 * So this runs three phases against a real browser:
 *
 *   1. ACCESSIBILITY — axe-core, WCAG 2.1 A + AA, every route at desktop and
 *      mobile, plus the states a static scan cannot reach (menu open, form
 *      error states).
 *   2. PERFORMANCE — 4x CPU throttle and Slow 4G, measuring LCP, CLS and true
 *      over-the-wire transfer.
 *   3. INTERACTION — the §7 requirements axe does not cover: reduced motion,
 *      keyboard navigability, visible focus, and the mobile menu focus trap.
 *
 * MUST be run against `npm run build && npm run start`. A dev build is
 * unminified, ships HMR, and will fail the budget for reasons that do not
 * exist in production.
 */

import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";

const BASE = process.env.BASE ?? "http://localhost:3000";

const ROUTES = [
  "/", "/membership", "/first-visit", "/ranges", "/the-club",
  "/groups", "/sport", "/leagues", "/enquire",
  "/legal/privacy", "/legal/terms", "/legal/refunds",
  "/membership/received", "/groups/received", "/leagues/joined",
  /* The component inventory. Not a page a member loads, and the only route
     where the members-app components (§11) can be scanned at all — every
     surface that uses them for real is behind a session. */
  "/brand/components",
];

const PERF_ROUTES = ["/", "/first-visit", "/membership", "/ranges", "/the-club"];

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/* Mid-range Android: the multiplier Lighthouse applies for its mobile profile.
   Nigerian mobile data: Chrome "Slow 4G". Deliberately conservative — the point
   of a budget is that it holds on a bad day, not an average one. */
const CPU_THROTTLE = 4;
const NETWORK = {
  offline: false,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
  latency: 150,
};

const BUDGET = { lcpMs: 2500, payloadBytes: 1.5 * 1024 * 1024, cls: 0.1 };

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const failures = [];
const line = (ok, label, detail = "") =>
  console.log(`  ${ok ? green("ok  ") : red("FAIL")}  ${label}${detail ? `  ${dim(detail)}` : ""}`);

async function reachable() {
  try {
    const r = await fetch(BASE, { signal: AbortSignal.timeout(5000) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Wait for a subtree's entry animations to finish before scanning it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NECESSARY, AND WHY A SLEEP WOULD NOT BE ENOUGH
 *
 * The mobile menu panel enters with a fade (`.u-enter`). axe computes colour
 * contrast from rendered colours, so scanning mid-fade measures a partially
 * transparent element against whatever is behind it and reports a contrast
 * failure that does not exist once the animation lands.
 *
 * This produced a genuine false positive: axe flagged the panel's primary CTA,
 * while the computed colours were white on Ten Ring Deep — 5.73:1, comfortably
 * passing. Worse, it is a RACE, so it passed in Workstream 5 and failed here on
 * identical markup. A gate that reports a different answer each run teaches
 * people to ignore it.
 *
 * Waiting on the actual Animation objects is exact, unlike a fixed sleep which
 * is either too short on a slow machine or wasted time on a fast one.
 * ---------------------------------------------------------------------------
 */
async function settle(page, selector) {
  await page.evaluate(async (sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const animations = el.getAnimations({ subtree: true });
    await Promise.all(animations.map((a) => a.finished.catch(() => {})));
  }, selector);
}

/* ------------------------------------------------------------ 1. AXE ----- */

async function accessibility(browser) {
  console.log(`\n${bold("Accessibility")} ${dim("axe-core · WCAG 2.1 AA")}`);

  const scan = async (page, label) => {
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    line(
      violations.length === 0,
      label.padEnd(34),
      violations.map((v) => `${v.id}(${v.nodes.length})`).join(" "),
    );
    for (const v of violations) {
      failures.push(
        `a11y ${label}: ${v.id} [${v.impact}] — ${v.help} · ${v.nodes[0]?.target.join(" ")}`,
      );
    }
  };

  for (const vp of [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    for (const route of ROUTES) {
      const context = await browser.newContext({ viewport: vp });
      const page = await context.newPage();
      await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60000 });
      await page.evaluate(() => document.fonts.ready);
      await scan(page, `${vp.name} ${route}`);
      await context.close();
    }
  }

  /**
   * States a static scan never reaches.
   *
   * The mobile navigation drawer is one of them, and it no longer exists: the
   * navigation moved to the always-visible bottom bar (see BottomNav.tsx —
   * "a hamburger in the opposite corner is the one detail that marks a site as
   * a site"). The bar is in the DOM on every route, so the static scans above
   * already cover what this step used to cover.
   *
   * The step is kept and made conditional rather than deleted, because it is
   * the hook every future modal, sheet and drawer belongs on — and because an
   * audit that crashes on a selector nobody has looked at in three milestones
   * is an audit that stops being run. It crashed on exactly that.
   */
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(BASE + "/", { waitUntil: "networkidle" });

  const drawerTrigger = page.locator('button[aria-controls="mobile-nav"]');
  if ((await drawerTrigger.count()) > 0) {
    await drawerTrigger.click();
    await page.waitForSelector("#mobile-nav");
    await settle(page, "#mobile-nav");
    await scan(page, "mobile menu open");
  } else {
    console.log(dim("  --    mobile menu — no drawer in this build (bottom bar)"));
  }

  await context.close();
}

/* ---------------------------------------------------- 2. PERFORMANCE ----- */

/**
 * How slow an UNTHROTTLED homepage load may be before the host is considered
 * too busy for a trustworthy throttled measurement.
 *
 * Measured on this project: a quiet machine loads the homepage unthrottled in
 * roughly 550ms. When the host is contended that rises, and the 4x-CPU +
 * Slow-4G combination degrades super-linearly — 1892ms (CPU only) and 992ms
 * (network only) became 6388ms combined, with a 2472ms spread across five runs
 * of identical code. A single sample under those conditions says nothing about
 * the site.
 */
const HOST_HEALTH_LCP_MS = 1500;

/** Median of repeated samples, so one scheduling hiccup cannot fail the gate. */
const PERF_SAMPLES = 5;

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

async function performance(browser) {
  console.log(
    `\n${bold("Performance")} ${dim(`${CPU_THROTTLE}x CPU · Slow 4G 1.6Mbit/s · ${NETWORK.latency}ms RTT · median of ${PERF_SAMPLES}`)}`,
  );

  /* ---------------------------------------------------------------------
     HOST HEALTH CHECK, FIRST.

     A throttled measurement on a contended machine is not a slow site — it is
     a meaningless number. Reporting it as a code failure sends someone
     optimising a page that is already fast, and reporting it as a pass would
     be worse. So the host is checked before its verdict is trusted.
     ------------------------------------------------------------------ */
  const baseline = await measureOnce(browser, "/", { throttle: false });
  const healthy = baseline.lcp > 0 && baseline.lcp <= HOST_HEALTH_LCP_MS;

  line(
    healthy,
    "host is quiet enough to measure".padEnd(34),
    `unthrottled LCP ${Math.round(baseline.lcp)}ms (limit ${HOST_HEALTH_LCP_MS}ms)`,
  );

  if (!healthy) {
    failures.push(
      `perf: host too contended to measure — unthrottled LCP ${Math.round(baseline.lcp)}ms ` +
        `exceeds ${HOST_HEALTH_LCP_MS}ms. Throttled figures would be noise, not a verdict. ` +
        `Close other work or run this in CI.`,
    );
    console.log(
      dim(
        "  Skipping throttled measurement: on a busy host the 4x CPU and Slow 4G\n" +
          "  throttles compound super-linearly and the result reflects the machine,\n" +
          "  not the site.",
      ),
    );
    return;
  }

  console.log(
    dim(
      "  route".padEnd(20) + "FCP".padStart(8) + "LCP".padStart(9) +
        "CLS".padStart(8) + "transfer".padStart(11) + "spread".padStart(9),
    ),
  );

  for (const route of PERF_ROUTES) {
    const samples = [];
    for (let i = 0; i < PERF_SAMPLES; i += 1) {
      samples.push(await measureOnce(browser, route, { throttle: true }));
    }

    const lcps = samples.map((s) => s.lcp);
    const lcp = median(lcps);
    const spread = Math.max(...lcps) - Math.min(...lcps);
    const fcp = median(samples.map((s) => s.fcp));
    const cls = Math.max(...samples.map((s) => s.cls));
    const transferred = median(samples.map((s) => s.transferred));

    /* A zero LCP means the instrument failed, not that the page was instant.
       Never report that as a pass. */
    const captured = lcp > 0;
    const ok =
      captured && lcp < BUDGET.lcpMs && transferred < BUDGET.payloadBytes && cls < BUDGET.cls;

    if (!captured) failures.push(`perf ${route}: LCP not captured — measurement failed`);
    else if (lcp >= BUDGET.lcpMs)
      failures.push(
        `perf ${route}: median LCP ${Math.round(lcp)}ms exceeds ${BUDGET.lcpMs}ms ` +
          `(samples ${lcps.map(Math.round).join(", ")})`,
      );
    if (transferred >= BUDGET.payloadBytes)
      failures.push(`perf ${route}: payload ${(transferred / 1024).toFixed(0)}KB over budget`);
    if (cls >= BUDGET.cls) failures.push(`perf ${route}: CLS ${cls.toFixed(3)} exceeds 0.1`);

    console.log(
      `  ${ok ? green("ok  ") : red("FAIL")}  ` +
        route.padEnd(14) +
        `${Math.round(fcp)}ms`.padStart(8) +
        `${Math.round(lcp)}ms`.padStart(9) +
        cls.toFixed(3).padStart(8) +
        `${(transferred / 1024).toFixed(0)}KB`.padStart(11) +
        `${Math.round(spread)}ms`.padStart(9),
    );
  }
  console.log(
    dim(`  budget: LCP < ${BUDGET.lcpMs}ms · payload < 1536KB · CLS < ${BUDGET.cls}`),
  );
}

/** One measured load. `throttle: false` is the host-health baseline. */
async function measureOnce(browser, route, { throttle }) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  /* Observers must exist BEFORE navigation, with `buffered: true`.
     `getEntriesByType("largest-contentful-paint")` returns nothing, which
     reads as a perfect 0ms rather than as a failed measurement. */
  await page.addInitScript(() => {
    window.__perf = { lcp: 0, cls: 0 };
    new PerformanceObserver((l) => {
      const e = l.getEntries();
      window.__perf.lcp = e[e.length - 1].startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  });

  const client = await context.newCDPSession(page);
  await client.send("Network.enable");
  if (throttle) {
    await client.send("Network.emulateNetworkConditions", NETWORK);
    await client.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
  }

  /* True over-the-wire bytes. `content-length` is absent on compressed and
     chunked responses, so summing headers under-reports badly. */
  let transferred = 0;
  client.on("Network.loadingFinished", (e) => {
    transferred += e.encodedDataLength || 0;
  });

  await page.goto(BASE + route, { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(throttle ? 3500 : 1500);

  const m = await page.evaluate(() => {
    const fcp = window.performance
      .getEntriesByType("paint")
      .find((p) => p.name === "first-contentful-paint");
    return { ...window.__perf, fcp: fcp ? fcp.startTime : 0 };
  });
  await context.close();
  return { ...m, transferred };
}

/* ----------------------------------------------------- 3. INTERACTION --- */

async function interaction(browser) {
  console.log(`\n${bold("Interaction")} ${dim("§7 — reduced motion, keyboard, focus")}`);

  /* Reduced motion. */
  for (const reduce of [false, true]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: reduce ? "reduce" : "no-preference",
    });
    const page = await context.newPage();
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    const animated = await page.evaluate(() => {
      let n = 0;
      for (const el of document.querySelectorAll("*")) {
        const s = getComputedStyle(el);
        const d =
          parseFloat(s.transitionDuration || "0") + parseFloat(s.animationDuration || "0");
        if ((s.transitionProperty !== "none" || s.animationName !== "none") && d > 0.001) n += 1;
      }
      return n;
    });
    if (reduce) {
      line(animated === 0, "prefers-reduced-motion: reduce".padEnd(34), `${animated} animated`);
      if (animated > 0) failures.push(`reduced motion: ${animated} element(s) still animate`);
    } else {
      line(true, "prefers-reduced-motion: none".padEnd(34), `${animated} animated`);
    }
    await context.close();
  }

  /* Keyboard: focus ring on every stop, skip link first. */
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(BASE + "/", { waitUntil: "networkidle" });

    let noRing = 0;
    let firstText = "";
    for (let i = 0; i < 14; i += 1) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          text: (el.textContent || "").trim().slice(0, 30),
          hasRing:
            (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) ||
            (s.boxShadow && s.boxShadow !== "none"),
          offscreen: r.width === 0 && r.height === 0,
        };
      });
      if (!info) break;
      if (i === 0) firstText = info.text;
      if (!info.hasRing && !info.offscreen) noRing += 1;
    }
    line(noRing === 0, "visible focus on every tab stop".padEnd(34), noRing ? `${noRing} missing` : "");
    if (noRing) failures.push(`keyboard: ${noRing} focusable element(s) with no visible focus ring`);

    line(/skip/i.test(firstText), "skip link is first tab stop".padEnd(34), firstText);
    if (!/skip/i.test(firstText)) failures.push(`keyboard: first tab stop is "${firstText}"`);
    await context.close();
  }

  /* Mobile menu: trap, escape, focus return, scroll lock. */
  {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto(BASE + "/", { waitUntil: "networkidle" });

    /* Same conditional as the accessibility pass, for the same reason: the
       drawer was replaced by the always-visible bottom bar, and there is
       nothing to trap focus in. Kept as the hook for the next thing that
       genuinely does open over the page. */
    const trigger = page.locator('button[aria-controls="mobile-nav"]');
    if ((await trigger.count()) === 0) {
      console.log(dim("  --    mobile menu — no drawer in this build (bottom bar)"));
      await context.close();
      return;
    }

    await trigger.click();
    await page.waitForSelector("#mobile-nav");

    let escaped = false;
    for (let i = 0; i < 16; i += 1) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() =>
        document.querySelector("#mobile-nav")?.contains(document.activeElement) ?? false,
      );
      if (!inside) {
        escaped = true;
        break;
      }
    }
    line(!escaped, "mobile menu traps focus".padEnd(34));
    if (escaped) failures.push("mobile menu: focus trap leaks");

    const lockedWhileOpen = await page.evaluate(() => getComputedStyle(document.body).overflow);
    line(lockedWhileOpen === "hidden", "body scroll locked while open".padEnd(34), lockedWhileOpen);
    if (lockedWhileOpen !== "hidden") failures.push("mobile menu: body scroll not locked");

    await page.keyboard.press("Escape");
    const closed = await page.evaluate(() => !document.querySelector("#mobile-nav"));
    const refocused = await page.evaluate(
      () => document.activeElement?.getAttribute("aria-controls") === "mobile-nav",
    );
    line(closed, "escape closes the menu".padEnd(34));
    line(refocused, "focus returns to the trigger".padEnd(34));
    if (!closed) failures.push("mobile menu: escape does not close");
    if (!refocused) failures.push("mobile menu: focus not returned to trigger");

    await context.close();
  }
}

/* ---------------------------------------------------------------- RUN --- */

if (!(await reachable())) {
  console.error(
    red(`\nNo server at ${BASE}.\n`) +
      dim("  Run a PRODUCTION build first:  npm run build && npm run start\n") +
      dim("  A dev build ships HMR and unminified code and will fail the budget.\n"),
  );
  process.exit(1);
}

/**
 * Chrome by channel, unless the environment names a binary.
 *
 * `channel: "chrome"` is deliberate — the performance budget is measured
 * against the browser the audience actually uses, not against a bundled build.
 * PLAYWRIGHT_CHROMIUM_PATH is the escape hatch for an image that ships one but
 * not the other, and it is unset in normal use.
 */
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
    : { channel: "chrome" },
);
try {
  await accessibility(browser);
  await performance(browser);
  await interaction(browser);
} finally {
  await browser.close();
}

console.log();
if (failures.length) {
  console.log(red(bold(`Hardening failed — ${failures.length} issue(s).`)));
  for (const f of failures) console.log(`  ${red("-")} ${f}`);
  console.log();
  process.exit(1);
}
console.log(green(bold("Hardening passed.")) + dim(" WCAG 2.1 AA, performance budget, interaction."));
console.log();
