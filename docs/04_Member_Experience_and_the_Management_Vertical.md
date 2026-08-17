# The Armory — Member Experience and the Management Vertical

**A product panel record.** Fourth in the family.

| | |
| --- | --- |
| **Prepared for** | The Armory Shooting Sports Club — Founder |
| **Scope** | Two questions taken together: the experience the club curates for a member through this application, and the shape of the management vertical that produces it. |
| **Standing** | Companion to the Design Specification (Revision 2), the Members Portal Design Specification, and the Management System Design Specification (Draft 1, 16 August 2026). Where any two disagree, Revision 2 governs. Where this document disagrees with Management Draft 1 **on a fact about the code**, this document is written against the code and says which file. |
| **Codebase** | `nabaii/the_armory` at `85af4a6`, 17 August 2026. 75,315 lines of TypeScript across 344 files; two Postgres schemas; four shipped surfaces. |
| **Status** | Panel position. Section 9 records what we settled and what we hand back to the founder. |

---

## The panel

Six seats. Each one is named where it dissents, because a design document that
records only the conclusion is a document nobody can argue with later.

| Seat | Holds |
| --- | --- |
| **Product** | The two questions, the cut list, and the sequence. Owns Section 8. |
| **Engineering** | What the code actually says. Every finding in Section 1 is theirs, with a file reference. |
| **Experience design** | The member's intent, the staff member's posture, and the navigation that follows from both. |
| **Graphics** | Material, register, density, and what nothing looks like. |
| **Quality** | What breaks. Extends Management Draft 1 §15 rather than repeating it. |
| **Platform** | The 28 days, the pool, and the third route group. |

---

# SECTION 1

# What we found before we designed anything

The panel spent its first session reading the code rather than the brief. Five
findings came out of it. Four of them change what should be built; one of them
changes what the founder should believe about the numbers they are about to be
shown.

They are stated first because every recommendation in this document descends
from them.

## F1 — The club cannot raise a charge for the half of the business it says is the business

`src/domain/charges.ts` publishes the closed vocabulary of what a charge is
*for*, and its own comment explains why it is closed: a revenue report that
groups on free text is a report with "Subscription", "subscription" and "Subs"
as three sources.

```
CHARGE_REFERENCE_TYPES = membership · guest_visit · booking · storage · adjustment
```

Management Draft 1 §11.2 names the revenue mix — **membership · range · F&B ·
guest fees** — as one of the two numbers that can falsify the club's entire
strategy. Three of those four map onto the vocabulary above. The fourth has no
line in it.

The club has no way to raise a charge for food or drink. Not a granularity
problem, not a reporting problem: the schema has no word for it. Anything sold
on the deck today lands in `adjustment`, which is the catch-all — and the moment
it does, the falsifying number is not merely missing, it is **wrong in the
direction that flatters the range**.

Draft 1 says the category split "cannot be reconstructed later." It is right, and
it understates the case. The split cannot be *constructed* now.

## F2 — Revenue has two vocabularies in two tables, and they disagree

`src/domain/enums.ts` carries a second list, on the money coming in:

```
PAYMENT_PURPOSES = subscription · guest_overage · account_topup · bar · retail · other
```

So the bar *does* exist — on the payment, not on the charge. Neither list is a
superset of the other. `charges` knows about storage and knows nothing about the
bar; `payments` knows about the bar and retail and knows nothing about storage.

This matters more than an untidy pair of enums, because of one row:
`account_topup`.

> **A top-up is not revenue. It is a liability.** A member who puts ₦50,000 on
> their account has given the club cash it has not yet earned. Compute revenue
> mix from `payments` and that ₦50,000 appears as income on the day it arrives —
> and appears **a second time** as bar spend when the tab draws it down. Compute
> it from `charges` instead and the bar vanishes entirely.

Management Draft 1 §11.6 warns that two pipelines produce two answers and that
the first disagreement costs the founder's trust in both. The panel's finding is
that the second pipeline already exists, in the schema, before a single report
has been written.

**Position.** There is one revenue vocabulary. It lives on the charge, because a
charge is the club *earning* something and a payment is only the club *being
paid*. `payments.purpose` keeps `account_topup` — correctly, it is a real thing
that happens — and is never a revenue source. Reconciliation joins the two;
intelligence reads only the first.

## F3 — The kitchen has no hours

`src/domain/availability.ts` models an opening period as `opens`, `closes`,
`staffed`, and a `label` the file explicitly documents as **"rendered by the
Diary's operating-rhythm feed and never parsed."**

So the club can *write* "Deck and kitchen only" and cannot *model* it. Table
availability is generated with `staffedOnly: false` across every opening period
and gated on one global `tableCapacity`. The consequence is concrete and
sellable today: **a member can book a table at 09:15 on a day the kitchen opens
at noon.**

That is the same failure the file's own comment forbids one paragraph earlier —
"selling a Friday evening the kitchen cannot serve, the hospitality equivalent of
double-booking a lane" — arriving through the time dimension rather than the
capacity dimension. The build caught one half and the schema still permits the
other.

Management Draft 1 §7.1 lists service hours as a new component. The panel raises
its severity: this is not a management authoring convenience. It is the column
without which a hospitality-first club cannot sell hospitality.

## F4 — A non-shooting visit leaves no trace, and the number will read zero

The first falsifying number is the **non-shooting visit share**: visits with no
round fired, as a share of all visits.

Walk it through the club as built. A member comes in on a Tuesday to eat. They do
not check in — the desk console is a range gate, and its fifteen seconds are
about waivers, licences and equipment. They fire nothing, so no round is scored.
They buy lunch, which the schema cannot categorise (F1). At the end of the
quarter the intelligence surface computes the number that decides whether the
club is a destination or a range, and it reports **zero**, honestly, from a
record that never had a chance to say otherwise.

