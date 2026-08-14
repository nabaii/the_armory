# The Armory Shooting Sports Club — website

Phase 1 launch site. Next.js 16 (App Router, RSC), Tailwind v4, TypeScript.

Source documents live in [`docs/`](docs/) and are the authority for every
decision in this codebase:

| Document | Governs |
| --- | --- |
| `01_The_Armory_Website_Design_Brief.docx` | Positioning, audiences, phasing, open decisions |
| `02_The_Armory_Design_Specification.docx` | Sitemap, page specs, flows, tokens, stack, acceptance criteria |
| `03_The_Armory_Brand_Guidelines.docx` | Identity, palette, typography, art direction, voice |
| `08_The_Armory_Leagues_Specification.pdf` | Tournament, League and Ladder — Phase 2 product spec |

⚠ **The Leagues Specification is not yet in `docs/`.** It arrived mid-build and
the codebase has been reconciled against it, but the file itself needs adding to
the repository so the next person can check the citations.

**One test governs every decision** (Brand Guidelines §11): does this belong in
a building of terrazzo, warm teak and pale blue soffits — or does it belong in
an armoury? Build the first.

---

## Commands

```bash
npm run db:generate  # Phase 2 — schema → SQL migration, no database needed
npm run db:migrate   # Phase 2 — apply migrations to DATABASE_URL
npm run dev          # development server
npm run build        # production build
npm run verify       # typecheck + lint + gate         ← before every PR
npm run verify:full  # the above + build + output audit ← before every deploy
npm run gate         # WCAG contrast audit + outstanding-content report
npm run gate:launch  # the above, and fails while any launch blocker remains
npm run audit        # post-build audit of the prerendered HTML (needs a build)
npm run responsive   # element geometry at 17 widths — overflow, tap size, clipping
                     # needs `npm run build && npm run start` in another terminal
npm run harden       # WCAG 2.1 AA + performance budget + interaction
                     # needs `npm run build && npm run start` in another terminal
npm run icons        # re-render public/icons/* from the mark (output is committed)
```

Two internal reference routes, both `noindex`. Start here:

- **`/brand`** — palette with computed contrast ratios, type scale, the ground
  system, graphic devices, and the outstanding-content register.
- **`/brand/components`** — the spec §5 component inventory, rendered with real
  content where the documents supply it and visibly scaffolded where they don't.

---

## Two deviations from Tailwind defaults — read before writing styles

**1. `--spacing` is 8px, not 4px.** Design Spec §6 mandates an 8px base unit and
the scale 8/16/24/32/48/64/96/128. That scale now maps onto Tailwind's integers:

```
p-1 = 8    p-2 = 16   p-3 = 24   p-4  = 32
p-6 = 48   p-8 = 64   p-12 = 96  p-16 = 128
```

A 4px value is not expressible, which is the point — "whitespace is the primary
signal of premium positioning". **This also affects width and height
utilities**: `h-12` is 96px here, not 48px. `size-1` is an 8px dot.

**2. Breakpoints are 480 / 768 / 1024 / 1440** (`sm` `md` `lg` `xl`) per spec §6.
`2xl` is removed.

**There is no dark mode.** Dark sections are a brand decision — Charred Timber,
chosen deliberately — not an OS preference. `not-found.tsx` and
`global-error.tsx` exist partly to replace Next's built-in defaults, which force
pure `#000`/`#fff` and a `prefers-color-scheme: dark` inversion that §11 forbids.

---

## The colour system

Colour is **never** chosen by a component. `Section` publishes four custom
properties per ground and everything downstream consumes them:

```
--ink          primary text      (always >= 4.5:1 on this ground)
--ink-muted    secondary text    (== --ink on single-ink grounds)
--rule         dividers, hairlines
--btn-fill / --btn-fill-ink      primary CTA
```

This is what makes the palette safe: a heading cannot land on VIP Teal in a
colour that fails contrast, because it does not pick its own colour.

### Two derived tokens were added by the build team

The Brand Guidelines assign Sight Grey to "secondary type" and Ten Ring Red to
"primary calls to action", then ask that both be verified against WCAG AA. Both
**fail at body size**, and spec §9 makes AA an acceptance criterion:

| Pair | Measured | Required |
| --- | --- | --- |
| white on Ten Ring Red `#ED3036` | 4.14:1 | 4.5:1 — fails |
| Sight Grey `#727377` on Chalk | 4.34:1 | 4.5:1 — fails |

Resolved without touching the visual system — the logo dot and graphic accent
keep the exact colours of the mark; only text-bearing surfaces use the deeper
values:

| Token | Value | Role | Measured |
| --- | --- | --- | --- |
| `ten-ring-red` | `#ED3036` | **unchanged** — dot, rings, graphic accent, large display | 3.79:1 on Chalk (clears the 3:1 graphic threshold) |
| `ten-ring-deep` | `#C81E24` | **new** — text-bearing red: button fills, links, small labels | 5.73:1 vs white · 5.25:1 on Chalk |
| `sight-grey` | `#727377` | **unchanged** — rules, dividers, quiet UI, large labels | as specified |
| `sight-ink` | `#5A5B5E` | **new** — secondary *text* | 6.23:1 on Chalk · 4.78:1 on Terrazzo |

`#D01F26` is the lightest red that still clears AA on both grounds, if the
founder wants to stay nearer the mark.

### Single-ink grounds

Three grounds admit **exactly one** compliant body-text colour:

| Ground | Valid body text | Verdict |
| --- | --- | --- |
| Charred Timber `#262523` | Chalk 14.05 · Terrazzo 10.78 · Deck Oak 5.90 · Soffit Blue 6.03 · Gabion 4.94 | layered text OK |
| Range Teak `#8A5A2E` | Chalk 5.38 **only** | single-ink |
| VIP Teal `#2F6E78` | Chalk 5.32 **only** | single-ink |
| Soffit Blue `#8FA6B2` | Reticle Black 5.64 **only** | single-ink, never white |

So Teak, Teal and Soffit Blue are **short-copy accent panels** — tier cards,
pull quotes, CTA blocks. Long dark sections and the footer must use Charred
Timber. Single-ink grounds resolve `--ink-muted` to `--ink`, so asking for muted
text degrades to full ink rather than silently shipping a contrast failure;
differentiate secondary text there with size and weight instead.

### The access register

Soffit Blue encodes **open** contexts, VIP Teal encodes **member** contexts,
mirroring the actual deck furniture so tiering is felt rather than announced:

| Page | Register |
| --- | --- |
| Home | neutral — photography carries it |
| The First Visit, Groups | Soffit Blue |
| Membership, The Club | VIP Teal |
| The Ranges | Range Teak + Charred Timber |
| Sport & Competition | Reticle Black on Chalk |

---

## Non-negotiables encoded in the codebase

- **The descriptor is part of the logo.** `Lockup` has no variant rendering the
  wordmark without "Shooting Sports Club". The only permitted reduction is the
  reticle alone (favicon, avatar, embroidery). It also appears in every metadata
  field — that is positioning, not SEO.
- **Tabular numerals** on all tables, `time`, `[data-numeric]` and the `Data`
  component. Figures that do not align look amateur, and the brand's claim is
  precision.
- **No personal data in the CMS, ever.** The CMS holds marketing copy and
  imagery only.
- **No imagery or alt text revealing facility layout, entry points, storage or
  security.** Alt text is copy and inherits this constraint — "view toward the
  rear exit" is good atmospheric alt text and a layout disclosure.
