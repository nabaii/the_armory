# The Armory — Owner Decision Register

**For:** the project owner and client (one person).
**From:** project management.
**Dated:** 18 August 2026. **Status:** live document — supersedes nothing, collects everything.

---

## Why this document exists

Every decision below is already **registered somewhere in the build** — in
`src/lib/content-gate.ts`, in the security review, in the go-live sheet, in the
panel position of 17 August. What has never existed is one page that puts them in
front of the one person who can answer them, in the order the calendar demands.

The machine's own count, today:

| | |
| --- | --- |
| Registered items | **36** |
| Answered | **4** |
| Outstanding | **32** |
| Blocking the Phase 1 launch | **11** |
| Blocking Leagues opening (Phase 2) | **7** |

Run `npm run gate` at any time for the live version of that table. This document
is the human-readable half — the questions themselves, with a recommendation
against each, so that answering is a decision rather than a research project.

### Three things to know before reading

1. **Nothing here is waiting on code.** Every milestone M0–M14 is built and
   verified. What is outstanding is decisions, facts, credentials, acts and
   money. That is the honest shape of a pre-launch list.
2. **A missing answer is designed to look missing.** No screen invents a plausible
   value. An unanswered question produces one honest sentence — *"The club has not
   published its kitchen and bar hours yet"* — not an empty grid and not a guess.
   You can therefore launch with gaps, deliberately, and see exactly which ones.
3. **Most answers are a row update, not a deploy.** The §14 settings in Part D
   are entered as data. Answering them does not need engineering time or a
   release window.

### How to use each entry

Every item carries: **the question**, **what it blocks**, **the recommendation**,
and **where the answer lands**. The bracketed code (`kitchen-hours`) is the gate
id — quote it back and it routes straight into the codebase.

Sign each answer with a date. An unsigned decision gets re-litigated.

---

# PART A — Perishable. Answer within four weeks.

These five are not the most important. They are the ones where **delay destroys
the option**, which is a different property and the reason they come first.

### A1 · The database expires on 14 September 2026 — 27 days from today
**Question:** which Postgres instance does the club actually run on, and on what
paid plan?
**Blocks:** everything the management system records. The current instance is a
Render free tier, and Render **deletes free databases at expiry**.
**Why it is perishable:** a roster can be re-entered. A *trend* cannot. Every
figure the intelligence surface needs — the hospitality-versus-shooting split,
the revenue vocabulary, check-in times — accrues into that instance from the day
it is captured, and cannot be backfilled from memory.
**Recommendation:** move to a paid plan on the same provider this week, then pick
the region by **measuring Nigerian latency**, not by trusting documentation.
Enable point-in-time recovery at the same moment.
**Lands in:** `DATABASE_URL`, and gate item `database-provisioned`.

### A2 · The photography shoot, and the addendum that must go out before it
**Question:** when is the shoot, and has the photographer been given the
text-safe-zone addendum? [`photography`]
**Blocks:** the entire visual identity of the site. Architectural renders are
comps and must not ship.
**Why it is perishable — twice over:** the window closes when the facility becomes
operational, and the addendum is **unrecoverable afterwards**. The Brand
Guidelines shot list specifies fourteen shots and never specifies negative space
for type; the design spec requires a full-bleed hero carrying a headline, a
sub-line and two buttons. A shoot briefed without it returns beautiful
symmetrical frames with the subject centred and nowhere to put a headline, and
the only fix is a scrim the brand forbids.
**Recommendation:** send the addendum today, whatever the shoot date. It asks for
one thing: per hero candidate, a variant with a quiet, evenly-lit region in the
lower-left third, plus 16:9, 4:5 and 9:16 crops of the same frame.
**Budget note:** the hero has roughly **280 KB** before the performance budget
breaks. A 1600px AVIF is estimated at ~180 KB, so it fits — but re-measure the
day the shoot lands.

### A3 · Does the club serve food, and when?
**Question:** the kitchen and bar service windows for a standard week. [`kitchen-hours`]
**Blocks:** every table booking, and the second of the two numbers that tell you
whether this is a hospitality business with a range attached.
**Why it is perishable:** it is one of the two figures that must start accruing
before A1's deadline to be worth anything.
**Recommendation:** answer with actual windows even if provisional — *"12:00–16:00,
Tuesday to Sunday"* is a decision; *"whenever we're open"* is the permissive
reading that sells a lunch nobody is cooking.
**Lands in:** `armory.service_hours`, via the management screen. Empty today, and
the surface says so.
**Paired with A4 — both must be answered before a single cover can be sold.**

