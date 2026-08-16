# M12 — The Diary becomes a calendar

Built against the Members Portal Design Specification §6 and §7, and against
one sentence of the brief that the shipped Diary did not honour:

> §7.1 — "A member deciding whether to come in on the twenty-seventh, or
> noticing a fixture three weeks out, needs a surface Today cannot be."

M11 shipped that tab as a rolling seven-day strip. It is a good day picker and
it is not a diary. The twenty-seventh was reachable only by tapping forward
through the week one day at a time; a fixture three weeks out was not visible at
all — three screens of tapping away, which in practice means nobody finds it. A
member planning a month could not see a month.

---

## What the Diary is now

Three surfaces, in the order a member uses them.

| | Answers | Where |
| --- | --- | --- |
| **The calendar** | *Where* things are in the month | `MonthCalendar` |
| **Coming up** | *What* those things are, in order | `Agenda` |
| **The day** | What is on, or what is free, on the one day chosen | the day panel |

The grid answers *where*, the agenda answers *what*, and the day panel answers
the question that follows. None is redundant, and removing any one of them puts
its question back on WhatsApp — which is the phone call this portal exists to
prevent.

### The month travels

`?month=2026-09`, three months forward, and no further. The horizon is not a
performance limit; it is P2 applied to time. Beyond a few months the club has
published nothing but its weekly rhythm, so every cell would carry the same
quiet open mark and the calendar would say *the club is open on 14 February*
with the same confidence it says it about next Tuesday. Those are not the same
claim. The absent next-month arrow is a visible statement that the club's diary
ends here, which is true.

There is no travelling backwards past the current month. The Diary answers
"what could I do"; a member's own history is Compete's job and it is a better
answer than an empty grid of past Tuesdays. The useful part of the past — last
week, beside this one — is still there, in the grid's leading cells.

### The marks, and why the club being open is not one of them

The club is open every day. A mark on every one of thirty-one cells carries
exactly as much information as no mark at all, so the operating rhythm is
carried by the legibility of the numeral — full ink when the club is open,
muted when it is not — and the glyphs are spent on the exceptional days a member
is actually scanning for.

| Mark | Means |
| --- | --- |
| filled square | the club has published something |
| hollow square | a league round is due |
| struck numeral, tinted cell | a closure |
| bar on the cell's edge | the member is already coming in |
| the red centre dot | today (Brand Guidelines §8, doing its job) |

None is colour alone (WCAG 1.4.1): filled and hollow are shapes, the strike is a
shape, the bar is a position, and every cell carries a written label naming what
is on it. The three measured pairs are now in `requiredPairs`, so `npm run gate`
fails if one of them ever stops holding.

---

## Decisions taken, and the arguments behind them

### The week starts on Monday

`lagosParts().weekday` is 0-for-Sunday because that is what `Date` gives, and
the seven-day strip inherited that ordering by accident — it started on whatever
day the member opened the app, so the question never arose. A grid has to
commit. Rendering Sunday first splits the weekend across both edges of the grid,
which is the one arrangement that makes *am I free at the weekend* harder to
read than it needs to be.

### The grid takes as many rows as the month needs

A fixed six-row grid is the common implementation and it is wrong on a phone: a
month needing five rows and rendered in six gives up a whole row of vertical
space — the row the day's detail would otherwise occupy above the fold. The cost
is that the calendar changes height between months, which is honest. Nobody has
ever been confused by a wall calendar for the same reason.

### Today keeps its fixed order and gains a rail

§6.3 forbids reordering Today's cards and §6.1 forbids horizontal carousels.
Neither is bent. The seven-day rail is added *inside* card 3 — "At the club" —
above the prose §6.4 already required, and it is not a carousel: seven cells fit
the narrowest phone the club supports, nothing scrolls, and there is no eighth
day to discover by swiping.

It does not select. Today has exactly one day in it, and a rail that changed the
card beneath it would be a small Diary embedded in Today, which is the surface
§7.1 spends a paragraph keeping separate. Every cell is a link *out*.

### The rail's cells carry their own Chalk ground

Card 3 is a Soffit Blue section, and two of the three marks are fixed brand
colours whose contrast is a property of what is behind them. Ten Ring Red
measures 3.79:1 on Chalk and **1.68:1 on Soffit Blue** — rendered straight onto
the card, the today dot and the something-on square would both be non-text
indicators at roughly half what WCAG 2.1 requires.

`BottomNav` reached this junction first and took the same turn: rather than pick
a different red — which Guidelines §3 forbids, and which would make the dot a
different dot on one screen — give the marker the opaque ground the brand
already guarantees it. `groundClasses` is that move made reusable, and its
doc comment says plainly that this is the only case it is for.

### The booking horizon reaches the calendar, and P1 still holds