- **`Pending` never renders plausible placeholder content.** Development shows a
  visibly unfinished marker; production renders nothing. `npm run gate:launch`
  is what stops a launch.
- **Every claim must be true on the day it ships.** Architectural renders are
  comps and must not be presented as photographs of the room.

---

## The hero overlay

Spec §5 requires hero text to remain legible over photography and defers the
treatment to the Brand Guidelines. The guidelines don't specify one — §7 only
rules out what it must *not* be ("no hard flash, cold light, noir contrast or
heavy vignetting"), §11 forbids pure black, and §9 makes AA an acceptance
criterion. That cannot be resolved by eyeballing a scrim over photography that
does not exist yet, so it was derived from the worst case instead.

Browsers composite normal-blend alpha in sRGB gamma space, so the effective
backdrop behind hero text is `a*scrim + (1-a)*photo`. The worst possible
photograph is a pure white frame. Solving for AA with a Charred Timber scrim:

| Text | Minimum alpha | At the chosen α = 0.80, over pure white |
| --- | --- | --- |
| Chalk `#F6F5F2` | 0.654 | **7.32:1** |
| Terrazzo `#DCD8D1` | 0.735 | **5.62:1** |

Over realistic mid-tone photography the same alpha gives 10.58:1. So hero text
is compliant regardless of which frame the shoot delivers, with no per-image
review needed to keep it that way.

Applied as two layers, because a flat 0.80 across the frame would satisfy
contrast and destroy the photography — and §7 says do not degrade hero quality
to hit a score. `.u-hero-veil` is a soft overall gradient claiming no guarantee;
`.u-hero-zone` is the flat guaranteed scrim behind the text only, feathered
above so it reads as light falling off rather than as a band.

---

## The app shell

Below `lg` this is an installable app, not a website with a menu. Above `lg` it
is the website, unchanged — same solid header, same five nav items, same
persistent Apply CTA, and no tab bar.

**Navigation moved to the thumb.** `BottomNav` replaces the hamburger and its
entire modal apparatus — trigger, dialog, focus trap, Escape handler, scroll
lock — with five permanently visible destinations. That deletion is the quiet
win: a modal panel has to be *told* not to leak focus to the page behind it and
the correctness of that is invisible until it breaks, whereas a bar that is
always on screen has no open state, no trap and no focus to restore.

The tab set adapts. Signed-out ends on **Apply**, rendered as a filled accent;
signed-in swaps two labels and two destinations for **Leagues** and **Account**.
Both sets occupy the same five slots holding the same concepts, so the swap
moves nothing — no tab slides out from under a thumb already on its way down.

**The signed-in signal is a second cookie, not `getMember()`.** Calling
`getMember()` in `(site)/layout.tsx` would read `cookies()` in a layout and opt
every marketing page into dynamic rendering — trading the static prerender the
1088ms LCP is built on for two swapped tab labels, invisibly. So a non-secret
`armory_signed_in=1` cookie is written beside the session and read on the
client through `useSyncExternalStore`. It carries no id, no email and no
status, is never read on the server, and no authorisation path consults it;
forging it buys a member-looking tab bar that redirects to sign-in on first
use. The session token itself stays `httpOnly`. See `src/lib/session-hint.ts`.

### Armory Glass

`Header.tsx` used to forbid translucent chrome and gave two reasons. Both were
right about the header and neither reaches the tab bar: §3 misuse binds
anything *carrying the lockup*, and the performance objection was written about
blurring a full-bleed hero, not a 68px bar at roughly 8% of the viewport.

The tint is derived, not chosen. Effective ground behind a label is
`a*Chalk + (1-a)*backdrop`; the worst case for dark text is a pure black
backdrop, which this site genuinely has (Charred Timber, night photography).

| Tint α | Reticle Black over pure black | |
| --- | --- | --- |
| 0.58 | 4.38:1 | fails |
| 0.60 | 4.67:1 | passes, no margin |
| **0.62** | **4.97:1** | **chosen — chrome default** |
| 0.78 | 7.81:1 | lockup clear zone (§3), used by the mobile header |

At 0.62 the bar measures 5.89:1 over Charred Timber and 13.15:1 over Chalk.
**The blur contributes nothing to this** — a black backdrop blurs to black — so
the guarantee survives every fallback path, including a browser with no
`backdrop-filter` at all.

Two consequences worth knowing before editing `glass.css`:

- **No muted ink on glass.** Sight Ink measures 2.35:1 there, and the ceiling
  for a compliant text luminance is `L ≤ 0.0309` against Reticle Black's
  0.0232 — nothing perceptibly lighter passes. Hierarchy is carried by weight
  and ground, never by a lighter ink. Inactive and active tab labels are the
  same colour on purpose.
- **The centre dot needs an opaque ground.** §8 assigns the red dot to active
  navigation and it measures 1.43:1 on glass, because red and frosted Chalk are
  both mid-luminance. Rather than pick a different red, `.u-glass-lens` gives
  it the ground the brand already guarantees — an opaque Chalk chip inside the
  frosted bar, where the dot is its usual 3.79:1. The lens doubles as the
  selected-tab affordance. State is therefore carried by four signals, none of
  them colour alone: lens, weight, dot, `aria-current`.

Every glass surface degrades to a solid Chalk fill under
`prefers-reduced-transparency`, `prefers-contrast: more` and `forced-colors`,
with no layout change.

### Installability

`app/manifest.ts`, `viewport-fit=cover` with `env(safe-area-inset-*)` honoured
by the tab bar, Apple-specific tags for iOS (which reads neither the manifest
nor Android's icon rules), and PNG icons committed under `public/icons`.

`public/sw.js` exists first for installability — Chrome will not offer "Install
app" without a service worker handling `fetch`, however little it caches — and
second for an honest offline state at `/offline`.

**`/portal`, `/sign-in`, `/api/` and `/screen` are network-only.** Not
network-first — network-*only*, never written to any cache. `(member)/layout`
already warns that a cached portal page is one member's data served to another;
a service worker is a second cache, it lives on the device, and it outlives
sign-out because clearing a cookie does not clear the Cache API. Phones are
shared, lent and lost. `/screen` is excluded for a different reason: stale
scores shown confidently on a wall display are worse than a blank one.

Anything added to the site that carries personal data must be added to
`NEVER_CACHE`.

---

## The output audit

`npm run audit` reads the prerendered HTML in `.next/server/app` and asserts the
acceptance criteria against the *output* rather than the source. When Workstream
1 shipped, five of the §9 criteria were marked "manual sign-off — cannot be
automated". That was true of the code but not of the built pages: once they
prerender to HTML, several become greppable facts.

Now enforced automatically across all 12 public and 3 private routes:

| Check | Source |
| --- | --- |
| No membership price published anywhere | §9 acceptance criterion |
| "Shooting Sports Club" in every page title | Brand §2 |
| Unlisted and internal routes are `noindex`; public routes are not | §2 |
| Private routes linked from no public page | §2 |
| `robots.txt` does not advertise private paths | — |
| `sitemap.xml` excludes private routes | §2 |
| No forbidden vocabulary from the "we never say" list | Brand §9 |
| No exclamation marks | Brand §9 |

It strips `<script>` blocks and HTML comments before matching, because React's
RSC flight payload and its `<!-- -->` text-node separators defeat naive greps in
both directions — a check that silently matches nothing is worse than no check.
Verified to fail: injecting a price figure, `tactical`, `world-class` and an
exclamation mark into a built page produces three failures and exit code 1.

One rule earns its place separately. **No instruction the page cannot fulfil.**
`Pending` renders nothing in production, which is right — it stops invented
placeholder data reaching a visitor. But it makes this easy to write:

```tsx
Prefer to book by phone? <Resolved value={contact.bookingsPhone} … />
```

In development that reads correctly. In production, with the number still
outstanding, it renders the question followed by nothing — an instruction the
page cannot help anyone follow. It breaks §9 by *omission* rather than by
invention, which is why nothing else caught it: there is no bad string to grep
for, only missing text after a prompt. Five instances were found in review; the
audit rule then found a sixth on `/enquire`. Fixed with
[`CallUs`](src/components/ui/CallUs.tsx), which binds the prompt and the number
into one unit so neither can ship without the other.

Still requiring a human, listed by `npm run gate:launch`: the three-minute
mobile booking, the application landing with a named owner, LCP on a real
Android device, refund terms appearing before payment, and whether every claim
is true today.

---

## Status

**All five workstreams are complete and verified.** `npm run verify:full`
passes — typecheck, lint, 84 tests, gate, build, output audit — and
`npm run harden` passes WCAG 2.1 AA, the performance budget and the interaction
requirements against a production build.

23 routes: 21 static, plus the Paystack webhook and the booking confirmation,
which are correctly dynamic because they read live state. `/first-visit` joins
them the moment booking pricing is published.

Measured on the built output: **333.6 KB** first-load transfer, compressed,
against a 1.5 MB budget — of which 138.5 KB is the two preloaded font files
(Archivo carries a width axis, which is what reaches the "Expanded" register
without a second file). Leaves roughly 1.1 MB of headroom for photography.

**Workstream 1 — foundation.** Tokens, type scale, self-hosted fonts, layout
primitives, ground system, text and CTA components, brand mark, header, footer,
404, error boundary, contrast audit, content gate, `/brand`.

**Workstream 2 — components.** The spec §5 inventory: hero (both registers),
statement block, proposition, step sequence, discipline card and grid,
specification table, tier comparison, legitimacy strip, image slot / figure /
grid, form primitives, waitlist capture, `/brand/components`. The booking module
belongs to Workstream 4.

Three of the specification's rules are now enforced by the compiler or the
markup rather than by review:

| Rule | How it is enforced |
| --- | --- |
| §9 "No membership price is published anywhere" | `Tier.price` is a literal type with one legal value. A figure is a compile error. |
| §3 claims discipline | `LegitimacyStrip` filters on `trueOnDayOne`. Internal `evidence` appears in neither the document nor the RSC payload — verified. |
| §7 photography security | `Photo.securityReviewed` is required with no default. `grep securityReviewed: false` lists everything pending. |

Verified in the rendered output: three tiers each showing "On application" and
zero currency figures; the 25m and 10m pistol lines omitting lane count rather
than printing "0 lanes"; the step sequence as a semantic `<ol>` with the visible
numeral decorative; form errors carrying `aria-describedby`, `aria-invalid` and
`role="alert"`.

**Workstream 3 — pages.** All nine public routes from spec §2, the three legal
documents, the unlisted institutional page, `robots.txt` and `sitemap.xml`. Block
sequences follow §3 exactly. Content lives in `src/content/` and is the eventual
CMS schema.

Per-page access register, as specified in Brand Guidelines §4:

| Route | Ground | Why |
| --- | --- | --- |
| `/` | Chalk, with Soffit Blue first-visit and VIP Teal membership modules | Photography carries it |
| `/membership` | VIP Teal | Member context — teal "should feel earned" |
| `/first-visit` | Soffit Blue | The open, welcoming context |
| `/ranges` | Chalk + Range Teak + Charred Timber | Teak is the strongest anti-tactical signal |
| `/the-club` | Blue per space, VIP Teal for the VIP deck | Mirrors the actual deck furniture |
| `/groups` | Soffit Blue | Open, non-member |
| `/sport` | Reticle Black on Chalk, austere | Institutional audience |
| `/leagues` | Charred Timber | Night register |
| `/enquire` | Teal / Blue / Charred, one per route | Colour separates the three motions |

**Workstream 4 — flows.** Flow A (application → CRM → named owner), Flow B
(slot selection → hold → Paystack deposit → signed webhook → confirmation), Flow
C (no form, by design). Server actions rather than API routes, so field errors
render inline and the forms still work without JavaScript. 84 tests, all passing.

Three decisions worth knowing:

**No database.** Applications go straight to the CRM, with an owner email as a
second independent path. The Brief calls the site's data "a list of wealthy
Abuja residents and where they will be, and when" — the most secure store is the
one that does not exist. The consequence is that the CRM becomes the crown
jewels: mandatory 2FA, a named access list, and a weekly encrypted export, since
it is the only recovery path.

**A submission is accepted only if it landed somewhere durable.** Both paths are
attempted in parallel; if neither succeeds the visitor is told plainly and asked
to call. We never render a confirmation for a submission we dropped — the
failure mode that looks like success from every angle and loses an applicant who
will not apply twice.

**Money is confirmed by the signed webhook, never by the redirect.** Capacity is
held *before* the visitor leaves for Paystack and released if initialisation
fails, so a gateway outage cannot silently consume a session. `confirm` is
set-once, so Paystack's retries cannot double-book. The confirmation page reads
the booking's real status and says "confirming your payment" rather than
claiming a booking it cannot see.

**Workstream 5 — hardening.** `npm run harden` measures the two §9 criteria
that cannot be asserted, only measured, against a real browser.

**WCAG 2.1 AA — zero violations.** axe-core across 15 routes at desktop and
mobile, plus the mobile menu open and rendered form error states. It found three
real violations before passing: the `(optional)` suffix on form labels used
`opacity-70`, which reads fine on Chalk (the label starts at 13:1) and measured
**3.50:1 on VIP Teal** and **3.27:1 on Soffit Blue** — under the 4.5:1 required
at 14px. A fixed opacity is not a colour: it behaves differently on every ground
it lands on, so it cannot be verified once. It broke on exactly the coloured
grounds the access-register system introduced.

**Performance, 4x CPU throttle over Slow 4G (1.6 Mbit/s, 150ms RTT):**

| Route | FCP | LCP | CLS | Transfer |
| --- | --- | --- | --- | --- |
| `/` | 1088ms | **1088ms** | 0.024 | 379 KB |
| `/first-visit` | 1080ms | **1080ms** | 0.000 | 373 KB |
| `/membership` | 1016ms | **1016ms** | 0.000 | 361 KB |
| `/ranges` | 1016ms | **1016ms** | 0.000 | 384 KB |
| `/the-club` | 1104ms | **1104ms** | 0.005 | 367 KB |

Budget is LCP < 2500ms, payload < 1536 KB, CLS < 0.1.

⚠ **LCP equals FCP on every route, because there is no photography yet** — the
largest contentful paint is currently text. When hero images land, LCP becomes
the hero. At 1.6 Mbit/s the remaining 1400ms of headroom buys roughly **280 KB**
of hero image before the budget breaks. The Workstream 1 estimate was ~180 KB
for a 1600px AVIF, so it fits — but the margin is real, not infinite, and this
number should be re-measured the day the shoot lands.

**Interaction (§7):** `prefers-reduced-motion: reduce` drops 16 animated
elements to 0; the skip link is the first tab stop; every focusable element has
a visible ring; the mobile menu traps focus, locks body scroll, closes on Escape
and returns focus to its trigger.

### Before a single real deposit

Three launch blockers came out of this workstream, all registered in the gate:

- `booking-durable-store` — `InMemoryBookingStore` is development only. It is
  correct and fully tested, and it holds state in module memory: on any host
  that runs more than one instance or cold-starts, capacity is not shared and
  does not survive a restart. The intended production store is a private Google
  Calendar, not a database — [`booking-store.ts`](src/server/booking-store.ts)
  specifies exactly what that adapter must do. It is deliberately not stubbed:
  untested integration code that looks complete is worse than an honest absence.
- `email-dns` — SPF, DKIM and DMARC on the club domain, tested against real
  Gmail and Outlook inboxes. Without it both flows appear to work in testing
  while confirmations land in spam.
- `integration-credentials` — Paystack, CRM and Postmark. Until they exist the
  intake layer refuses submissions and the booking module degrades to an
  enquiry link. Both are correct behaviour, and both mean the site cannot
  convert.

### Content written by the build team, needing client confirmation

`src/content/ritual.ts` carries draft first-visit copy. The *sequence* is
specified in §3, but three facts are ours and must be Operations': whether the
briefing precedes equipment issue, the round length and shot count for a first
visit, and how results are returned. Registered as a gate blocker
(`ritual-accuracy`) because this is the highest-leverage page for the growth
segment and cannot ship on assumptions.

`src/lib/fixtures.ts` is reference-page-only and must not be imported by a
public route. Tier names in it are the Brief's assumed structure, not the
founder's decisions.

### Known placeholder

`src/components/brand/Lockup.tsx` and `Reticle.tsx` are drawn to the written
description in §3, which forbids recreating the lockup. The wordmark is live
Archivo at expanded width — a faithful interim for **Option B** (the
recommended "redraw the wordmark in a precision grotesque"). The supplied
stencil is deliberately not used, since shipping it would choose Option A by
default rather than deliberately. Awaiting vector files; the swap is one file.

### Not code, and time-critical

The photography shot list in Brand Guidelines §7 specifies fourteen shots but
never specifies **negative space for type**. Spec §3 requires a full-bleed hero
with headline, sub-line and dual CTA. If the shoot happens without a briefed
text-safe zone, the result is beautiful symmetrical frames with the subject
centred and nowhere to put a headline — and the only fix is a scrim the brand
forbids. The photographer needs an addendum before the shoot: per hero
candidate, a variant with a quiet, evenly-lit region in the lower-left third,
and 16:9 / 4:5 / 9:16 crops of the same frame. Unrecoverable afterwards.

---

## Phase 2 — Leagues

Spec §1: Phase 2 is "league creation, fixtures, score ingestion from the air
rifle targeting system, standings, club ladder, social features. Member accounts
and portal." It **begins after opening**, once a founding-member base exists and
the manual pilot has validated the loop.

Four decisions were settled before building: **managed Postgres** (Neon or
Supabase), **passwordless email sign-in**, **foundations first**, and the
non-member cap set at **one full season** — the open decision the Brief deferred
and asked to revisit "before Leagues is specified".

### Workstream 6 — foundations

Schema, auth primitives, eligibility rules, and the score-ingestion seam.
146 tests, all passing.

**The security rule is structural, not a view concern.** Spec §7 requires that
"league standings must use display names and omit timestamps, so the product
does not become a public attendance log" — and Phase 2 makes the exposure worse
than Phase 1, because a member who plays Thursday at 6pm every week has a
*recurring* schedule attached to their name.

So `rounds` has **no timestamp column at all**. Verified against the generated
DDL: its only columns are `id`, `season_id`, `sequence`. A standings query
cannot join to a wall clock because the column does not exist on that path.
Every wall-clock time lives in one quarantined `attendance` table that nothing
public reads, with a `purge_after` on every row.

**Score integrity is the product.** "A league collapses the first time a member
suspects a friend inflated a score." Three rules, enforced by shape rather than
convention:

| Rule | Mechanism |
| --- | --- |
| Scores are immutable | A correction inserts a new row with `supersedes_id`, a reason and an author. Nothing is updated in place. |
| Provenance on every row | `automatic` / `imported` / `manual`. A manually entered score is displayed as one. |
| Manual scores name their author | A batch with no `actorId` is rejected entirely — an unattributed score is an assertion, not a score. |

Out-of-range scores are **rejected, never clamped**. A clamped score is a wrong
score that looks right, on a figure a member will be ranked by.

### The seam that de-risks Phase 2

The Brief calls the targeting system's export capability the open decision that
"determines whether Leagues is buildable at all", and it is still unanswered.
Ingestion is therefore an interface with three adapters:

- `automatic` — the targeting system. **Deliberately unimplemented**, and throws
  a message naming the unanswered question rather than silently returning empty.
- `imported` — CSV. Covers a system that exports but cannot integrate, and the
  manual pilot's spreadsheet, which is the first real data this schema will meet.
- `manual` — typed by named staff. Slow, does not scale, and means a league can
  run on opening day regardless.

A "no" from the installer degrades Leagues in **quality**, not existence.

### Two things that are not software

`npm run gate` now separates Phase 1 from Phase 2 blockers, because a hardware
question about a targeting system must never appear to hold up a website.

Both of the Brief's **ACT NOW** items are registered as Phase 2 blockers, and
one of them must stay un-built: the manual pilot is specified as four members, a
weekly round and a shared spreadsheet — *"for the cost of an afternoon. If they
will not, no software saves it."* **Building a tool for the pilot destroys what
the pilot tests.** Its output becomes the first CSV import instead.

### Workstream 7 — member accounts

Passwordless sign-in, sessions, the member shell and the portal home.
158 tests passing.

**Two properties do the security work.** Sign-in tokens are 32 random bytes,
stored only as SHA-256 — a dump of `auth_tokens` grants nobody a session. And
redemption is a single atomic `UPDATE … WHERE consumed_at IS NULL AND
expires_at > now() RETURNING`, because the Neon HTTP driver has no
multi-statement transactions and a read-then-write check would let two rapid
clicks each mint a session.

**The sign-in link does not sign you in.** It lands on a page that does nothing
until an explicit POST. Corporate email security scanners, preview bots and
prefetchers follow GET links, and a self-redeeming URL gets consumed before the
member clicks — producing "my link says it's already been used", which is
unfixable from their side and looks like the club's fault. It costs one tap and
removes a whole class of support burden that falls hardest on members with
corporate email.

**Requesting a link never reveals whether an account exists.** Same response,
same token row, either way. This is a private club whose membership list the
Brief calls an attractive target — "that address isn't registered" would let
anyone walk a list of names through the form and learn who belongs.

`safeReturnTo` rejects absolute, protocol-relative (`//evil.example`) and
backslash-smuggled URLs. An open redirect on a sign-in flow is a phishing
primitive: a genuine link, from the club's real domain, with real DKIM, landing
the member somewhere else.

**The marketing bundle is unaffected — verified, not assumed.** Zero
occurrences of `drizzle`, `neon`, `authTokens`, `DATABASE_URL` or any schema
symbol in any client chunk. Measured LCP after Phase 2: 1016–1064ms, unchanged.

### Workstream 8 — leagues

League creation, join codes, fixtures and the season cap surfaced in the UI.
198 tests passing.

**Fixtures are derived, never stored.** `rounds` still has no timestamp — the
rule from Workstream 6 holds. A round's date is computed from two things that
are already safe: the league's **standing weekly slot**, which is a property of
the *group*, and the round's sequence number. "This league meets Thursdays at 6"
is a fixture four friends already agreed between themselves; "Adaeze was at the
range at 18:04 on 7 August" is an attendance log, and that stays in
`attendance` where nothing public reads it.

Fixtures advance by **rounds played, not by the calendar**. A league that misses
a week is behind, not skipped — silently advancing past an unshot round would
erase exactly the gap the group should notice, and the mechanism is social
obligation rather than the clock.

**Join codes are read aloud, not copy-pasted.** The realistic path for a fourth
player is somebody saying "it's ABC-234" over the noise of a firing line. So the
alphabet is Crockford Base32 — no I, L, O or U — and input *forgives* the
excluded characters rather than rejecting them: someone who types `O` for zero
read the code correctly and typed what they saw. Generation uses rejection
sampling rather than modulo, which is unbiased for a 32-character alphabet but
silently breaks the moment someone edits it.

**The season cap is a conversion moment, not a rejection.** A non-member hitting
it has just played a full season and is trying to sign up for another — the
Brief's whole access model turns on this instant. The form gets out of the way
and the offer takes the page.

Every privilege is checked in the repository immediately before the write, not
only in the UI. A server action is a public endpoint; guarding the button
guards nothing.

### Workstream 9 — reconciliation, and the Tournament

A fourth source document arrived mid-build: **the Leagues Product
Specification**. It reframes Leagues as *three* products — Tournament, League,
Ladder — and **contradicted three things already built**. Those were corrected
before anything new was written.

| What was built | What the spec says | Now |
| --- | --- | --- |
| Binding weekly slot, dated fixtures ("Thursday 7 August") | §6: fixtures are **asynchronous** — "the fixture is a week, not an evening". §8: "**Show week numbers, not dates**" | Weeks only. `nextFixture` emits no date, weekday or clock time; a test asserts that |
| League max 8 players | §6: the unit is **the foursome**; team scoring is "best three of four" | `MAX_LEAGUE_PLAYERS = 4` |
| Standings next | §1, §9: **build the Tournament first** — it works from opening day and needs no member base | Tournament built; standings follow |

Thursday survives as a **social anchor** rather than a fixture — the night a
league puts in its group chat, never enforced. §6 gives two reasons and both are
good: synchronous fixtures are fragile ("one person travels, a child is sick"),
and forcing every league onto Thursday would create "a capacity crisis on one
night and empty lanes on Tuesday".

### The variance problem

§3 is the sharpest thing in the document. **Shooting is almost pure skill**, so a
naive league table "is correct by week two and unchanged by week eight" — and
"people do not keep showing up to lose predictably". The mechanism meant to
drive retention would drive churn among exactly the beginners the club needs.

Handicaps are excluded at launch, so five self-explanatory mechanics replace
them. Two are already implemented as pure, tested functions in
`src/server/leagues/fixtures.ts`:

- **Attendance streak** — "skill-independent by design; the worst shooter in the
  club can hold the longest streak." Its signature admits no score at all, which
  is the guarantee.
- **The churn signal** — `hasGoneQuiet` / `weeksSinceLastRound`. §9 calls
  tracking who *stops submitting* "the only early warning you will get".
  Registered as a gate blocker, because the code is the easy half.

### The tournament engine

`src/server/tournament/engine.ts` — pure, event-sourced, offline-capable.

**Turn-taking is the mechanic** (§2): "everyone watches every shot… the audience
is where the banter, the pressure and the drama live." Turn order **alternates
teams** rather than blocking them — block order leaves one team sitting through
four turns with nothing at stake, which kills the thing the format exists to
produce.

**The practice round is a constant, not a flag.** §4's hard rule — "never let a
first-timer shoot a scored round first… must not be dropped when a session runs
late" — is encoded as `PRACTICE_ROUND_REQUIRED`, because a flag is something a
range officer can switch off at 9pm, which is precisely the moment the rule
exists to survive.

**State is derived from an ordered list of turns**, never accumulated. That is
what delivers §5's "a mis-entered score must be correctable without restarting":
a correction edits one entry and recomputes, so the screen can never drift out
of step with the record. A test proves a wrongly-decided sudden-death Decider
can be corrected back into play.

The engine accepts either input path, so §5's Path A (automatic) versus Path B
(range officer on a tablet) stays deferred without blocking anything.

### Workstream 10 — the live screen

`/screen`. §5: "the only element of Leagues that genuinely requires software at
launch… what makes the tournament feel like an event rather than four people
writing numbers on paper."

**Scoring settled:** best of three rounds — the winner is the team that wins
most rounds, with the gross total as tiebreak. §1's "gross, live" is what the
screen shows throughout; §4's "best of three rounds" decides the result.

**The layout was restructured to make this possible.** The root layout used to
render the header and footer for every route. A television on a wall must carry
neither — and hiding them with CSS would leave them in the tab order, which
matters because the range officer's control panel is operated by keyboard. So
site chrome moved into `app/(site)/layout.tsx` and the root became the document
shell. URLs are unchanged; `(screen)` sits outside the chrome.

**It runs offline.** State lives in `localStorage`, the engine is pure, and
nothing calls the network after first load. `useSyncExternalStore` — not an
effect — reads it, so there is no render-then-correct flash on a screen a room
is watching, and a reload recovers a tournament mid-event rather than losing it.
`BroadcastChannel` keeps a display tab and a control tab in step on the machine
driving the TV.

**Type sizes are derived, not chosen.** §5 requires legibility at 5–10 metres.
The standard rule is a cap height of roughly viewing-distance / 200 — 5 cm at
10 m, about 79 px on a 55-inch 1080p television. Team totals are set at 16vw
(~307 px there), comfortably past it. ⚠ The rule gives a floor, not a verdict:
§5 says test from the rail and the bar seating with the real screen, and that
has not happened — it is part of the `live-screen-scope` gate item.

**Red is a point, never a plane.** Ten Ring Red appears on exactly two things:
the leading team and the last shot. A dead heat highlights neither.

Driven end to end in a real browser at 1920×1080 — set-up, practice round,
three scored rounds, held winner state. Totals verified against hand
calculation (A 261 / B 203, three rounds won), no console errors, and the
tournament survives a mid-event reload.

### Remaining Phase 2 workstreams

11. **Tournament booking and results page** — a group booking type with format
    selection, and a results page reachable by link. No accounts.
12. **League standings** — team and individual tables, personal best, most
    improved, streak. Week numbers only.
13. **The Ladder** — members only, gross, rolling window, founding designation.

---

## The hardening gate is now trustworthy

Workstream 7 exposed two ways `npm run harden` could report a verdict it had
not earned. Both are fixed, because a gate that answers differently each run
teaches people to ignore it.

**1. Host contention was being reported as a code regression.** A single
throttled sample on a busy machine is meaningless. Measured on identical code:

| Profile | Median LCP | Spread over 5 runs |
| --- | --- | --- |
| No throttle | 568ms | 432ms |
| 4x CPU only | 1892ms | 692ms |
| Slow 4G only | 992ms | 132ms |
| **4x CPU + Slow 4G** | **6388ms** | **2472ms** |

The throttles compound super-linearly — 1892 + 992 is nowhere near 6388 — so a
contended host produces numbers about the machine, not the site. The gate now
takes a **median of 5** and runs an **unthrottled host-health check first**; if
the baseline exceeds 1500ms it refuses to measure rather than blaming the code.
On a quiet host the spread collapses from 1648ms to 44–164ms.

**2. axe was scanning mid-animation.** The mobile menu enters with a fade, and
axe computes contrast from rendered colours — so a partially transparent panel
produced a contrast failure that did not exist once the animation landed. The
flagged element measured white on Ten Ring Deep, 5.73:1. It is a race, which is
why it passed in Workstream 5 and failed here on identical markup. The scan now
awaits the subtree's `Animation.finished` rather than sleeping.

Note: median-of-5 makes a full `npm run harden` take roughly 3–4 minutes.

---

# The Armory Management System

A second product in this repository, specified by the **Build Specification**
(`docs/Armory_Build_Specification.pdf`). The marketing site above is unchanged
by it; nothing in `src/app/(site)` or the leagues schema was moved.

Section references throughout the code (`§4.2`, `§8.3`) are to that document.

## Where it lives, and why it is separate

| | Leagues product | Management system |
| --- | --- | --- |
| Postgres schema | `public` | **`armory`** |
| Schema file | `src/db/schema.ts` | `src/db/armory/schema.ts` |
| Client | `src/db/client.ts` (Neon HTTP) | `src/db/armory/client.ts` (pooled TCP) |

**Two table names collide.** Leagues owns `rounds` (a round *sequence* within a
season, deliberately timestamp-free) and `sessions` (an auth session). The
specification needs both names for different things — a scored round, and a
range session. Neither side should be renamed, so the management system takes a
Postgres schema of its own.

**The driver had to change.** `src/db/client.ts` documents its own trade-off:
the Neon HTTP driver "means no transactions spanning multiple statements". The
specification requires multi-statement atomicity for the guest allowance in
three places — §3.2, §6.2 and §8.3 — and §8.3 names the defect that follows
without it ("Two devices, one allowance"). The management system therefore uses
`pg` with a real pool. The hosting decision stays open; only the driver is fixed.

## The shape

```
src/domain/                 pure, isomorphic, imports nothing from the server
  enums.ts                  every status vocabulary, defined once
  capability/               §4 — the capability service
    index.ts                evaluate(subject, context) → decision
    reasons.ts              the block catalogue: message, remedy, overridable
  state-machines.ts         §5 — guarded transitions returning effects as data
src/lib/
  uuidv7.ts                 §2 — time-ordered ids, generated before the network
  money.ts                  §2 — integer kobo, branded; no float path exists
  time.ts                   §2 — stored UTC, rendered Africa/Lagos
src/db/armory/
  schema.ts                 §3 — the data model
  client.ts                 transaction-capable pool
drizzle/
  0001_armory_management_system.sql   generated
  0002_armory_enforcement.sql         hand-written; see below
```

**`src/domain/` is not under `src/server/` on purpose.** §4 requires one
service to decide for both sides, and §8 requires the desk to decide with no
network at all. `evaluate()` reads nothing and queries nothing — every fact
arrives as an argument. The server assembles its `Subject` from Postgres, the
desk assembles the identical `Subject` from the day pack in IndexedDB, and both
get the same answer including the sentence shown to the member. Nothing in
`src/domain/` may import the Drizzle schema, or a database driver ends up in a
tablet bundle inside §2's one-second cold-start budget.

## Enforcement is in the database

§12: append-only tables must "reject update and delete at the **database
level**, not merely in application code". `drizzle/0002_armory_enforcement.sql`
installs that, plus the derived columns §3 says must not be writable:
`firearms.status`, `ammunition_lots.quantity_remaining`, `accounts.balance_kobo`.

```bash
# Prove it, against any database with the migrations applied
DATABASE_URL=... npm run db:prove
```

`scripts/enforcement.test.sql` makes 29 assertions in one rolled-back
transaction. A TypeScript test cannot demonstrate this requirement, because it
proves only that the TypeScript did not try.

⚠ **`TRUNCATE` bypasses row-level triggers.** Every append-only table therefore
carries a second, statement-level guard. Without it the whole guarantee has a
one-word bypass — and it is invisible until someone finds it.

⚠ **The firearm-status derivation exists twice**, in
`src/domain/state-machines.ts` and in PL/pgSQL in the enforcement migration —
once so the desk can show status offline, once so the database maintains the
column itself. Changing the mapping means changing both, in the same commit.

## Delivered — M0 through M10

Against the §11 plan, every milestone's software is built. What remains is not
code, and saying so plainly matters more than the table.

| | | Where it lives |
| --- | --- | --- |
| **M0** | Foundations | `src/db/armory/`, `src/domain/`, `drizzle/0001`–`0002` |
| **M1** | Offline spine | `src/offline/`, `src/sync/`, `src/server/sync/` |
| **M2** | System of record | `src/server/armory/{people,memberships,waivers,qualifications,licences}.ts` |
| **M3** | Admission | `src/server/armory/applications.ts`, `src/domain/roster.ts` |
| **M4** | Hosting and booking | `src/domain/availability.ts`, `src/server/armory/{bookings,allowances,invitations,visit}.ts` |
| **M5** | Desk | `src/components/console/`, `src/offline/{today,checkin,waiver,equipment,close}.ts` |
| **M6** | Armoury | `src/server/armory/register.ts`, `src/domain/exceptions.ts` |
| **M7** | Lane | `src/domain/scoring.ts`, `src/offline/{relay,score,incident}.ts`, `src/components/console/{Relay,PairSheet,ScoreSheet,IncidentSheet}.tsx` |
| **M8** | Money | `src/domain/charges.ts`, `src/server/armory/{money,billing}.ts`, `/api/armory/paystack/webhook` |
| **M9** | Dashboard | `src/domain/dashboard.ts`, `src/server/armory/dashboard.ts`, `/api/dashboard` |
| **M10** | Hardening | `src/domain/period-boundary.test.ts`, `scripts/volume.ts`, `docs/M10_*.md` |

### What "delivered" does not mean

§12's definition of done has eight clauses and three of them cannot be satisfied
by a repository. They are outstanding, they are the ones a rushed project
sacrifices, and they are tracked as documents rather than as tickets:

- **§8.5's power cut has not been performed.** `docs/M1_offline_acceptance.md` is
  the protocol and the whole of it can now be run — M7 closed the last two gaps,
  score capture and incidents. It needs the actual tablet model being purchased
  and somebody willing to pull the power mid-session. Devtools offline mode is
  explicitly not evidence.
- **§10's restore has not been rehearsed.** `docs/M10_restore_rehearsal.md` is
  the protocol. §10 phrases this as a prohibition: *a backup never restored is a
  hope.*
- **The security review has findings.** `docs/M10_security_review.md` walks §10's
  eight requirements against the code and closes with seven launch blockers —
  four of them hosting decisions, three of them engineering work that has not
  been done (a founder-facing revocation control, the guest data redaction path,
  and a scheduled payment reconciliation sweep).

`docs/M10_go_live.md` is the sequence that closes them, plus the staff training —
which is run as a test of the software, because §12 asks that "a range officer
who has not seen the screen before can complete the workflow without
instruction", and that is a property of the screens rather than of the training.

### One defect this milestone found, recorded because it is the interesting kind

§2.1 warns that "most defects in this system only appear at volume or at a period
boundary", and M10's boundary tests found one on their first run.

`licences.expires_on` is a DATE. Both sides parse it with `parseDateColumn`,
which yields **midnight in Lagos at the start of that day** — so the capability
service's `expiresOn > now` made a licence expire at the *beginning* of its
expiry date. A member holding a licence marked "expires 14 August" was refused
all day on the 14th.

The server never agreed with it. `expireLapsedLicences` sweeps with
`expires_on < today`, so the row stayed `verified` in the database. The column
said valid, the sweep said valid, and §4's one authoritative service said no.

It is invisible on every other day of a licence's life. It surfaces on one
morning, at the desk, to a member whose paperwork is in order — and §12.1 plants
"a licence that expired yesterday, **one expiring today**" in the seed as two
distinct cases which, under the old comparison, behaved identically.

Fixed in `src/domain/capability/index.ts` (`liveOn`), with the reasoning at the
call site.

## M1 — the offline spine

```
src/offline/outbox/
  policy.ts            pure: retry, backoff, quarantine, rejection, desk wording
  outbox.ts            the durable queue over a storage interface
  indexeddb-store.ts   the real store — durable, wipeable on device revocation
  memory-store.ts      tests only; never wire this to a surface
```

Same shape as `src/domain`: the rules that decide whether a record is retried,
parked or surfaced are pure functions, testable by calling them. Only the
storage adapter touches IndexedDB.

**The queued item's id is the record's id.** §7 requires every write to carry a
client-generated UUIDv7 and be safe to replay. So an outbox item is not a job
that creates a row — it *is* the row, waiting. A replay is an upsert on a key
that already exists, which is why this queue can be at-least-once rather than
attempting exactly-once delivery over a bad link.

**Strict FIFO, with head-of-line blocking.** Queued records reference each
other — an ammunition issue references its participation. Reordering produces a
foreign key violation on a valid record. Quarantine is what releases the head;
that is its main job.

**Nothing is ever silently discarded.** There is no terminal state meaning
"give up and forget". An item succeeds, or ends in `quarantined` / `rejected` —
both visible on the desk, both keeping the payload, because that payload may be
the only record that a firearm left the rack. `prune()` removes `done` items
and nothing else.

### Two service workers, two scopes — resolved

`/sw.js` is the member's app shell. Its policy is deliberate and unchanged:

> every authenticated or personal surface is network-only … If the member is
> offline, those routes fail, and failing is correct

`/console/sw.js` is the desk and lane worker. Its scope is `/console/` — not
configured anywhere, just the directory it is served from, so no
`Service-Worker-Allowed` header is involved. Most-specific-scope-wins means a
tablet at `/console/desk` is controlled by that worker and the member worker
never sees the request.

Both are true at once because they describe different **devices**, not
different routes. §3.1: desk and lane "load only on a registered, unrevoked
device". A club tablet in a locked building is not a member's phone on a bus.

**The rejected alternative** was one worker that checks what kind of device it
is running on. That turns the isolation into a conditional, and a conditional
is one careless edit away from caching a member's portal page onto their
handset. Two scopes makes the member policy physically unreachable from the
console worker: it cannot cache `/portal` because it never sees `/portal`.

`/console` was *added* to the member worker's `NEVER_CACHE` — a tightening, not
a relaxation — covering the window before the console worker installs, and any
personal phone that follows a console link.

#### Shell in the Cache API, data in IndexedDB

The console worker caches HTML, JS, CSS and icons. It caches **no data** —
`/api/` and `/sync/` are network-only there too.

That split is the security argument, not tidiness. The Cache API is keyed by
URL and survives sign-out; data in it cannot be expired by anything that
understands what the data means. §10 requires a revoked tablet's day pack be
"rendered unusable on next launch" — clearing an IndexedDB store is one call,
whereas proving no personal record is left in an opaque HTTP cache means
knowing every URL that ever returned one.

Cache strategy also inverts: the member worker is network-first, the console
worker is **cache-first on the shell**. §2 gives the desk a one-second cold
start with no network, and on a range floor the network is often present but
useless — a captive portal, a stalled cell. Network-first spends that second
timing out while a shooter waits.

#### Device trust has a bounded offline grace period

`src/offline/device.ts`. §10 wants revocation to reach a stolen tablet; §8 wants
the desk to work with no network. A device that trusts its cached registration
forever works indefinitely in a thief's hands; one that demands a live check
closes the range during an ordinary power cut.

So a registration is trusted offline for **7 days** since the server last
confirmed it, with a warning from day 4. Wrong in the safe direction: refusing
a legitimate device costs one phone call, trusting a stolen one costs every
member's address.

Stale devices are **refused, not wiped** — they may be legitimate and merely cut
off, and wiping would destroy an unsynced afternoon of custody events. Only an
explicit server "revoked" triggers `wipeLocalState()`.

`LOCAL_DATABASES` in `src/offline/revoke.ts` lists every local store, and a test
asserts its contents — adding a database without adding it there would leave
data on a revoked device while revocation still reported success.

### The day pack (§8.1)

`src/offline/daypack.ts`. The pack is what lets §4's capability service run on
the desk with no network: `subjectFor(pack, personId)` builds the same
`Subject` the server builds from Postgres, and both hand it to the same
`evaluate()`. Not an equivalent decision — the same one, including the sentence
shown to the member.

`daypack.test.ts` asserts that by comparing whole decision objects from both
paths. It has already earned its place: it caught the pack's tier leaking an
`active` flag into the Subject. Nothing read it and every decision still
matched — which is what made it worth fixing, since a divergence that changes
no behaviour today is the one that survives long enough to change behaviour
later.

**§10 is enforced by the shape of the type.** `PackLicence` carries status,
calibres and expiry — which MAY_USE_OWN_FIREARM needs — and has no
`documentUrl` field at all, so a pack containing a licence scan does not
compile. `PackPerson` likewise omits `address`, `dateOfBirth`, `notes` and the
emergency contact.

The emergency contact is the interesting omission, because it looks necessary.
It is not needed to *check someone in*; it is needed when there is an incident,
which is a moment where fetching one record is entirely acceptable and far
better than holding every member's next of kin on a device in a public
building.

`assertNoRestrictedFields()` walks an incoming pack at runtime and rejects it
outright if a forbidden key appears at any depth — because the pack arrives as
JSON, and TypeScript is not there when it does.

**Status is deliberately not in the pack**, despite §8.1 saying "with computed
status". A status computed server-side an hour ago is wrong the moment the host
checks in, and §4 requires that desk row to clear itself without the officer
retrying. Shipping a precomputed status would make that impossible and would
duplicate the permission logic §4 forbids duplicating.

### ~~Still outstanding in M1~~ — closed

The sync endpoints, the console routes and the sync status UI are all built. What
follows is what was added on top of them, and only where the design is not
obvious from the code.

**And §8.5 is not discharged by any of the above.** Its definition of done is a
real tablet with the power physically pulled mid-session — "Browser devtools
offline mode does not substitute for it and must not be accepted as evidence."
The tests here are a precondition for that, not a substitute.


## M7 — the lane

§6.5 gives the lane four screens and one budget that shapes all of them: "large
type, readable at arm's length in daylight". That is not a font size on a mock —
it is a tablet clamped to a post on a covered outdoor line at midday, read by an
officer in ear defenders who is not going to walk over and squint.

What it constrains is the **data**, which is why `src/offline/relay.ts` enforces
it rather than the CSS: a row that has to carry six facts cannot be set in type
that large. A relay row carries four — the lane, the shooter, what they are
holding, and whether anything is outstanding.

**The lane is the same application as the desk, chosen by the credential.** §3.1
registers a device against a surface and the day pack returns it, so a tablet is
told which screen it is by the server that registered it. A toggle would mean a
lane tablet outside could be switched into the desk, which holds check-in,
person detail and the end-of-day close — and §10's whole argument for
device-bound sessions is that the device is part of the credential.

### The lane cannot see what the desk recorded, unless it has synced

Check-in happens at the counter, on another tablet. So the day pack gained a
`participations` projection — the server's view of who is on the premises — and
`mergedParticipations` combines it with whatever this device recorded itself,
local winning whole-row rather than field-by-field. The common disagreement is a
check-OUT this device made thirty seconds ago and has not sent, and a merge that
preferred the server's non-null values would put somebody back on a lane they
had just left.

**With no uplink between the two tablets, this does not close.** Two devices with
no network between them cannot learn what the other wrote, and no amount of
projection changes that. The honest position is recorded in `src/server/rows.ts`:
peer sync between devices is a distributed system with its own conflict rules, it
is not in Phase 1, and nothing assumes it.

### Scores are stored in tenths, for the same reason money is stored in kobo

`rounds.total_score` is an INTEGER (§3.3) and ISSF decimal scoring goes to one
place — a 10.9 is a real score. §2 already decided how this codebase reconciles
that: "all amounts stored as integer kobo. Never floats." So a decimal format
stores tenths and `ScoreFormat.scale` says which.

`parseScore` splits the string rather than multiplying. The multiply is in fact
exact for every value in the current table — which was checked rather than
assumed, and is precisely the problem: the safety is a property of the *range*,
not of the arithmetic, and nobody adding a format with a larger ceiling in two
years will re-check it.

### The score screen raises no keyboard

A numeric input on Android covers half the screen, animates in, and puts the
digits somewhere different depending on the keyboard the tablet shipped with.
§6.5 gives the whole interaction twenty seconds and an officer standing on a
firing line is not looking down. So the digits are on the page, in a fixed place,
and the confirm button carries the score itself — a button that names the number
cannot be pressed by muscle memory into recording the wrong one.

### Incidents are the one write that is two rows

Every other push is idempotent because its primary key is the client-generated
id. That argument does not reach `incident_persons`, whose key is
(incident_id, person_id) and which has no client id of its own. So it is a
transaction — both inserts, each `ON CONFLICT DO NOTHING` — and it carries its
own `kind` in `src/sync/operations.ts` rather than being folded into
`AppendOnlyInsert`, because a reader has to be able to tell which guarantee they
are standing on.

The builder refuses on exactly two things: a category and an account of what
happened. Everything else it might have insisted on — a session, the people, a
time — is a way for a safety record not to exist.

## M8 — money

§3.5 says the host-pays rule must be enforced "in code, not convention", and the
way to do that is for the guest's id to have **no parameter to be passed into**.
`guestOverageCharge` in `src/domain/charges.ts` takes a host person id and a
guest *name* — the name only so the line reads. There is no argument to get
wrong.

The charge is raised when the guest **attends**, not when the invitation is
issued. §5 returns the allowance on cancellation, so a charge raised at issue
would have to be reversed every time — filling a member's statement with charges
and credits for Saturdays that did not happen. `attended` is terminal and returns
nothing, so a charge raised there never needs reversing.

**The balance column is never written from application code.**
`accounts.balance_kobo` is recomputed by trigger from `account_transactions` and
a direct UPDATE is rejected, exactly as `firearms.status` is. The only money
write in `src/server/armory/money.ts` is an INSERT into the ledger.

**Two idempotency mechanisms, both load-bearing.** What the club originates goes
through `record()` and is idempotent on a request id. What Paystack originates is
idempotent on `gateway_reference`, which carries a unique index — not a
preference but the only option, because a webhook retry does not carry our
request id and the gateway decides when to send it. §12.1's duplicate-webhook
test is proved in `scripts/enforcement.test.sql`, because a TypeScript test can
only show that the TypeScript did not try.

### §14's open items moved out of code and into a row

`drizzle/0006` adds `armory.club_settings` — one row, enforced by a unique index
on a boolean column that exists only to carry it. Every value it holds was a
literal somewhere, each carrying a comment saying the device reads it from the
pack "so it changes without a deploy". That was half true: the device did, and
the server read a constant.

Null means **not decided**, and every reader states what it does with null. No
default would be safe — an overage price of zero bills nobody, a guessed one
bills a member for something the club never agreed.

## M9 — the owner dashboard

§6.6 lists ten metrics and the list is not arbitrary. Read with §1.1 it is four
questions in descending order of what they are worth: is the club filling, is the
funnel working, is the range being used, is anything wrong.

**Every rate states its denominator on screen.** `hostingRate` is not a number,
it is `{ hosts, eligible, rate, line }`, and the line reads "9 of 31 members who
can host brought a guest". A bare "29%" invites a founder to compare it against a
figure from a different denominator six months later.

Two denominators are chosen deliberately and are the whole correctness of the
panel:

- Hosting rate divides by members whose tier **can** host. Dividing by the whole
  roster reports a club as failing at something half its members were never able
  to do — and the response to a poor hosting rate is to spend money encouraging
  it, which would do nothing.
- Conversion divides by **distinct guests**, not visits. §3.2 counts "across all
  hosts, not per host", and a rate over visits would *fall* every time a guest
  enjoyed themselves enough to come back.

**The dashboard is the one console screen that requires a network, and it says
so.** Nothing on it is in the day pack, and putting it there would mean every
tablet on the range holding the club's revenue. §10's argument about what belongs
on a device applies: the pack deliberately carries no address and no licence
scan, and it should not carry the books either.

**Founder only, and not because the numbers are secret.** Most of it is visible
elsewhere to an officer. The restriction is the whole of it together — revenue, a
ranking of which members bring people who join, and every override any officer
made this week. An officer who can read the override list can see how closely
they are being watched, and is being invited to calibrate.

## M10 — hardening

Three artefacts, and none of them is a checklist.

`src/domain/period-boundary.test.ts` is the boundary half of §11's "load and
period-boundary testing". Every dated rule in the system has a day on which it
changes, and the bug is almost never in the rule — it is in whether the boundary
is inclusive and in which timezone the question was asked. Lagos is UTC+1 all
year, which removes daylight saving and leaves the one that bites: between 23:00Z
and midnight it is a different date in the two zones. The range closes long
before 11pm, which is exactly why that defect survives to production.

`scripts/volume.ts` (`npm run volume`) is the load half, at §2.1's stated size —
a hundred members, sixty guests, sixty arrivals. It **asserts it produced rows
before timing anything**, because the failure mode of a benchmark is not being
slow, it is measuring nothing: a fixture whose slots fell outside the window
would return an empty array in microseconds and pass every budget for the rest of
the project's life.

It is also explicitly *not* §6.4's acceptance test. §12 measures the render "on
the actual tablet model being purchased", and this runs in Node with no browser,
no IndexedDB and no paint. A pass is necessary and not sufficient.

`docs/M10_security_review.md` is a review rather than a checklist: §10's eight
requirements, what the code does, and what is outstanding — because a security
document that only lists what was done reads as a pass when it is not. It ends
with seven launch blockers, four of them hosting decisions and three of them
engineering work that has not been done.
