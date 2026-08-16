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

Data work:

`drizzle/0008_programme_and_booking_types.sql`

1. `armory.opening_hours` — the club's week as rows.
2. `club_settings.session_minutes`, `booking_lead_time_minutes`,
   `table_capacity`.
3. `armory.bookings.booking_type` and a nullable `discipline`, paired by a
   CHECK.
4. `armory.events` — the one-off programme feed.

`drizzle/0009_session_turnaround.sql`

5. `club_settings.turnaround_minutes` — the operational buffer between one
   session and the next, kept apart from the session itself.

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

## The decision this portal sat on — taken, 16 August 2026

**§7.5 — does the club have a programme? YES.**

The Diary keeps its tab and the four-tab structure stands: TODAY · DIARY ·
COMPETE · ME · BOOK. The three-tab alternative is not built and is not needed.

What the answer creates is an obligation rather than a feature. A tab promising
a programme has to have one in it. The operating rhythm fills it every day now
that the week is published; the one-off feed — guest evenings, fixtures,
closures — is the club's to keep current. An events table nobody writes to makes
this tab emptier than no tab would have been, which is the failure §7.3 warns
about.

**The club's week — 9am to 6pm, every day.**

Declared in `src/content/club-week.ts`, which is where the public site's
sentence and the portal's rows both come from. `staffed: true` on all seven
days is an assumption drawn from "open every day", and it is the consequential
field: an unstaffed period yields no shooting slots at all while still
publishing to the Diary as club open. If the club's real officer coverage is
narrower, that is the one line to change.

**The session — 60 minutes, with a 15-minute operational buffer.**

Two columns, not one, because they belong to different people:

| | Whose | What it does |
| --- | --- | --- |
| `session_minutes` | the member's | What their booking says, what the desk expects, how long the lane is theirs |
| `turnaround_minutes` | the club's | Clearing the line, resetting targets, one relay off and the next briefed |

The grid steps by their sum; a booking still ends at the session. A member who
takes 09:00 has a booking that ends at 10:00, and the next bookable slot is
10:15. Folded into a single "slot length" the record would claim they had the
lane until 10:15 while the officer walked them off at 10:00 — and the one
holding the phone would be right.

The club's day is therefore **seven sessions per discipline**:

```
09:00–10:00   10:15–11:15   11:30–12:30   12:45–13:45
14:00–15:00   15:15–16:15   16:30–17:30
```

The 17:45 a naive step would offer runs to 18:45, past closing, so it is not
there. The fit test is against the *session*, not the step — testing the step
would silently cost the club its last slot of every day, since a buffer exists
to separate one session from the next and at closing there is no next one.

**Booking is slot-based, and enforced rather than assumed.**

`placeBooking` re-derives the grid from the club's own hours and refuses any
slot id not on it, then takes the times from the slot it resolved. The form no
longer posts a start or an end at all.

Before this it read `slotStart` and `slotEnd` straight off hidden inputs behind
a comment claiming they were "re-read rather than trusted". They were not. That
allowed a booking at 03:40 on a day the club is shut, a six-hour booking, or one
landing inside another's turnaround — none reachable through the interface, all
reachable with a form post, against the one table whose job is to say who is on
which lane when.

---

## Publishing the club's week

The week is declared in code and applied by a script — it is **not** written by
a deploy:

```bash
npm run db:hours            # show what the database holds, change nothing
npm run db:hours -- --apply # publish the declared week
```

It prints before it writes, refuses to guess, and running it twice changes
nothing the second time. It also reports what still stands between a published
week and a bookable calendar, because a founder who publishes hours and finds
nothing bookable deserves to be told why on the spot.

It writes the week, the session length and the turnaround — the three things
the club has decided. It does not write `table_capacity`, which is still open:
until it is set, table bookings stay closed and the Diary says so.

If the session length were ever unset, the grid would produce nothing on every
day and the portal would name that specifically rather than reading as a busy
club:

> The club has not set how long a session runs, so nothing can be booked yet.

Everything else, for reference:

```sql
-- Covers at the tables, and any minimum notice.
update armory.club_settings
   set booking_lead_time_minutes = 60,
       table_capacity = 24;

-- A one-off. `published` defaults to false so a draft is not a member's screen.
insert into armory.events (id, kind, title, on_date, starts_minute, ends_minute, published)
values (armory.uuidv7(), 'event', 'Guest evening', '2026-09-04', 18*60, 21*60, true);

-- A closure suppresses that day's service hours. The club never has to edit
-- its opening hours for a public holiday and remember to put them back.
insert into armory.events (id, kind, title, on_date, published)
values (armory.uuidv7(), 'closure', 'Closed — public holiday', '2026-10-01', true);
```

A founder screen for all of this is the obvious next piece of work and is not in
this milestone. Until it exists, `npm run db:hours` and the statements above are
the interface.

---

## Proved against a real database

Not inferred from a type check. A Postgres 16 instance was raised, all nine
migrations applied, a club bootstrapped, the week published, and every portal
surface loaded as a signed-in founding member.

| Checked | Result |
| --- | --- |
| All nine migrations, including 0008 | applied |
| `bookings_discipline_matches_type` | refuses a table booking that names a discipline, and a shoot booking that names none |
| `opening_hours_period_is_ordered` | refuses a period closing before it opens |
| `opening_hours_weekday_is_a_weekday` | refuses weekday 7 |
| `events_times_are_absent_or_ordered` | refuses a start with no end |
| `club_settings_turnaround_is_not_negative` | refuses a negative buffer — the one value that would hand two relays the same lane |
| `npm run db:hours -- --apply` | publishes 7 periods, 60-minute sessions, 15-minute turnaround |
| Today, Diary (both modes), Book, Compete, Me | render for a real member |
| A booking placed through all five steps | lands as `shoot / 10m-air-rifle / confirmed`, 11:30–12:30, **60 minutes** |
| The slot it took | drops from 2 places to 1 |
| The next slot, 12:45 | still 2 places — the buffer is a no-op on an aligned grid |
| Forged slot ids: `03:40` (club shut), `11:00` (between slots) | both refused, flow returns to step 1 |
| A genuine slot id | proceeds to step 4 |

**It found a defect nothing else would have.** The Diary returned a 500 on every
request — `WeekStrip` and `ModeSwitch` are client components and the page was
passing them functions to build hrefs, which cannot cross the server/client
boundary. Type checking, linting, the build and 915 unit tests were all green
against it. It is fixed by passing finished hrefs, which is the better shape
anyway.

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