Constraint S2 says a missing value must look missing, because a zero invites a
decision. This is the precise case S2 was written for, and the decision it
invites is the wrong one: abandoning the hospitality thesis on evidence produced
by not having instrumented it.

**Position — and it is the neatest thing in this document.** Do not solve this at
the door. Solve it in the money. A categorised F&B charge against a member, on a
day that member fired no round, *is* a non-shooting visit. One capture path
serves both falsifying numbers: fix F1 and F4 resolves with it.

The panel is explicit about the residue. A member who comes to watch a fixture and
buys nothing leaves no trace under this scheme, so the number is a **floor, not a
census**, and the surface must say so in words. A floor that is honest about being
a floor is a usable number. A census that is quietly a floor is not.

## F5 — The application has never asked a member to do the one thing the club's growth depends on

The founding cohort is twenty-five anchor members with four nominations each.
That referral loop is, in the club's own strategy, the entire cold-start
mechanism.

`src/lib/app-nav.ts` gives the members app four tabs and a red action, and
documents at length why hosting has no tab of its own: hosting happens six to
twelve times a year, and a tab empty on most visits trains a member to ignore
that region of the screen. **That reasoning is correct and the panel keeps it.**

But nomination is not hosting. Hosting is a recurring behaviour with a low
frequency. Nomination is a **finite, expiring, one-time job** the club has handed
to twenty-five specific people, and the application has never once mentioned it
to them. Management Draft 1 §8.3 builds the nomination tree — for the founder, to
look at. Nobody built the other end, where the four nominations actually live.

A tree that visualises an acquisition engine nobody has been asked to operate is
a diagram of zero.

---

# SECTION 2

# One record, two ends — the rule that binds the halves

The founder asked two questions. The panel's strongest structural position is
that they are one question, and that treating them as two is how the club ends up
with a management system whose actions a member never sees and a member app that
asks for things no staff member can act on.

> ### THE MIRROR RULE
> **Every management write states its member-visible consequence at design time,
> and every member-visible fact names the management surface that authors it.**
>
> Not a nicety. It is the only cheap defence against the two failures this pairing
> reliably produces: a management feature that quietly changes what a member is
> promised, and a member surface that renders a fact nobody at the club has any
> way to keep true.
>
> A management action with **no** member-visible consequence is legitimate — an
> audit record, a custody reconciliation — and saying so out loud takes one line
> and settles it. What is not legitimate is not knowing.

Applied to the surfaces Draft 1 specifies:

| Management writes | The member sees | Today |
| --- | --- | --- |
| Programme authoring (§7.1) | The Diary — what is on | Tab exists, feed is the club's to fill |
| Service hours (§7.1) | Whether a table is bookable at that hour | **Not modelled** — F3 |
| Operating level change (§6.2) | Their slot closes, and they are told why | Nothing on the member side |
| Capacity override (§7.2) | A booking they were told was full | Correct as invisible — say so |
| Staff-entered booking (§12.2) | Their own booking, attributed to both | Attribution built; not rendered |
| Charge raised (§10) | A line on their statement | Built |
| Charge categorised (§10) | *Nothing* — and that is the point | Pure record, deliberately |
| Application decision (§8.2) | Where they are in the queue | **Nothing** — the applicant is told by a human or not at all |
| Expiry approaching (§9.3) | Their action stack | Member side built; register view absent |
| Near-miss filed (§9.2) | *Nothing, ever* | Correct, and load-bearing — S5 |
| Nomination issued (§8.3) | Four cards they have to spend | **Neither end** — F5 |

Three rows in that table are blank on both sides. They are the same three the
findings named, and Section 8 sequences them first.

---

# SECTION 3

# The member experience

## 3.1 Four moments, not four tabs

Experience design opened with the objection that the portal's four tabs are
**geography** — Today, Diary, Compete, Me — and that geography is the right model
for navigation and the wrong model for asking whether an experience is any good.
Members do not have tabs. They have moments.

| Moment | What the member is doing | Served today |
| --- | --- | --- |
| **Before you come** | Deciding whether to, choosing a day, bringing someone | **Well.** Diary is a calendar (M12), the booking flow is five steps, the allowance meter is honest. |
| **The day you come** | Arriving, being known, not being embarrassed | **Well enough.** The action stack surfaces every foreseeable block in advance — `foreseeableBlocks` in the capability service is doing real work here. |
| **While you are here** | Shooting, eating, talking to people | **Not at all, correctly.** See 3.2. |
| **Between visits** | Belonging, progressing, being invited back | **Barely.** This is where frequency is won and it is the least built thing in the product. |

The whole of the club's business problem sits in the fourth row. The frequency
problem is not "members find booking hard" — booking is good. It is that a member
who is not currently planning to shoot has **no reason to open this application**,
and a member who does not open it does not come in.

## 3.2 The panel's most contested position: the app gets out of the way on the premises

Experience design proposed an on-premises mode — check into a lane from the
phone, order from the deck, see the relay running.

Engineering and Quality both refused, and the panel sided with them.

> **The objection.** Every one of those is a second implementation of something
> the desk console already owns, on a device the club does not control, over a
> network at the National Stadium the club does not control either. Constraint
> S6 is that management exists to protect the fifteen-second check-in; a member
> app that can half-check-in produces a member arriving at the desk saying "I
> already did it on my phone" and an officer who now has to work out what that
> means. That is not neutral. That is work added to the desk by a member-facing
> feature, which is the one thing S6 forbids from either direction.