The calendar reaches three months ahead and most tiers do not. A member on a
fourteen-day horizon paging to October and finding a grid of bookable Saturdays
has been shown something the club will refuse — and would find out at step five
of the booking flow, having chosen a day and named their guests. That is P5's
failure, one screen earlier.

P1 forbids the screen working out *why* on its own, so it does not compare a
date against a number. `bookingHorizonBlock` is exported from the capability
layer, `mayBook` now calls it too, and the Diary renders the sentence it is
handed — from `reasons.ts`, where every other message the member reads comes
from. One rule, one message, and a calendar that cannot drift from the check at
commit.

### The optimistic selection has no effect in it

A tap moves the selected cell immediately rather than when the server answers;
scanning a month is half a dozen taps and a selection that lags each one by a
round trip is the difference between an application and a website with a
calendar on it.

The obvious shape — a key plus an effect that clears it when the server answers
— is both a lint failure and a real one: the effect runs a render late, so there
is a frame in which the new answer and the stale guess are both on screen and
the guess wins. Storing the selection the guess was made *against* removes the
reset entirely. The moment the prop changes the guess no longer matches and is
ignored in the same render.

### Availability is grouped by part of the day

Seven sessions across three disciplines plus tables is thirty chips in four
wrapping rows of identical shapes, and the member's actual question — *is there
anything around six* — was answered by counting along a row. People hold a day
as morning, afternoon and evening, and they arrive already knowing which they
mean.

A full slot is still rendered rather than filtered (§6.2), and a part of the day
the club is not open at all is simply absent. Those are different facts and the
board does not merge them. The capacity bar is a scanning aid and never the only
statement — a bar cannot tell two places from three, which is exactly the
difference a member bringing a guest is reading for.

---

## What did not change, deliberately

| | Why |
| --- | --- |
| Today's five cards, and their order | §6.3. The order is fixed, not computed, and nothing here computes it. |
| The four tabs | §5. The Diary is a better Diary; it is not a different tab. |
| `programmeForDay` — the merge | It already decides what is on a day, correctly, including a closure outranking everything. The calendar decides only how days are *arranged* and what is worth *marking*. |
| Availability's slot ids | The booking flow re-derives the identical grid on commit and refuses any id not on it. The grid is still projected from today for that reason, then filtered to the chosen day. |
| Fixtures | Still weeks rather than dates (Leagues Spec §8), still passed in as an empty list. When they arrive, both the grid and the agenda pick them up with no further work — `fixture` is already a mark. |

---

## One vocabulary, three surfaces

`DayMarks.tsx` holds the glyphs and is not a client component. The month grid is
one (optimistic selection, the grid keyboard pattern); Today's rail is not — a
rail cell navigates away and has nothing to be optimistic about. Sharing through
a plain module keeps Today off the calendar's bundle, which matters against
§6.4's one-second cold render.

The reason they share at all is the argument `app-nav.ts` makes about the two
navigations and `ProgrammeLine` makes about Today's card and the Diary's list: a
member who has learned that a filled square means *something is on* has learned
it for the application, not for one screen. Two implementations would disagree
within a release and the version a member believed would depend on which tab
they were on.

`calendarDays` is the same rule one level down — the grid and the rail are the
same days with the same marks arranged differently, and a test asserts that a
day carries identical marks in both.

---

## The retired week strip

`WeekStrip` is gone from `DiaryControls`, which now holds only the mode switch.
Keeping it would have left three implementations of "a row of marked days" in a
codebase whose own comments argue at length against two.

---

## Verified

| Checked | Result |
| --- | --- |
| `npm run typecheck` · `lint` · `test` | green — 969 tests, 45 of them new |
| `npm run gate` | passes, with three new calendar contrast pairs enforced |
| `npm run volume` | within §6.4's budgets |
| `npm run build` | compiles; every portal route still server-rendered on demand |
| Every weekday a month can start on | the first of the month lands in its own column, in all twelve months tested |
| A leap February | 29 days, four rows |
| A closure | marked closed, not marked open, and an event announced on the same day survives |
| Rendered at 420px, on the component reference | grid, rail, agenda and slot board all read as intended |
| Arrow keys, Home, End | move focus by a day, a week, and to the ends of the week's row |

The calendar was rendered and driven in a real browser rather than inferred from
a type check — which is how M11 found the defect that took the Diary down, and
the reason it is worth doing every time.

---

## Still true, and not solved by any of this

The events table is the club's to keep current, and an events table nobody
writes to makes this tab emptier than no tab would have been — §7.5's named
failure. The month makes that more visible rather than less: thirty-one cells of
operating rhythm with no glyph on any of them is a legible statement that the
club has published nothing. **Coming up** says it in words.

A founder screen for writing events, closures and opening hours remains the
obvious next piece of work, and remains unbuilt. Until it exists,
`npm run db:hours` and the SQL in `M11_members_portal.md` are the interface.
