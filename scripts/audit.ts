/**
 * POST-BUILD OUTPUT AUDIT
 *
 *   npm run audit     (requires a prior `npm run build`)
 *
 * Design Specification §9 lists eight acceptance criteria. When Workstream 1
 * shipped, five of them were marked "manual sign-off — cannot be automated".
 * That was true of the code, but not of the OUTPUT: once pages prerender to
 * HTML, several of those criteria become greppable facts.
 *
 * This script reads the prerendered HTML in .next/server/app and asserts them.
 * No server required, so it runs in CI directly after the build.
 *
 * What it now catches automatically:
 *   · No membership price published anywhere on the public site  (§9)
 *   · The "Shooting Sports Club" descriptor in every page title  (Brand §2)
 *   · Unlisted and internal routes are noindex, public routes are not  (§2)
 *   · Private routes are linked from no public page  (§2)
 *   · robots.txt does not advertise private paths
 *   · sitemap.xml excludes private routes
 *   · No forbidden vocabulary from the "we never say" list  (Brand §9)
 *   · No exclamation marks — the voice rule forbids hype  (Brand §9)
 *
 * What still needs a human: the three-minute mobile booking, the application
 * landing with a named owner, LCP on a real Android device, refund terms before
 * payment, and whether every claim is true today. Those are listed by
 * `npm run gate:launch`.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const APP = join(process.cwd(), ".next", "server", "app");

/** Route path → prerendered file, mirroring spec §2. */
const PUBLIC_ROUTES: Record<string, string> = {
  "/": "index.html",
  "/membership": "membership.html",
  "/first-visit": "first-visit.html",
  "/ranges": "ranges.html",
  "/the-club": "the-club.html",
  "/groups": "groups.html",
  "/sport": "sport.html",
  "/leagues": "leagues.html",
  "/enquire": "enquire.html",
  "/legal/privacy": "legal/privacy.html",
  "/legal/terms": "legal/terms.html",
  "/legal/refunds": "legal/refunds.html",
};

/** Unlisted by specification, plus the internal design references. */
const PRIVATE_ROUTES: Record<string, string> = {
  "/institutional": "institutional.html",
  "/brand": "brand.html",
  "/brand/components": "brand/components.html",
};

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

const failures: string[] = [];
const fail = (msg: string) => failures.push(msg);

if (!existsSync(APP)) {
  console.error(red("\nNo build output found. Run `npm run build` first.\n"));
  process.exit(1);
}

const read = (file: string) => readFileSync(join(APP, file), "utf8");

/** Strip scripts, comments and tags — React's RSC payload and its
    `<!-- -->` text-node separators both defeat naive matching otherwise. */
function visibleText(raw: string): string {
  let doc = raw.replace(/<script[\s\S]*?<\/script>/g, "");
  doc = doc.replace(/<!--[\s\S]*?-->/g, "");
  doc = doc.replace(/<[^>]+>/g, " ");
  return decode(doc).replace(/\s+/g, " ");
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"');
}

const titleOf = (raw: string) =>
  decode(raw.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");

const robotsMetaOf = (raw: string) =>
  raw.match(/<meta name="robots" content="([^"]*)"/)?.[1] ?? "";

function section(name: string, ref: string) {
  console.log(`\n${bold(name)} ${dim(ref)}`);
}

function line(ok: boolean, label: string, detail = "") {
  console.log(`  ${ok ? green("ok  ") : red("FAIL")}  ${label}${detail ? `  ${dim(detail)}` : ""}`);
}

/* ------------------------------------------------------------------- PRICES */

section("No membership price published", "§9 acceptance criterion");

/* Naira or dollar amounts, thousands-separated figures, and recurring-fee
   phrasing. "On application" is the only legal answer to what it costs. */
const PRICE = /[₦$]\s?\d|NGN\s?\d|\b\d{2,3},\d{3}\b|\bper (?:month|year|annum)\b/gi;

for (const [route, file] of Object.entries(PUBLIC_ROUTES)) {
  const hits = visibleText(read(file)).match(PRICE) ?? [];
  if (hits.length) fail(`${route}: price-like token(s) ${JSON.stringify(hits.slice(0, 3))}`);
  line(hits.length === 0, route.padEnd(18), hits.length ? hits.slice(0, 3).join(", ") : "");
}

/* --------------------------------------------------------------- DESCRIPTOR */

section("Descriptor in every page title", "Brand Guidelines §2");

for (const [route, file] of Object.entries({ ...PUBLIC_ROUTES, ...PRIVATE_ROUTES })) {
  const t = titleOf(read(file));
  const ok = t.includes("Shooting Sports Club");
  if (!ok) fail(`${route}: title missing descriptor — ${JSON.stringify(t)}`);
  line(ok, route.padEnd(18), t);
}

/* -------------------------------------------------------------- INDEXABILITY */

section("Indexability", "§2 — unlisted and internal routes");

for (const [route, file] of Object.entries(PRIVATE_ROUTES)) {
  const r = robotsMetaOf(read(file));
  const ok = r.includes("noindex");
  if (!ok) fail(`${route}: must be noindex, found ${JSON.stringify(r)}`);
  line(ok, route.padEnd(18), r || "(no robots meta)");
}

