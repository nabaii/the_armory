# M11 — The Members App

Built against **The Armory Members Portal Design Specification, Draft 1**
(15 August 2026), which is a companion to the Design Specification (Revision 2)
and governs one of the system's four surfaces: the authenticated member
experience.

The specification's own summary of the work was accurate:

> Most of this portal is already routed. What does not exist is the shell that
> binds them, the events entity behind the club's week, and two columns without
> which the booking calendar cannot honestly render. Those three things are the
> build. Everything else is arrangement.

---

## What shipped

| Surface | Route | State |
| --- | --- | --- |
| **Today** | `/portal` | Five cards, fixed order (§6.3) |
| **Diary** | `/portal/book` | Two modes — what's on, availability (§7.2) |
| **Compete** | `/portal/shooting` | Record, accrual statement, competitions (§8) |
| **Me** | `/portal/account` | Five groups, guests second (§9.1) |
| **Book** | `/portal/book/new` | Five steps, as a route (§7.4) |

Shared components, all reviewable at `/brand/components`:
`MembersShell` · `RemedyCard` · `StatusPill` · `AllowanceMeter` · `ScoreLine`
· `ProgrammeLine`.

Data work — `drizzle/0008_programme_and_booking_types.sql`:

1. `armory.opening_hours` — the club's week as rows.
2. `club_settings.session_minutes`, `booking_lead_time_minutes`,
   `table_capacity`.
3. `armory.bookings.booking_type` and a nullable `discipline`, paired by a
   CHECK.
4. `armory.events` — the one-off programme feed.

---

## Two corrections to the specification, on the facts

The specification was written against the Build Record and got two things
wrong. Both are recorded rather than quietly worked around, in the same spirit
as its own §1.1.

### 1. The member booking store was never the in-memory one

§2.2 lists "durable booking store" as blocking "Diary in full, the red BOOK
action, any booking shown on Today".

`src/server/booking-store.ts` — the in-memory store the outstanding register
names — serves the **public first-visit deposit flow** and nothing else. Member
bookings have lived in `armory.bookings` and `armory.booking_participants`
since M4: durable, transactional, state-machined, with allowance release on
cancellation and capacity checked inside the writing transaction.

What actually blocked the member calendar was **opening hours**, which had no
column. `drizzle/0008` settles that, and the outstanding register entry has
been rescoped to say so.

### 2. Migration 0008 was not "written, reviewed, tested, held"

§2.2 describes a migration 0008 covering self-serve email verification as
already written. No such file existed on `main` at `60a2954`; the migration
history ended at `0007_member_passwords`. The number is now taken by this
work. Email verification remains unbuilt and unregistered — it is not part of
the Members Portal scope and should be raised on its own.

---

## What was deliberately not built

| Item | Why | Where it is tracked |
| --- | --- | --- |
| Offline membership credential | §9.2 — "cache nothing until revocation exists". A cached card with a 24-hour life is only safe if there is something to race against it. | `offline-credential` |
| Live competition on Today | §15 places it in Phase 1.5, after the Ladder | — |
| The club Ladder | §8.2 — gated on a founding-member base and the manual pilot, neither of which is engineering | `founding-base`, `leagues-manual-pilot` |
| Keepsake card | §15, Phase 1.5 | — |
| Member-created competitions | §8.3, Phase 2 — an addition to a working engine | — |
| Table capacity value | The club has not counted its covers. Null reads as "not open yet", never as unlimited. | `table-capacity` |

---

## The open decision this portal sits on

**§7.5 — does the club have a programme?**

> If the club has a programme — a reason to be there on an evening you are not
> shooting, published in advance — Diary is the hospitality surface and it earns
> a tab. If the honest answer is *the range is open, come when you like*, then
> Diary is a date picker wearing a tab, and the correct structure is three tabs
> and an action.

The Diary is built as the specification describes it, and the decision is
registered as `club-programme` rather than taken. §16 is explicit: "None should
be resolved by the development team by default."

If the answer turns out to be no, the change is small and local — remove the
Diary entry from `portalNav` in `src/lib/app-nav.ts` and move the availability
grid inside the booking flow. Nothing else depends on it.

---

## Publishing the club's week

Nothing in this milestone publishes a single hour. The tables arrive empty and
every screen that depends on them renders one honest sentence, which is P2
working rather than an omission.

```sql
-- Sessions and notice. Both null means no slots and the honest sentence.
update armory.club_settings
   set session_minutes = 60,
       booking_lead_time_minutes = 60,
       table_capacity = 24;

-- One row per stretch of one weekday. 0 = Sunday. Minutes since Lagos midnight.
insert into armory.opening_hours (id, weekday, opens_minute, closes_minute, staffed, label)
values (armory.uuidv7(), 4, 9*60, 21*60, true,  'Range and deck'),
       (armory.uuidv7(), 5, 12*60, 22*60, false, 'Deck and kitchen only');

-- A one-off. `published` defaults to false so a draft is not a member's screen.
insert into armory.events (id, kind, title, on_date, starts_minute, ends_minute, published)
values (armory.uuidv7(), 'event', 'Guest evening', '2026-09-04', 18*60, 21*60, true);

-- A closure suppresses that day's service hours. The club never has to edit
-- its opening hours for a public holiday and remember to put them back.
insert into armory.events (id, kind, title, on_date, published)
values (armory.uuidv7(), 'closure', 'Closed — public holiday', '2026-10-01', true);
```

A founder screen for all of this is the obvious next piece of work and is not in
this milestone. Until it exists, the statements above are the interface.

---

## Constraints this build is holding

The specification's six governing constraints, and where each is enforced
rather than documented:

| | Where it lives |
| --- | --- |
| **P1** No screen makes its own permission decision | `RemedyCard` takes a sentence and cannot be passed a membership. Today's stack is one component in a loop over `foreseeableBlocks`. |
| **P2** A missing value must look missing | `UNCONFIGURED_AVAILABILITY`, `emptyReason`, `emptyTableReason`, and an empty `opening_hours` table |
| **P3** Worth opening when not shooting | Four of Today's five cards are for the weeks in between |
| **P4** Hospitality before range | `booking_type`, table capacity counted separately, and tables first in the availability grid |
| **P5** Never embarrass a member in front of a guest | The overage price appears once, at confirmation. Guest-link abandonment is flagged to the host. The membership card says it needs a connection. |
| **P6** Protect the fifteen-second check-in | The arrivals row carries `booking_type`, so the desk reads "Table" rather than a blank cell it would have to ask about |

And §13.2's named risk is now a lint rule rather than institutional memory: a
`"use server"` module that exports anything but an async function fails
`npm run lint`. That is the defect that took sign-in, the application, the
enquiry and the waitlist forms down together.

---

## Still true, and not solved by any of this

The Postgres instance is a free tier and Render deletes free databases at
expiry. Every score, waiver and custody record goes with it, and score history
against a named person is the one thing the Design Specification says cannot be
reconstructed after the fact. It is registered as `database-provisioned` and
nothing in this milestone is worth an hour of attention until it is settled.