### A4 · How many covers can the club seat?
**Question:** the club's real table capacity. [`table-capacity`]
**Blocks:** table bookings, with A3.
**Recommendation:** a real number. It is deliberately not defaulted to unlimited —
that is the value that double-books a Friday evening in front of a guest.
**Lands in:** `armory.club_settings.table_capacity`, currently null.

### A5 · The manual league pilot — four members, one weekly round, one spreadsheet
**Question:** will you run it, and when? [`leagues-manual-pilot`]
**Blocks:** Leagues, but on a **Phase 1 deadline** — it validates the concept
before the club has anything to lose.
**Recommendation:** run it. *"If four friends will return weekly to move a number
in a spreadsheet, the concept is validated for the cost of an afternoon. If they
will not, no software saves it."*
**Do not ask for a tool for it.** Building one destroys what the pilot tests. The
resulting sheet becomes the first CSV import and the first honest test of the
schema.

---

# PART B — The eleven that block the Phase 1 launch

The site cannot go live until each of these is answered or explicitly accepted in
writing, with a date.

## B(i) — Yours alone

### B1 · The canonical domain [`domain`]
Needed for canonical URLs, social cards, and the SPF/DKIM/DMARC records in B8.
Everything downstream waits on it.

### B2 · The named owner of the membership pipeline [`membership-owner`]
**A person, with a name.** Flow A's last two steps have no technical component:
somebody reads the application and contacts the applicant. Without a name the
application flow terminates in an inbox and the site is a waitlist, not a funnel.
**This is the one open decision software cannot route around.**

### B3 · First-visit price, deposit amount, and refund policy wording [`first-visit-pricing`]
Blocks the entire booking flow. Refund terms must render **before** payment is
taken, and the policy version is stored against each booking for dispute defence.
Note this is distinct from membership pricing, which is never published anywhere —
that rule is enforced by the compiler and a figure is a build error.

### B4 · Logo vector files — all lockups and variants [`logo-vector`]
The guidelines forbid recreating the lockup, so the site renders a flagged
placeholder until real vectors arrive. The swap is a single file.
**Separate decision, not a blocker:** Option A (ship the supplied stencil) or
Option B (redraw the wordmark in a precision grotesque). **Option B is
recommended**, and the placeholder is deliberately built as a faithful interim
for it so that Option A is never chosen by default.

## B(ii) — Operations

### B5 · Confirm the first-visit ritual copy is operationally true [`ritual-accuracy`]
The *sequence* comes from the design spec. **Three facts are ours and must be
yours:** whether the briefing precedes equipment issue, the round length and shot
count for a first visit, and how results are returned. This is the
highest-leverage page for the growth segment and cannot ship on assumptions.

## B(iii) — Legal counsel

### B6 · Privacy, terms, refund, liability and eligibility copy [`legal`]
Must comply with the Nigeria Data Protection Act. **Ask counsel specifically:**
does the club's processing trigger the registration and DPO obligations for
controllers of major importance? The system holds identity documents,
photographs, addresses, dates of birth and firearm licences — for guests as well
as members.

## B(iv) — Accounts and credentials you must open

These read as engineering tasks. They are not: each one is an account only you
can open, or money only you can commit.

### B7 · Paystack, CRM and email-sending credentials [`integration-credentials`]
Until a CRM or a fallback address exists the intake layer **refuses**
submissions rather than accepting and dropping them. Until Paystack is
configured the booking module degrades to a phone number. Both are correct
behaviour, and both mean the site cannot convert.

### B8 · SPF, DKIM and DMARC on the club domain [`email-dns`]
Without an authenticated sending domain, confirmations land in spam, **both flows
appear to work perfectly in testing**, and applications die silently. Test
against real Gmail and Outlook inboxes.

### B9 · A durable store for public first-visit deposits [`booking-durable-store`]
The current store holds capacity in memory and does not survive a restart. Two
instances would each believe a full session had places left. The intended
production store is a private Google Calendar — that adapter is specified and
deliberately not stubbed, because untested integration code that looks finished
is worse than an honest absence.
**Scope correction worth knowing:** this is the **public** first-visit flow only.
Member bookings are durable and transactional and were never affected.

### B10 · The founder-facing revocation control, before any credential is cached [`offline-credential`]
The rule is *cache nothing until revocation exists*. Until it ships the digital
membership card is **online-only**, and the screen says so rather than failing
quietly at reception.
**Your decision inside it:** the card's time-to-live. 24 hours is recommended.
This is a security posture decision, not a technical one.

### B11 · Confirm encryption at rest, and record the setting
A hosting decision from the security review. Not closable by writing code.

---

# PART C — Acts, not decisions