**Position.** On the premises, the application's job is to be unnecessary. The
member is in a room with the people and the equipment they came for; a phone
competing for that attention is a worse club, not a better product. The one
exception the panel allows is **reading** — the live screen already exists at
`/screen` for the wall, and a member glancing at their own relay is read-only,
stale-tolerant, and adds nothing to the desk.

This is not asceticism. It is where the fourth moment's budget comes from.

## 3.3 Between visits — presence, and the argument the panel had about it

The single strongest lever on frequency at 125 members is not a feature. It is
knowing that other members are coming in.

Experience design proposed a presence surface: *who is in tonight*. Quality
objected immediately, and correctly, on two grounds:

1. The retention schedule for attendance records is an **open legal blocker**
   (`member-data-retention` in `src/lib/content-gate.ts`, severity blocker).
   Management Draft 1 §11.5 forbids building individual behavioural surfaces
   before it lands, and a members-facing presence feed derived from check-ins is
   a per-member behavioural record with a wider audience than the management one.
2. A club where everyone can see everyone's attendance is a surveillance product
   for the member who visits twice a year, whatever it is for the member who
   visits weekly.

Engineering then made the observation that resolved it.

> **A visit is a record the club takes. An intention is a thing a member
> volunteers.** They are different data with different owners, different lives
> and different rules, and the presence surface only ever needed the second one.

**Position — "I'll be in."**

| | |
| --- | --- |
| **What it is** | A member taps a day in the Diary to say they intend to come. |
| **Where it lives** | Its own table. It is **never** derived from, backfilled from, or joined to `visits` or check-in records. |
| **Its life** | It expires at the end of the day it names. No history, no streak, no count. |
| **Who sees it** | Members, in aggregate first — *"nine members are coming in tonight"* — with names only where both members have opted in. |
| **Who does not see it** | Intelligence. It is not an analytic, it is not in the owner pack, and no staff surface ranks members by it. |
| **Why it can ship now** | It carries no attendance record, so it is not blocked on the retention schedule. It is a statement a member chose to make, for one day, to other members. |

The aggregate-first default is the part the panel argued longest about and the
part that makes it work. *"Nine members are coming in tonight"* is the sentence
that changes a Tuesday. It needs no names to do its job, and it gives the member
who wants to be private a version of the feature that costs them nothing.

## 3.4 Between visits — the nomination job

Finding F5, turned into a surface.

An anchor member holds four nominations. The application should, on the day the
club opens, tell them so — once, clearly, in the place they already look — and
then stop asking until something changes.

**Position.** Nominations do not get a tab. They get a **card on TODAY that is
present exactly while the member holds an unspent nomination**, and a section in
ME that holds the record permanently. That respects `app-nav.ts`'s reasoning
about empty tabs while refusing to let the club's whole acquisition engine live
somewhere nobody visits.

Three things the card must carry, and the third is the one that makes it work:

- How many remain, as a count of physical cards, not a percentage.
- Who has taken theirs up — because an anchor member who nominated a friend
  wants to know whether the friend actually joined, and today has no way to find
  out except asking the friend.
- **That they expire.** Draft 1 §11.2 notes cold-start progress "decays if
  unused". A nomination with no expiry is a nomination nobody spends. The date is
  the founder's to set and the surface is useless without it.

The mirror side is Management §8.3's nomination tree, which stops being a diagram
of zero.

## 3.5 Between visits — progression for the member who does not compete

COMPETE answers *how am I doing* with a record, an accrual statement and
competitions. For the member with competitive ambition, that is the right screen.
For most members of a hospitality-first club, it is a scoreboard they did not ask
to be on.

The panel's position is that progression and competition are different products
and the tab currently conflates them. **What did I shoot, what could I try next,
and what would I need to be signed off for it** is a progression question, it has
nothing to do with a ladder, and the data for it already exists — disciplines,
qualifications, and the capability service that can already say precisely why a
member may not shoot something and what the remedy is.

That last part is the whole opportunity. `evaluate()` returns a reason and a
remedy for every refusal, and `reasons.ts` was written so a member reads a
sentence rather than a permission code. Turned around, the same machinery
answers a question no member has yet been able to ask: *what would it take?*

**Position.** COMPETE keeps its name and gains a progression view above the
competitive one, built from qualifications and the capability service's own
remedies. Nothing new in the domain layer. It converts a range into a sport, and
it gives a member a reason to come in that is neither a fixture nor a meal.

## 3.6 The channel rule

The club's primary member channel is WhatsApp, hosted by a person, with no
chatbot, and Management Draft 1 §7.2 finds that a substantial share of bookings
will arrive that way. Platform added that web push on iOS requires the member to
have installed the PWA to their home screen, which most will not have done, and
that a notification channel the club cannot rely on is worse than one it does not
have.

The panel refuses to let the application compete with WhatsApp, and draws the
line by **audience** rather than by technology:

> **WhatsApp is the club's voice. The application is the member's record.**
>
> Anything the club says to everybody — tonight's fixture, a closure, the kitchen
> special — goes out on WhatsApp, where the club already has attention.
>
> Anything true about **you** — your licence expires in thirty days, your payment
> failed, your guest has not completed their form, your booking is confirmed —
> lives in the application and is never announced in a group.

That rule is decidable at design time by anyone, which is the only kind of channel
rule that survives contact with an actual Thursday. It also produces the club's
one legitimate use for push, if it ever ships: the private, personal,
time-critical item. Never the announcement.

## 3.7 The test every member surface has to pass

Constraint S6 gives management the fifteen-second check-in as its test. The member
app has never had one. The panel proposes:

> ### THE WHATSAPP TEST
> **A member surface must be faster than typing a message to a human being.**
>
> If booking a table takes five taps and a WhatsApp message takes eleven seconds,
> the member will send the message, a staff member will enter the booking, and
> the club will have paid for a feature that added work to the desk. This is not
> hypothetical — §7.2's finding says it is already how a substantial share of
> bookings arrive.
>
> The corollary is the useful half: where a surface **cannot** beat the message,
> do not build it. Build the staff-side path instead and make it excellent. A
> booking taken well by a person is a better member experience than a bad form,
> and the club should stop pretending otherwise.

## 3.8 The membership credential, downgraded on purpose

The offline membership credential is blocked — `offline-credential` in the gate
register, on the grounds that nothing may be cached until a founder-facing
revocation control exists to race against it. The panel checked whether the recent
permits work discharged that; it does not. `scripts/permits.ts` is a bootstrap
tool, marked, reversible and explicitly "not an operations tool."

The panel's contribution is to question the premise rather than the blocker.

**The desk does not need the member's phone.** The console runs offline-first
from a day pack that already contains every expected arrival, their standing,
their waiver state and their capability decisions — computed by the same
`evaluate()` the portal calls. A member holding up a screen at reception is not
how anyone gets checked in, and building the credential to survive a network
outage is building for a ceremony that has no operational role.

**Position.** The credential is an **identity object, not an operational one.**
Its design brief is belonging — the member number, the tier, the join date, the
mark — and it may remain strictly online, which is how it is built today and what
the screen already says. It stays behind the revocation blocker, and it drops out
of the critical path entirely, because nothing at the desk is waiting for it.

That is a whole launch blocker's worth of anxiety removed by asking what the
feature is actually for.

## 3.9 What the member application must not become

Recorded because the pressure will arrive, and Draft 1 §16 sets the precedent of
writing the reasoning down while it is cheap.

| Not building | Why |
| --- | --- |
| A feed | A club of 125 does not generate a feed. It generates an empty feed, which reads as a dead club — the failure M12 already names about the Diary. |
| Public leaderboards by default | The ladder is opt-in and gated on a founding base. A default leaderboard tells a hospitality club's median member that they are losing at a sport they came to enjoy. |
| Streaks, badges, points | The frequency problem is solved by giving people reasons to come, not by scoring them on having come. A streak also silently punishes the member who travels for work, which at this club is most of them. |
| Member-to-member messaging | WhatsApp exists, the members are already in a group, and a second inbox nobody checks is a support burden with a privacy surface attached. |
| Presence history | 3.3. The intention expires; there is nothing to keep. |

---

# SECTION 4

# The management vertical

The panel accepts Management Draft 1's six surfaces — THE DAY, DIARY, PEOPLE,
SAFETY, LEDGER, INTELLIGENCE — and its central argument that the navigation is
generated from the capability service so that the club's separations become facts
rather than promises. Nothing below re-argues that. What follows is what the
panel would add, change, or settle.

## 4.1 The role model, proposed rather than deferred

Draft 1 §18 makes the role model the first open decision and hands it to the
founder, on the grounds that S3 makes it a governance document rather than a
configuration file. That is right about its **standing** and, the panel thinks,
wrong about its **process**: a founder handed a blank page produces a role model
late, and everything is blocked on it.

So the panel proposes one to be ratified or amended, which is a much shorter
conversation than authoring one.

**The primitive is a capability grant, not a role.** Roles are named bundles of
grants, which is what lets the club invent "acting duty manager, tonight" without
inventing a role.

| Grant | Admits | Surface |
| --- | --- | --- |
| `DESK` | Check-in, issue, close the day | Console (exists) |
| `PROGRAMME` | Author hours, events, closures; take and amend bookings | DIARY |
| `PEOPLE` | Roster, applications, person record, compliance | PEOPLE |
| `CUSTODY` | Armoury register, firearm movements, exceptions | SAFETY (custody) |
| `SAFETY` | Incidents, near-misses, the safety veto | SAFETY |
| `LEDGER` | Charges, reconciliation, balances, takings | LEDGER |
| `INTELLIGENCE` | Aggregates, the owner pack, member analytics | INTELLIGENCE |
| `GRANTS` | Assigning and revoking every grant above | — |

| Role | Bundle |
| --- | --- |
| Front of house | `DESK` · `PEOPLE`(read) |
| Range officer | `DESK` · `SAFETY`(report) |
| Armourer | `DESK` · `CUSTODY` |
| Duty manager | `DESK` · `PROGRAMME` · `PEOPLE` · `SAFETY` |
| Finance | `LEDGER` |
| Safety officer | `SAFETY` · `INTELLIGENCE`(safety only) |
| Founder | all, subject to 4.2 |

**The forbidden set, refused at assignment rather than warned about:**

| Refused | From |
| --- | --- |
| `CUSTODY` + `LEDGER` | S3. Custody and payment are never in the same hands. |
| `SAFETY` + `INTELLIGENCE`(commercial) | S4. A safety veto holder is never measured on commercial outcomes — and never *measures* on them either. |
| `GRANTS` + any grant the holder could give themselves into a forbidden pair | The obvious hole in the first two rules. Evaluated on the **resulting set**, including self-grant. |

Quality's note, which the panel adopted: the refusal must be evaluated against
the *set a person would hold after the change*, never against the change in
isolation. A person granted `CUSTODY` today and `LEDGER` in March, by two
different people, is the audit finding Draft 1 §15 predicts, and it is only
caught by evaluating the whole hand.

## 4.2 The founder exception, made expensive rather than invisible

Every small club has this problem and most systems pretend not to. The founder
holds all six surfaces. By construction that violates S3 and S4. Refusing it is
not an option — there is one founder and the club has to run.