for (const [route, file] of Object.entries(PUBLIC_ROUTES)) {
  const r = robotsMetaOf(read(file));
  if (r.includes("noindex")) {
    fail(`${route}: public page is marked noindex`);
    line(false, route.padEnd(18), r);
  }
}

/* ------------------------------------------------------------- LINK LEAKAGE */

section("Private routes linked from no public page", "§2");

for (const [route, file] of Object.entries(PUBLIC_ROUTES)) {
  const raw = read(file);
  const leaked = Object.keys(PRIVATE_ROUTES).filter((p) => raw.includes(`href="${p}"`));
  if (leaked.length) fail(`${route}: links to ${leaked.join(", ")}`);
  line(leaked.length === 0, route.padEnd(18), leaked.join(", "));
}

/* -------------------------------------------------- ROBOTS.TXT AND SITEMAP */

section("robots.txt and sitemap.xml", "");

if (existsSync(join(APP, "robots.txt.body"))) {
  const rb = read("robots.txt.body");
  /* Listing a private path here would publish it — robots.txt is public. */
  const advertised = ["institutional", "/brand"].filter((t) => rb.includes(t));
  if (advertised.length) fail(`robots.txt advertises private paths: ${advertised.join(", ")}`);
  line(advertised.length === 0, "robots.txt does not advertise private paths");
}

if (existsSync(join(APP, "sitemap.xml.body"))) {
  const sm = read("sitemap.xml.body");
  const bad = ["institutional", "brand"].filter((t) => sm.includes(t));
  if (bad.length) fail(`sitemap.xml includes private paths: ${bad.join(", ")}`);
  line(bad.length === 0, "sitemap.xml excludes private routes", `${(sm.match(/<url>/g) ?? []).length} urls`);
}

/* ---------------------------------------------------------------- VOCABULARY */

section("Forbidden vocabulary", 'Brand Guidelines §9 — "we never say"');

const BANNED = [
  "tactical", "operator", "dominate", "firepower",
  "unleash", "adrenaline", "ultimate experience",
  "self-defence", "self defense", "world-class",
];

for (const [route, file] of Object.entries(PUBLIC_ROUTES)) {
  const txt = visibleText(read(file)).toLowerCase();
  const hits = BANNED.filter((w) => txt.includes(w));
  if (hits.length) fail(`${route}: forbidden vocabulary ${hits.join(", ")}`);
  line(hits.length === 0, route.padEnd(18), hits.join(", "));
}

/* --------------------------------------------------- UNFULFILLABLE PROMPTS */

section("No instruction the page cannot fulfil", "§9 — claims true on the day");

/*
 * Found in review rather than by any existing check, in five places.
 *
 * `Pending` renders nothing in production, which is right — it stops invented
 * placeholder data reaching a visitor. But it makes this easy to write:
 *
 *     Prefer to book by phone? <Resolved value={contact.bookingsPhone} … />
 *
 * In development that reads correctly. In production, with the number still
 * outstanding, it renders the question followed by nothing — an instruction the
 * page cannot help anyone follow. It breaks §9 by OMISSION rather than by
 * invention, which is why nothing else caught it: there is no bad string to
 * grep for, only missing text after a prompt.
 *
 * So: if a page tells someone to call, it must carry a `tel:` link.
 */
const CALL_PROMPTS = [
  "call us",
  "book by phone",
  "calling is faster",
  "give us a call",
  "call the club",
  "ask for the name listed",
];

for (const [route, file] of Object.entries(PUBLIC_ROUTES)) {
  const raw = read(file);
  const text = visibleText(raw).toLowerCase();
  const prompts = CALL_PROMPTS.filter((p) => text.includes(p));
  const hasTel = raw.includes("tel:");

  if (prompts.length > 0 && !hasTel) {
    fail(
      `${route}: prompts to call (${prompts.join(", ")}) but renders no tel: link`,
    );
    line(false, route.padEnd(18), prompts.join(", "));
  } else {
    line(true, route.padEnd(18), prompts.length ? `${prompts.length} prompt(s), tel: present` : "");
  }
}

/* -------------------------------------------------------------------- HYPE */

section("No exclamation marks", "Brand Guidelines §9 — no hype");

for (const [route, file] of Object.entries(PUBLIC_ROUTES)) {
  const n = (visibleText(read(file)).match(/!/g) ?? []).length;
  if (n) fail(`${route}: ${n} exclamation mark(s)`);
  line(n === 0, route.padEnd(18), n ? String(n) : "");
}

/* ------------------------------------------------------------------ RESULT */

if (failures.length) {
  console.log(`\n${red(bold(`Audit failed — ${failures.length} issue(s).`))}`);
  for (const f of failures) console.log(`  ${red("-")} ${f}`);
  console.log();
  process.exit(1);
}

console.log(`\n${green(bold("Audit passed."))} ${dim(`${Object.keys(PUBLIC_ROUTES).length} public routes, ${Object.keys(PRIVATE_ROUTES).length} private.`)}\n`);