Four things that a rushed project sacrifices, listed separately so they cannot be
mistaken for tickets. Each needs your calendar, not your judgement.

| # | Act | Why it cannot be skipped | Protocol |
| --- | --- | --- | --- |
| C1 | **The restore rehearsal** | *A backup never restored is a hope.* Phrased as a prohibition, not a task. | `docs/M10_restore_rehearsal.md` |
| C2 | **The offline acceptance run, on the tablet model you actually buy** | Includes physically pulling the power mid-session. Devtools offline mode is explicitly not evidence. | `docs/M1_offline_acceptance.md` |
| C3 | **Staff training, run as a test of the software** | The requirement is that a range officer who has not seen the screen before completes the workflow without instruction. That is a property of the screens, so the training is where it is measured. | `docs/M10_go_live.md` |
| C4 | **Reading the security review and signing it** | Its four open blockers are closed or **accepted in writing with a date**. There is no third state. | `docs/M10_security_review.md` |

**Hardware decisions inside these:** which tablet model (C2 cannot start without
it), how many desk and lane tablets, and — for Phase 2 — the television and the
machine driving it.

---

# PART D — Settings entered as data. Null means "not decided".

These live in one row and are changed by a row update, not a deploy. **Every
reader in the system handles null**, so leaving one unanswered is a supported
state with a defined behaviour — printed below so you can choose the silence
deliberately.

| Setting | Question | What null does today | Recommendation |
| --- | --- | --- | --- |
| `guest_overage_price_kobo` | What does a guest over the allowance cost? | **No overage charge is raised.** Guests are not refused; the club simply does not bill. | Set before opening, or accept the revenue is not collected |
| `roster_cap` | What is the membership cap? | The roster panel reports "no roster cap set" and admission enforces nothing | Set it; it is also the founding-member story |
| `waiver_validity_days` | How long is a signature good for? | A signature against the active version **never expires**. Fails open, deliberately | Ask counsel with B6 |
| `guest_retention_days` | How long may a non-joining guest's data be held? | **No automatic erasure.** Erasure on request works today | **Do not guess.** This is the one setting whose mistake cannot be undone. Blocked on counsel |
| `storage_enabled` | Is document storage live? | False — the whole workflow stays behind the flag | Flip only when Part E's object storage exists |
| `disciplines_requiring_qualification` | Which disciplines demand a sign-off? | None do | Operations' answer |
| `table_capacity` | See A4 | Table bookings are "not open yet", and say so | A4 |
| Spectators | Does a spectator occupy a cover? [`spectator-capacity`] | Zero — they consume a seat and a name on the arrivals list, but not a cover | Zero fails safe. A spectator who needs a seat is a seat found on the night; a guessed count silently refuses bookings nobody ever sees refused |

---

# PART E — The club's own opening data

The club opens on data put there deliberately, not on an empty database that
fills up by accident. Each line is yours to supply.

- [ ] **Membership tiers** — real names, real inclusions, real fees, founding cap. [`tiers`]
      The site never publishes a price; the members' account screen needs the real figure.
- [ ] **The active waiver version — exactly one.** Its body is what the desk displays before taking a signature.
- [ ] **Lanes, per discipline, with position capacity.** Availability is computed from these; a manually maintained calendar is forbidden.
- [ ] **Per-discipline facility specification** — lanes, distances, targeting, safety. [`facility-spec`]
      Lane counts for the 25m and 10m pistol lines appear in no source document and currently render as omitted rather than as zero.
- [ ] **Staff users, one per named person, with individual PINs.** No shared logins.
- [ ] **The firearm register with serials**, and every firearm's opening custody event.
- [ ] **Ammunition lots**, with real received quantities.
- [ ] **Founding members**, flagged.
- [ ] **Member passwords issued** — if the club opens before an SMS provider lands.
      ⚠ Never run the seed against production: it writes a known password for twenty members.
- [ ] **Tablets enrolled**, each with its own code, desk and lane registered distinctly, each synced once and then opened again with the network off.
- [ ] **Hospitality detail** — snack bar offer, deck capacities, VIP deck access rules. [`hospitality`]
- [ ] **Affiliations and certifications, with evidence.** [`affiliations`]
      Publish only what is true on day one. *"Built to international competition standard"* is safe from opening; *"host of the national championships"* waits until it has happened.
- [ ] **Institutional contact** — a named person and a direct number. [`institutional-contact`] No form; that audience does not fill in web forms.
- [ ] **Bookings phone number** [`bookings-phone`] — so a gateway outage degrades to a call.

---

# PART F — Money and infrastructure posture