The panel's position, in three parts:

1. **Read is exempt.** The founder may see everything. Visibility is not the
   separation S3 protects; hands on the record are.
2. **Write-write is refused.** The founder may hold write on `CUSTODY` or write
   on `LEDGER`. Not both, at the same time, without a recorded change. Switching
   is allowed, takes effect immediately, requires a reason, and is logged.
3. **The exception is a register, not a silence.** Every action the founder takes
   inside an exempted combination writes to a register the founder cannot edit,
   which appears in full in the monthly owner pack — the one document the founder
   reads and, in a club of this size, the one an auditor, an insurer or a
   licensing authority will ask for.

That is the difference between a governance system and a governance document. The
charter says the separation exists. This makes crossing it possible, attributed,
and visible in the founder's own reporting — which is the only version that
survives a club with four staff on a Tuesday.

## 4.3 Thin staffing, and the grant that expires

Draft 1's §4.1 hand-off assumes a duty manager exists to hand off to. On a real
understaffed evening — the exact evening §6.2's operating level control is built
for — they do not.

The failure mode is not that the club is blocked. It is that somebody is given a
permanent grant to solve a temporary problem, and nobody ever takes it back. That
is how a front-of-house account ends up holding `LEDGER` eight months later, and
it is invisible until an audit.

**Position — acting grants.** A grant may be issued with an expiry. It states who
issued it, to whom, why, and when it lapses. It lapses **by clock, not by
session** — Draft 1 §15's stale-capability row already requires capability to be
re-evaluated per request rather than per session, and this rides on that.

One control, one required reason, an automatic end. Cheaper than a rota system
(§16 correctly refuses to build one) and it removes the single commonest way a
separation of duties decays in a small organisation.

## 4.4 THE DAY is panels, not dashboards

Engineering raised the combinatorial objection: five roles × a composed dashboard
is five dashboards to build, test and keep honest, and the sixth role the founder
invents in November is a sixth.

**Position.** The panel is the unit. Each panel declares the grant it requires and
is independently testable. A role is a **list of panel ids** — data, not code —
and the composition test is a single assertion: no panel ever renders for a role
lacking its grant.

This is the shape the codebase already uses. `portalNav` in `src/lib/app-nav.ts`
declares what each tab `owns` rather than inferring it from URL shape, precisely
so the relationship is stated and testable. THE DAY is the same idea pointed at
capability instead of routing.

The gate register (Draft 1 §6.3) becomes a panel like any other, requiring no
grant beyond founder, and it is the most valuable panel in the first month
because it is the only one with content on day one.

## 4.5 Management's home is a search box and a day

Experience design's contribution, and the panel adopted it without dissent.

At 125 members, hierarchy is the wrong navigation. When a question arises at the
club it is almost always about **a person** — why can this member not host, when
did their licence lapse, what do they owe, who brought them — which Draft 1 §8.4
already observes. The panel takes it one step further: if the person record is
where staff live, then **search is the primary navigation of the management
application**, and the six surfaces are where you go when you do not have a name.

Two consequences:

- Search is on every management screen, not on PEOPLE. It is the first thing
  focused on desktop.
- The person record is the spine, and it is the screen where the capability
  service earns its keep: it can show not merely that a person is blocked but
  which of six things is blocking them, with the remedy, in the same sentence the
  member reads in their own app. One vocabulary, both ends. That is the mirror
  rule as a screen.

## 4.6 The console hand-off, and the session that must not persist

Draft 1 §4.1 has the console open the management application authenticated as an
individual. Platform and Quality both flagged the same risk: that is a personal
login on a shared tablet bolted to a counter, and the failure is not exotic —
somebody stays signed in.

**Position.** The hand-off session is **single-purpose and short-lived**. It
carries the action it was opened for, it expires in minutes rather than hours, it
issues no refresh token, and it is bound to the console device that opened it so
it cannot be lifted onto a phone. The tablet never holds durable management
credentials of any kind.

This settles Draft 1 §18's open decision on front-of-house login in the direction
the specification already recommends — personal logins, because attribution is
the point — while removing the objection that made it a hard call.

## 4.7 Charge categorisation, without a tap at the desk

F1 says the vocabulary is missing a line. The design question is who supplies the
category, and the constraint is S6: nothing may be added to the fifteen seconds.

Engineering's position, which the panel adopted:

> **Derive it. Never guess it. Ask only where it is genuinely ambiguous.**
>
> A charge arising from a booking is `range`. A charge arising from a guest visit
> is `guest`. A membership charge is `membership`. Those three are derivable from
> `reference_type` with no human input at all, which is why they are already
> right in the schema. Only the fourth line needs a person, and only because the
> deck is where a human is already ringing something up.

A defaulted category that is *derived* is safe. A defaulted category that is
*guessed* is worse than a missing one, because a missing value looks missing (S2)
and a wrong one looks like data. So the rule is: derive where the reference type
determines it, require a choice where it does not, and never fall back to
`adjustment` for anything sold.

Which leaves the actual work, and it is small: **`fnb` joins the charge
vocabulary**, `adjustment` stops being the drain that swallows it, and the
revenue mix becomes computable on the day the first lunch is sold rather than
retrospectively never.

## 4.8 INTELLIGENCE — two rules, and where the queries run

Draft 1 §11.1's two governing rules are correct and the panel adds nothing to
them: compute from the record and never copy personal data out of it; report
counts, not percentages, at this cohort size.

What the panel adds is the operational corollary Platform insisted on.

