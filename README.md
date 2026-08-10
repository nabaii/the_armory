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
npm run harden       # WCAG 2.1 AA + performance budget + interaction
                     # needs `npm run build && npm run start` in another terminal
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

## Delivered so far — M0 only

Against the §11 plan, **M0 (Foundations)** is complete except for OTP auth and
device registration, and the §5 state machines from M2 are done early because
the capability service needed them. The remaining milestones — M1 offline
spine onward — are not started.

**M1 comes next and the sequencing note in §11 is not optional:** offline is a
property every later milestone is built into, and attempting it after M5 means
rewriting M2 through M5. §8.5 defines done for it as a real power cut on a real
tablet, not devtools offline mode.