### F1 · One Paystack account has one webhook URL — which endpoint gets it?
The club runs two: the public first-visit booking flow, and the club's own
payments. **Only one is reachable at a time.** Decide before opening.

### F2 · The reconciliation schedule
A secret and a scheduled call every fifteen minutes. Until it exists, a lost
payment webhook is found by a human or not at all. The endpoint is safe at any
frequency and safe to run twice at once.

### F3 · Object storage
Licence scans, member photographs and waiver signature images currently have
nowhere to go — signature bytes stay on the tablet. A security-review blocker.
**One consequence to carry forward:** an erased person's photograph will still
exist in whatever bucket you eventually configure. Whoever closes this owns
deleting those objects; the system already returns the exact list.

### F4 · One instance, or a rate-limit rule at the CDN
Login throttling counts in each instance's own memory. **Scaling to two instances
silently doubles every limit.** Either run one instance and record that as the
decision, or put the rule at the edge.

### F5 · An SMS provider, or member passwords as the standing interim
No provider means no one-time codes. The password login is standing in and works.
Decide whether that is the opening posture or a gap to close first.

### F6 · Management on shared devices — a posture decision recorded, not assumed [`manage-shared-device`]
A shared counter tablet needs short sessions and quick re-authentication; the
management surface currently authenticates with the long member session built for
a personal phone. Until the short-lived console hand-off ships, **the club should
not put management on a shared counter device.** Confirm you accept that.

---

# PART G — Governance and authority

The role model is a **draft to ratify, not a configuration file**. It was written
rather than deferred because a founder handed a blank page produces a role model
late while everything is blocked on it. It belongs with the Governance and
Authority Charter once you have signed it.

### G1 · Ratify the eleven grants and the eight role bundles
Yes, or amend. The unit of permission is a **grant**, not a role — deliberately,
because a role-based system cannot express a duty manager covering the armoury
for one evening without inventing a role, and the evening always wins: somebody
gets a permanent grant to solve a temporary problem and nobody takes it back.

### G2 · Ratify the two separations the system refuses outright

| | Never in the same hands | Why |
| --- | --- | --- |
| **S3** | armoury custody + the ledger | The classic custody-and-payment split |
| **S4** | the safety veto + commercial intelligence | A safety veto holder must never be measured on commercial outcomes |

Both are evaluated against the hand a person holds **after** a change, never
against the change in isolation — because the real failure is slow: somebody is
made armourer in August, and in March a different manager, looking at a screen
showing no ledger access, grants it. Each act is reasonable; no one could have
noticed.

### G3 · Ratify the founder exception
**Read is exempt** — you see every surface and every panel regardless of grants,
because the separation protects hands on the record, not eyes on it. A founder
refused a screen simply asks someone to read it aloud, which produces the
information without producing the record that it was looked at.
**Write is not exempt.** Your standing bundle drops `custody` and
`safety_manage`, one side of each separation, so your standing hand is clean.
Crossing is possible, deliberate and dated: you issue yourself an acting grant
with a reason, and it lapses by clock — visible in the register afterwards.
**Confirm you accept that shape**, including that dropping `safety_manage` is
deliberate: you are the person definitely measured on commercial outcomes, so the
one person who should not hold the safety veto.

### G4 · The maximum life of an acting grant
Grants lapse by clock, not by session — *"expires at 06:00"* must not mean
*"expires whenever they next sign in"*. **Recommendation:** a hard ceiling of one
operating day, renewable, so an overnight cover cannot quietly become permanent.

### G5 · Who may lower the operating level?
The degradation ladder is a switch, held today by whoever has `programme` or
`safety_manage`. Confirm, or narrow it.

### G6 · Does the range owner or landlord require reporting?
Worth establishing early. **A reporting obligation discovered late is a
data-capture problem, not a formatting one.**

---

# PART H — Product decisions the panel handed back

### H1 · Nomination expiry
A date. Cold-start progress decays if unused, and a nomination with no expiry is
one nobody spends.

### H2 · Refund and cancellation wording
Carried forward from B6. The booking book cannot implement a policy that does not
exist.

### H3 · The retention schedule for attendance records
Carried forward from Part D. Blocks member analytics — and **should** block it.
Individual behavioural surfaces are the one thing here easier to build than to
justify.

### H4 · Application ownership [`application-owner`]
Every application currently reads as owned by "Nobody", which is true. The fix is
one column and a control; the staffing half is B2 and is not software. Confirm
you want the column built now.

### H5 · Confirm the Phase 1 cut list
Product proposes cutting, with reasons: member analytics, cohort retention
curves, the waitlist, the nomination tree visualisation, the full reconciliation
UI, and equipment utilisation. It **refuses** to cut charge categorisation,
check-in timestamps, service hours, and near-miss reporting — each is cheap, and
each captures something that cannot be reconstructed afterwards.