> **An intelligence query must never be able to slow a check-in.** The management
> system and the console sync path share one Postgres pool
> (`src/db/armory/client.ts`, pooled TCP, chosen because the guest allowance
> needs real transactions). A season-wide aggregate scanning the visit table
> while a member is at the desk is not a slow dashboard — it is the club's
> central operating promise failing for a reason nobody at the desk can see.

Materialised views refreshed on a schedule, a statement timeout on the
intelligence path, and Draft 1 §15's load test — an aggregate refresh run against
a live console session — as a release gate rather than an aspiration.

And one measurement, which is two fields and the highest-value item in the whole
document per line of code: **timestamp the check-in.** The fifteen seconds appear
in four documents as a design constraint and nothing measures them. Until they
are measured, every claim about this product reducing desk work is an assertion.

## 4.9 What the panel would cut from Draft 1 for Phase 1

A specification that ships everything ships late. Product's cut list, with the
reasoning, because the reasoning is what gets it un-cut correctly later:

| Cut from Phase 1 | Why | When |
| --- | --- | --- |
| Member analytics (§11.5) | Blocked on the retention schedule and it should stay blocked. Individual behavioural surfaces are the one thing here that is easier to build than to justify. | After the schedule lands |
| Cohort retention curves | Needs a season. Nothing to plot. | Phase 2, as specified |
| Waitlist (§7.2) | Needs demand patterns that do not exist. Building it now is guessing at promotion rules. | Phase 1.5, as specified |
| The nomination *tree* visualisation | The member-side nomination cards (3.4) are the thing that creates the data. The diagram is worth building once it has more than twenty-five nodes and no edges. | After the cards |
| Full reconciliation UI | The sweep is a security blocker and must ship. The *surface* for working exceptions can be a query and a person for one quarter. | Phase 1.5 |
| Equipment utilisation | Genuinely a spreadsheet at this size, by §16's own four-question test. | Not building |

What the panel **refuses** to cut, against the expected pressure: charge
categorisation, check-in timestamps, service hours, and near-miss reporting.
Every one of them is cheap, and every one of them captures something that cannot
be reconstructed afterwards. Culture, like history, is set in the first month.

---

# SECTION 5

# Material, register and density

Graphics and Experience design, on how the third route group should look given
that the club already has a fully derived visual system it must not fork.

## 5.1 A third register, not a third brand

The site has an access register — Soffit Blue for open contexts, VIP Teal for
member contexts — mirroring the actual deck furniture so that tiering is felt
rather than announced. Management must **not** use it. Those colours encode *what
kind of member you are*, and a staff surface that borrows them says something
untrue about the person reading it.

**Position.** Management takes the setting-out field and the glazing material from
M13 unchanged — same square edges, same 10px blur ceiling, same derived tints —
and drops the access register entirely. Chalk ground, Charred Timber chrome,
Sight Ink for secondary text. Neutral, quiet, and instantly distinguishable from
both the marketing site and the members app without one new token.

This is the *same building, a different room*, which is the phrase the members
app was built to, applied a third time.

## 5.2 Red means "decide", never "primary"

The system's red is already split for contrast reasons: `ten-ring-red` for the
mark and graphic accents, `ten-ring-deep` for text-bearing use — button fills,
links, small labels.

Graphics' position is that management needs a **semantic** split on top of the
contrast one:

> On a screen the founder opens to find out what needs them, red must mean **this
> requires a decision**. If red is also the primary button, then every screen
> starts red, urgency has no colour left, and the exception panel that matters
> reads exactly like the "Save" button that does not.

So in management, and only in management, the primary action is Charred Timber
and red is reserved for exceptions, overdue items, unowned applications and
degradations. Consistent with the mark, unfamiliar to anyone who has only used
the marketing site, and correct for the one person whose attention this surface
exists to direct.

## 5.3 Density, without breaking the 8px scale

The spacing scale is 8px-based and a 4px value is deliberately inexpressible,
because "whitespace is the primary signal of premium positioning." That rule was
written for a marketing site read by a stranger evaluating the club.

Management is the first surface in this system that is **legitimately dense**. A
roster of 125 people, an expiry register, a booking book across a week — these
are tables, and a table with marketing rhythm is a table you scroll for a minute
to read twelve rows.

The tempting fix is a 4px value. The panel refuses it: once 4px exists somewhere,
it exists everywhere, and the scale that makes the rest of the product feel
composed is gone.

**Position.** A `data-density="compact"` scope on management surfaces, which
changes the **multiples** and not the **unit**. Where the site uses 24px between
rows, management uses 8px. Every value is still a multiple of 8. Nothing new
enters the token set, the marketing site is untouched, and the constraint that
produced the product's whole feel survives intact.

## 5.4 What nothing looks like

The most-seen management screen in month one is the empty one. The applications
queue with no applications, the booking book on a day with no bookings, the
expiry register with nothing expiring, intelligence with no season.

Constraint S2 requires that a missing value look missing, and the codebase already
enforces the harder half of this — `Pending` renders nothing in production rather
than plausible placeholder content, and `npm run gate:launch` is what stops a
launch. But "renders nothing" is a correctness rule, not a design.

**Position.** Graphics owns an empty-state set for management, and it distinguishes
three states that a single blank panel would conflate, because they call for three
different actions:

| State | Reads as | Example |
| --- | --- | --- |
| **Nothing yet** | The club has not started this | No applications have been received |
| **Nothing today** | Working as intended | No expiries in the next 60 days |
| **Nothing authored** | *Somebody has to type this* | The Diary with no programme in it |

The third is the one that matters and the one a generic empty state destroys. M11
records the exact failure: an events table nobody writes to makes the Diary
emptier than no Diary would have been. A management empty state that says *the
club has not published a programme* — with the surface to do it one tap away — is
the difference between a system that reports a gap and a system that closes it.

