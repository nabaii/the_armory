/**
 * PRE-LAUNCH GATE
 *
 *   npm run gate            contrast audit + outstanding-content report
 *   npm run gate -- --launch  additionally fails if any launch blocker remains
 *
 * Design Specification §9 lists eight acceptance criteria and §8 lists nine
 * required content items. In a Word document both are advisory. This script
 * makes the machine-checkable half enforceable and prints the rest, so the
 * launch decision is made against a list rather than a feeling.
 *
 * Contrast failures fail ALWAYS, in every mode. They are code defects: the
 * palette either meets WCAG 2.1 AA or the build is not shippable, and unlike
 * missing copy there is no version of launch day where they become acceptable.
 */

import { auditRequiredPairs } from "../src/lib/contrast";
import { contentGate, gateSummary } from "../src/lib/content-gate";

const launchMode = process.argv.includes("--launch");

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

let failed = false;

/* ------------------------------------------------------------------ CONTRAST */

console.log(`\n${bold("WCAG 2.1 AA — required colour pairs")}`);
console.log(dim("  body text >= 4.5:1 · large text and non-text >= 3:1\n"));

const audit = auditRequiredPairs();
const widest = Math.max(...audit.map((a) => `${a.fg} on ${a.bg}`.length));

for (const a of audit) {
  const pair = `${a.fg} on ${a.bg}`.padEnd(widest);
  const ratio = `${a.ratio.toFixed(2)}:1`.padStart(7);
  if (a.pass) {
    console.log(`  ${green("PASS")}  ${pair}  ${ratio}  ${dim(a.role)}`);
  } else {
    failed = true;
    console.log(
      `  ${red("FAIL")}  ${pair}  ${ratio}  ` +
        red(`needs ${a.threshold}:1 — ${a.role}`),
    );
  }
}

/* ------------------------------------------------------------------- CONTENT */

const summary = gateSummary();

console.log(`\n${bold("Outstanding content")} ${dim("(Design Specification §8)")}`);
console.log(
  dim(
    `  ${summary.resolved}/${summary.total} resolved · ` +
      `${summary.blockers} Phase 1 launch blocker${summary.blockers === 1 ? "" : "s"} · ` +
      `${summary.phase2Blockers} Phase 2 (Leagues) blocker${summary.phase2Blockers === 1 ? "" : "s"}\n`,
  ),
);

/* Phase 1 and Phase 2 are separate launches with separate gates. Printing them
   together would make a targeting-system question look like it holds up a
   website, which it does not. */
const render = (item: (typeof contentGate)[number]) => {
  const tag = item.severity === "blocker" ? red("BLOCKER ") : yellow("degraded");
  console.log(`  ${tag}  ${item.label}  ${dim(`[${item.owner}]`)}`);
  if (item.note) {
    for (const line of wrap(item.note, 74)) console.log(dim(`              ${line}`));
  }
};

const phase1Outstanding = contentGate.filter((i) => !i.resolved && (i.phase ?? 1) === 1);
const phase2Outstanding = contentGate.filter((i) => !i.resolved && i.phase === 2);

for (const item of phase1Outstanding) render(item);

if (phase2Outstanding.length > 0) {
  console.log(
    `\n  ${dim("── Phase 2 — Leagues. Blocks Leagues opening, not the Phase 1 launch.")}\n`,
  );
  for (const item of phase2Outstanding) render(item);
}

if (launchMode && summary.blockers > 0) {
  failed = true;
  console.log(
    `\n${red(bold("Launch blocked."))} ` +
      `${summary.blockers} required item${summary.blockers === 1 ? "" : "s"} outstanding.`,
  );
}

/* -------------------------------------------------------------- MANUAL CHECKS
   The remaining §9 criteria cannot be asserted from source. They are printed
   so they are signed off deliberately rather than assumed.
   -------------------------------------------------------------------------- */

if (launchMode) {
  console.log(`\n${bold("Manual sign-off required")} ${dim("(§9 — cannot be automated)")}`);
  for (const check of [
    "A first-time visitor can book and pay for a first visit on a mobile device in under three minutes.",
    "A membership application submits, confirms on screen, sends an automated email, and lands with a named owner.",
    "No membership price is published anywhere on the public site.",
    "No page reveals facility layout, entry points, storage or security arrangements — imagery AND alt text.",
    "Every claim on the site is true on the day it goes live.",
    "LCP under 2.5s on a mid-range Android over Nigerian mobile data, tested on a real device.",
    "Total initial payload under 1.5MB.",
    "Refund and deposit terms appear before payment is taken.",
    "The Leagues page captures a waitlist and promises nothing Phase 2 will not deliver.",
  ]) {
    console.log(`  ${dim("[ ]")}  ${check}`);
  }
}

/* ----------------------------------------------------- THE OFFLINE ACCEPTANCE
   Build Specification §8.5 and the §12 items that need hardware.

   Printed always, not only in launch mode, and that is deliberate. §11 requires
   this to be discharged BEFORE M2 begins — "if it cannot be, the schedule is
   wrong and it is better to know in week five than in month four" — so it has
   to be visible on an ordinary `npm run gate` rather than only in the check
   nobody runs until launch week.

   It cannot be automated by construction. §8.5: "Browser devtools offline mode
   does not substitute for it and must not be accepted as evidence." A test that
   a CI runner could pass would be the substitution the specification forbids,
   so the honest thing a script can do is refuse to let it be forgotten.

   Protocol and recording sheet: docs/M1_offline_acceptance.md
   -------------------------------------------------------------------------- */

console.log(
  `\n${bold("Offline acceptance")} ${dim("(§8.5 — hardware only, cannot be automated)")}`,
);
console.log(
  dim(
    "  Required before M2 (§11). Devtools offline mode is not evidence.\n" +
      "  Protocol: docs/M1_offline_acceptance.md\n",
  ),
);
for (const check of [
  "Cold start with no network reaches a usable desk screen in under one second, on the tablet model being purchased.",
  "A guest blocked for host absence clears by itself when the host checks in, with no reload.",
  "Power physically pulled mid-session: every record is present on reopening.",
  "On reconnection, every record reaches the server exactly once.",
  "A record deliberately delivered twice produces one row, on the live database.",
  "A revoked tablet is wiped on next launch, and cannot open its cached shell offline.",
  "A device past the offline bound stays refused after its clock is wound backwards.",
]) {
  console.log(`  ${dim("[ ]")}  ${check}`);
}

console.log(
  failed
    ? `\n${red(bold("Gate failed."))}\n`
    : `\n${green(bold("Gate passed."))}${launchMode ? "" : dim("  (run with --launch for the full pre-launch check)")}\n`,
);

process.exit(failed ? 1 : 0);

function wrap(text: string, width: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + w).length > width) {
      lines.push(line.trimEnd());
      line = "";
    }
    line += `${w} `;
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}