---

# PART I — Phase 2 · Leagues. Seven blockers, separately tracked.

A hardware question about a targeting system must never hold up a website, so
these gate Leagues opening and nothing else.

| # | Decision | Note |
| --- | --- | --- |
| I1 | **Can the air rifle targeting system attribute and export scores?** [`targeting-system-export`] | Four questions for the installer: can it attribute a score to a **named person** rather than a lane; can it store results over time or does it display and forget; can it export by file, API or database, in what format; can a lane be bound to a person for a round. **Ask during the renovation.** A "no" degrades Leagues in quality, not existence — CSV and manual paths exist. |
| I2 | **The manual pilot** [`leagues-manual-pilot`] | See A5. |
| I3 | **A founding-member base exists before Leagues opens** [`founding-base`] | Code being ready is not a reason to ship. Launching a social competition product to an empty range is throwing a party nobody attends. |
| I4 | **Postgres provisioned, region measured, restore tested** [`database-provisioned`] | See A1. Scores and standings are irreplaceable in a way marketing copy never was. |
| I5 | **Is the live screen in launch scope, and on what hardware?** [`live-screen-scope`] | The one element of Leagues that genuinely requires software at launch. Must run offline and be readable at 5–10 metres — **test from the rail and the bar seating, not at a desk.** |
| I6 | **Who owns the churn number in season one?** [`churn-signal-tracking`] | Tracking who *stops* submitting is the only early warning you get. The code exists; what is outstanding is a person owning the number and acting on it. |
| I7 | **The attendance retention schedule** [`member-data-retention`] | Legal. Phase 2 turns a one-off booking into a recurring weekly schedule attached to a name, which is strictly worse. |

**Four Phase 2 questions that degrade rather than block:** shots per turn and
custom format limits (five is assumed); the Ladder's rolling window length (set
once real score distributions are visible); the season prize (**recommendation:
non-monetary and status-based** — a trophy at reception, names engraved, cheaper
than discounts and better for the brand); and the tournament scoring rule, which
is already settled below.

---

# PART J — Settled. Recorded so they are not reopened by accident.

| Decision | Answer | When |
| --- | --- | --- |
| Opening hours | 9am–6pm, every day | 16 Aug 2026 |
| Session length | 60 minutes, plus a 15-minute turnaround — seven sessions a discipline a day, from 09:00 | 16 Aug 2026 |
| Does the club have a programme? | **Yes.** The Diary keeps its tab and becomes the hospitality surface | 16 Aug 2026 |
| Tournament winner | Best of three rounds; gross total as tiebreak | Settled |
| Non-member league cap | One full season | Pre-build |
| Leagues database | Managed Postgres | Pre-build |
| Leagues sign-in | Passwordless email | Pre-build |
| Membership pricing on the site | Never published — "On application" only, enforced by the compiler | Spec |
| Wordmark | Option B recommended; placeholder built as its interim | Open, non-blocking |

> **One obligation created by the programme answer.** A tab promising a programme
> has to have one in it. The daily rhythm fills it, but guest evenings, fixtures
> and closures are the club's to keep current. **An events table nobody writes to
> makes the tab emptier than no tab would have been.**

---

# PART K — If you answer only ten things this month

In order. The first three are the ones that expire.

1. **Commit to a paid database plan** before 14 September. *(A1)*
2. **Send the photographer the text-safe-zone addendum.** Today, whatever the shoot date. *(A2)*
3. **Kitchen hours and table capacity.** Together — either alone leaves the surface saying so. *(A3, A4)*
4. **Name the person who owns the membership pipeline.** *(B2)*
5. **The domain.** Everything downstream waits on it. *(B1)*
6. **First-visit price, deposit and refund wording.** *(B3)*
7. **Brief counsel** — privacy, terms, liability, and the two retention periods. *(B6, D, H3)*
8. **Open the Paystack, CRM and email accounts.** *(B7, B8)*
9. **Ratify the role model and the founder exception.** Everything in management authority waits on your signature. *(G1–G3)*
10. **Put the four acts in the calendar** — restore rehearsal, offline acceptance on the real tablet, staff training, security sign-off. *(C1–C4)*

---

## Sign-off

The club opens when the owner signs, having read the outstanding list rather than
been protected from it.

| | Name | Date |
| --- | --- | --- |
| Register read in full | | |
| Part A answered or consciously deferred | | |
| Part B closed, or accepted in writing | | |
| Parts C1–C4 executed | | |
| Role model ratified | | |
| **Decision to open** | | |