---

# SECTION 6

# What quality expects to break

Draft 1 §15 lists nine risks and the panel endorses all nine. These are the rows
the panel adds, arising from the positions above.

| Risk | Failure mode | Control |
| --- | --- | --- |
| Revenue computed from `payments` | Top-ups counted as revenue, bar spend counted twice, the mix flatters whichever way the money moved. | One vocabulary, on the charge. Assert in test that no revenue figure reads `payments.purpose`. |
| `adjustment` used for anything sold | The F&B line stays empty while F&B revenue exists; the falsifying number silently says the thesis failed. | Refuse `adjustment` where a derived category is available. Alert on its share. |
| Acting grant outlives the evening | A temporary grant becomes permanent and a separation decays invisibly. | Clock expiry, re-evaluated per request. Test that a lapsed grant refuses mid-session. |
| Forbidden pair assembled over time | Two grants, two dates, two grantors, no single moment anybody could have noticed. | Evaluate the resulting set, not the delta. Test the two-step assembly explicitly. |
| Hand-off session lifted off the tablet | A shared counter device becomes a personal login someone else is holding. | Device-bound, minutes-long, no refresh token. Test that the token fails from a second device. |
| Presence joined to attendance | A volunteered intention becomes a behavioural record, and the retention blocker is breached by a feature that was designed to avoid it. | Separate table, no foreign key to `visits`, expiry sweep. Erasure test extended to cover it. |
| Table sold outside service hours | A member books lunch for an hour the kitchen is shut. Worse than a closed range: they arrive, and the club watches it happen. | Table availability gated on a service period. The test is F3, run as a case. |
| Member sees a staff-entered booking as their own | §12.2's dispute, and channel analytics that cannot see the WhatsApp share. | Assert both identities, and render the attribution to the member. |
| Empty state reads as broken | Staff conclude the system is not working in week one, and go back to paper — which is unrecoverable. | The three-state empty set, 5.4. Reviewed on a database with no data at all. |

One process note, from Quality, that the panel endorses as a standing rule: the
management system's first acceptance test is **the training session**. §12 already
asks that a range officer who has not seen a screen before can complete the
workflow without instruction, and `docs/M10_go_live.md` already runs staff
training as a test of the software rather than of the staff. Every surface in this
document inherits that. If it needs explaining, it is not finished.

---

# SECTION 7

# Platform

## 7.1 The 28 days

Management Draft 1 §2 carries a precondition in a box: the Postgres instance is a
free tier expiring **14 September 2026**, and Render deletes free databases at
expiry.

Today is **17 August 2026**. That is twenty-eight days.

Nothing in this document survives the loss of that instance, and intelligence
suffers worst, because a trend cannot be backfilled from memory the way a roster
can. Two of the panel's four capture recommendations — charge categorisation and
check-in timestamps — exist specifically to accrue history that cannot be
reconstructed later, and they accrue it into that instance.

The panel declines to sequence anything ahead of this. It is not a task in Sprint
0; it is the precondition of Sprint 0, and the founder should treat any week that
passes without it as a week of the club's history put at risk. `docs/DEPLOY.md`
holds the procedure and `docs/M10_restore_rehearsal.md` holds the protocol that
proves it worked — and §10's phrasing of that requirement is the one to keep in
mind: *a backup never restored is a hope.*

## 7.2 The third route group

One repository, one deployment, a third route group beside the public site and
the members portal, guarded in the layout and generated from capability. The
panel agrees, and adds the two operational details the existing code already
implies:

- **`NEVER_CACHE`.** `/portal`, `/sign-in`, `/api/` and `/screen` are
  network-only — never written to any cache, because a service worker outlives
  sign-out and phones are shared, lent and lost. Every management route joins
  that list on the day the route group is created, not on the day somebody
  notices. The README states this as a standing rule for anything carrying
  personal data; management carries more of it than any surface in the product.
- **No second offline system.** Endorsed without qualification. The console is
  offline-first because it must be; the sync path is the hardest thing in the
  codebase to reason about; and a duty manager without connectivity already has a
  tool designed for exactly that, bolted to the counter.

## 7.3 Two service workers, three scopes

The console already has its own manifest and its own versioned worker
(`5517088`, `85af4a6`). Management adds a third installable context and the panel
wants it stated before it is built: **management is not installable.** It is a
personal-device surface used online, sitting, with time to think. An install
prompt on it buys nothing and adds a third worker scope to reason about on a
codebase that has already had to resolve two.

---

# SECTION 8

# Sequencing

Product's order. The rule applied throughout is Draft 1 §16's own four-question
test, with one addition from Section 1: **anything that captures history which
cannot be reconstructed later goes first, regardless of how small it is.**

### Sprint 0 — the precondition

Resolve the database expiry. Nothing else. Twenty-eight days.

### Sprint 1 — the two columns and the two fields

The smallest change set that starts both falsifying numbers and closes F1, F3 and
F4. None of it has a screen. All of it is unrecoverable if delayed.

| Work | Closes | Size |
| --- | --- | --- |
| `fnb` joins the charge vocabulary; category derived from reference type | F1, F4 | One enum, one derivation |
| Revenue reads charges only; `account_topup` excluded by construction | F2 | A rule and a test |
| Service hours as a modelled period; table availability gated on it | F3 | One column, one predicate |
| Check-in timestamps on the console | §11.4 | Two fields |

### Sprint 2 — the grants, and the navigation that comes from them

Nothing else in management can be built safely first. Capability grants, the
forbidden set evaluated on the resulting hand, acting grants with clock expiry,
the founder exception and its register, and the generated navigation.

### Sprint 3 — the surfaces the club cannot open without

