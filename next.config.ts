import { execSync } from "node:child_process";
import type { NextConfig } from "next";

/**
 * THE BUILD ID THE SERVICE WORKER VERSIONS ITSELF BY.
 *
 * Members Portal §13.5:
 *
 *   "A stale service worker serving an old shell against a changed API is the
 *    most common way a progressive web application breaks in production and the
 *    hardest to diagnose from support messages. Required: … a version check on
 *    every application open, and a forced update path for breaking changes. A
 *    MEMBER SHOULD NEVER BE TOLD TO CLEAR THEIR BROWSER CACHE."
 *
 * `ServiceWorker.tsx` registers `/sw.js?v=<build>` and the worker names its
 * caches from the same value, so a changed build id is what makes the browser
 * fetch, compare and replace the worker on the next open.
 *
 * ===========================================================================
 * WHY IT IS DERIVED HERE AND NOT SET IN A DASHBOARD
 *
 * This is the third version of this mechanism and each replaced a way it could
 * silently fail.
 *
 *   1. A constant `"v1"` inside sw.js, bumped by hand. Fails on the deploy
 *      somebody was in a hurry for, and the symptom is a member on last
 *      month's shell talking to this month's server.
 *   2. `NEXT_PUBLIC_BUILD_ID` set in the Render dashboard. Better, and still a
 *      human step per deploy — a variable nobody updates is the constant in
 *      (1) wearing an environment variable's clothes.
 *   3. This: the deploy's own commit, read at build time. No step to forget.
 *
 * `NEXT_PUBLIC_*` values are inlined at build, so this must run here rather
 * than at request time.
 *
 * ===========================================================================
 * THE FALLBACK IS A TIMESTAMP, NOT A CONSTANT
 *
 * If neither the platform's commit variable nor git is available, this falls
 * back to the build's own clock. That is deliberately not `"dev"` or `"1"`:
 * an unknown build id that is CONSTANT re-creates exactly the failure this
 * exists to prevent, quietly, on whichever host happens to lack git. A
 * timestamp is always different between builds, which is the only property the
 * mechanism actually needs.
 *
 * It is coarse — to the minute — so that a rebuild of an unchanged commit does
 * not needlessly invalidate every member's cached shell.
 */
function buildId(): string {
  /* Render sets this during the build. Other platforms have their own —
     Vercel's VERCEL_GIT_COMMIT_SHA, Netlify's COMMIT_REF — and any of them can
     be added here without touching the worker or the registration. */
  const fromPlatform =
    process.env.RENDER_GIT_COMMIT ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.COMMIT_REF ??
    process.env.GITHUB_SHA;

  if (fromPlatform) return fromPlatform.slice(0, 12);

  try {
    return execSync("git rev-parse --short=12 HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    /* No git, no platform variable. See the note above on why this is a clock
       rather than a constant. */
    return `t${Math.floor(Date.now() / 60_000).toString(36)}`;
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId(),
  },
};

export default nextConfig;