THE DAY as panels for front of house, range officer and duty manager. The
applications queue with a named owner and an age. The person record. The expiry
register — one query, one screen, and the cheapest serious risk reduction
available anywhere in this document. Near-miss reporting, because culture is set
in the first month. The operating level control, because the first understaffed
evening arrives whether or not the ladder is a switch.

### Sprint 4 — the member's side of the same record

Programme authoring and the booking book ship as one piece of work with the
member Diary they fill, per Draft 1 §7's sequencing rule. Alongside them: the
nomination cards (3.4), "I'll be in" (3.3), and the progression view (3.5) — the
three surfaces that give a member a reason to open this application on a day they
are not shooting.

### Sprint 5 — first intelligence

The two falsifying numbers, on a quarter of real capture. The operating KPIs as
counts. The lapse list. The reconciliation sweep, which is also a security
blocker. The monthly owner pack, generated from the same computed figures the
screens use — one computation, consumed twice.

### After a season

Cohort retention, progression analytics, the nomination tree as a diagram,
forecasting, deeper operational analytics, and whatever the range owner turns out
to require. None of it is useful before there is a season to analyse, and all of
it depends on capture beginning in Sprint 1.

---

# SECTION 9

# Decisions

## 9.1 Taken by this panel

| Decision | Position |
| --- | --- |
| Revenue vocabulary | One list, on the charge. `fnb` added. Payments never a revenue source. |
| Non-shooting visit capture | Derived from a categorised F&B charge on a day with no round. A floor, and the surface says so. |
| Service hours | A modelled period, not a label. Table availability gated on it. |
| Presence | Volunteered intention, expiring daily, aggregate-first, never joined to attendance. |
| Nominations | Member-side cards before the founder-side tree. |
| Progression | Above competition in COMPETE, built from qualifications and the capability service's own remedies. |
| Channel | WhatsApp is the club's voice; the application is the member's record. |
| On-premises features | Not building. The application's job on site is to be unnecessary. |
| Membership credential | Identity object, not operational. Stays online-only, drops off the critical path. |
| Role model | Grants are the primitive; roles are bundles; forbidden pairs evaluated on the resulting hand. Proposed for ratification — 9.2. |
| Founder exception | Read exempt, write-write refused, every crossing in an uneditable register inside the owner pack. |
| Thin staffing | Acting grants with clock expiry, a required reason, and an automatic end. |
| Front-of-house login | Personal, per Draft 1's recommendation. The shared-tablet objection is answered by 4.6 rather than by shared accounts. |
| THE DAY | Panels declaring their grant; roles are lists of panel ids. |
| Management navigation | Search first. The person record is the spine. |
| Management register | Setting-out and glazing, no access-register colour, red means *decide*. |
| Density | `data-density="compact"` changes multiples, never the 8px unit. |
| Installability | Management is not installable. Two workers stay two. |

## 9.2 Handed back to the founder

Draft 1 §18 lists nine open decisions. Four of them the panel has taken a
position on above and needs only ratified. These five remain genuinely the
founder's, and the two marked ⚠ block work in Sprint 1.

| Decision | Blocks | What the panel needs |
| --- | --- | --- |
| **Ratify the role model** | Sprint 2, and therefore everything | Yes / amend. It is a governance document and belongs with the Charter, but it should not be authored from a blank page — 4.1 is the draft. |
| ⚠ **Does the club serve food, and when** | Sprint 1, service hours | Actual kitchen hours for a standard week. Without them the column has nothing to hold and the second falsifying number cannot start. |
| ⚠ **Retention schedule for attendance records** | Member analytics, the attendance report | Still an open legal blocker in the gate register. Presence (3.3) is designed to ship without it; nothing else individual should. |
| **Nomination expiry** | The nomination cards | A date. Cold-start progress decays if unused, and a nomination with no expiry is one nobody spends. |
| **Refund and cancellation wording** | The booking book | A legal blocker carried forward. The booking book cannot implement a policy that does not exist. |
| **Does the range owner require reporting** | Intelligence scope | Worth establishing early. A reporting obligation discovered late is a data-capture problem, not a formatting one. |

---

# CLOSING

## Three things this panel would want remembered

> ### ONE
> **The strategy is falsifiable, and the club is 28 days from being unable to test it.**
>
> The Armory is a hospitality business with a shooting range attached, or it is
> not. Two numbers say which. Neither can be computed today: one has no word in
> the schema, the other has no capture path at all. Both are fixed by one enum
> value and one column, neither of which has a screen — and both accrue into a
> database that expires on 14 September.

> ### TWO
> **The member application's job, between visits, is to give someone a reason to come in on a day they were not going to shoot.**
>
> Everything the portal does well, it does for a member who has already decided.
> Booking is good. The Diary is a real diary. The action stack is honest. None of
> it addresses the frequency problem, because none of it is read by someone who
> was not already coming. Nine members are coming in tonight; you hold four
> nominations that expire in March; you have shot three of the club's six
> disciplines. Those are the sentences that change a Tuesday.

> ### THREE
> **The management system and the members app are one record seen from two ends, and the club should refuse to design either alone.**
>
> Somebody has to type that the kitchen is open on Thursday before a member can
> read it. Somebody has to own an application before an applicant can be told
> where they stand. Somebody has to issue a nomination before an anchor member
> has one to spend. Every blank on the member's side of the mirror rule table is
> a management surface nobody built — and every management feature with no
> member-visible consequence should have to say, out loud, that it is a record
> rather than a promise.

---

THE ARMORY · MEMBER EXPERIENCE AND THE MANAGEMENT VERTICAL · PANEL POSITION · 17 AUGUST 2026
