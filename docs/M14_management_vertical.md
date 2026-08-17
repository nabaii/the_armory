# M14 — The management vertical

Built against the **Management System Design Specification** (Draft 1, 16 August
2026) and the product panel record of 17 August 2026
(`docs/04_Member_Experience_and_the_Management_Vertical.md`), which is written
against the code rather than against the brief and corrects the specification on
four facts.

Three sprints, in the order the panel set. The rule throughout: **anything that
captures history which cannot be reconstructed later goes first, regardless of
how small it is.**

---

## What shipped

| Sprint | Work | Where |
| --- | --- | --- |
| **1** | The capture. `fnb`, the revenue rule, the visit share, service hours, the check-in clock | `src/domain/{charges,revenue,intelligence,availability}.ts`, `drizzle/0010` |
| **2** | Grants, the forbidden set, acting grants, generated navigation | `src/domain/grants.ts`, `src/server/armory/grants.ts`, `drizzle/0011` |
| **3** | The route group — seven routes, guarded and composed from capability | `src/app/(manage)/`, `src/components/manage/`, `src/lib/manage-nav.ts` |

1,061 tests pass. Typecheck, lint, gate, volume and the output audit are green,
and the production build renders all seven management routes as dynamic.

---

## Sprint 1 — the two columns and the two fields

None of it has a screen. All of it is unrecoverable if delayed.

### F1 — the club had no word for lunch

`CHARGE_REFERENCE_TYPES` was `membership · guest_visit · booking · storage ·
adjustment`. §11.2 makes the revenue mix — membership, range, **F&B**, guest
fees — one of two numbers that can falsify the club's whole strategy. Three of
the four had a line. The fourth did not, so anything sold on the deck had to be
rung up as `adjustment`, the catch-all, which is not revenue at all.

The specification says the split "cannot be reconstructed later". It understated
the case: until `fnb` existed the split could not be **constructed**.

### F2 — revenue had two vocabularies, in two tables

`payments.purpose` has carried `bar` and `retail` since M8, which is what made
this easy to miss: the money coming **in** could be labelled while the club
**earning** it could not. Neither list is a superset of the other.

The row that makes reading payments actively wrong rather than merely incomplete
is `account_topup`. A top-up is a **liability** — cash the club has not yet
earned. Counted from payments it inflates the mix on the day it arrives, and is
counted a second time as bar spend when the tab draws it down.

`src/domain/revenue.ts` therefore derives the mix from charges and nothing else,
and a source test asserts the module never references `payments` — because the
defect it guards against is somebody *later* computing revenue from the other
table, which no amount of arithmetic on this module's outputs would notice.

Adjustments are reported as their own visible line rather than folded into a
category. A club whose adjustment line is growing has a miscategorisation
problem it can **see**.

### F4 — the non-shooting visit share would have read zero forever

A member who comes in to eat is not checked in — the desk console is a range gate
— fires no round, and left no trace. The first falsifying number would have
reported zero, honestly, from a record that never had a chance to say otherwise.
S2 exists for exactly this: *a zero invites a decision*, and the decision this
one invites is abandoning the hospitality thesis on evidence produced by not
having instrumented it.

Solved in the money rather than at the door, because checking everybody in adds
work to the desk for a person who came to eat, which S6 forbids and which would
be abandoned within a fortnight. **A categorised F&B charge on a day with no
round fired is the evidence of a visit.** One capture path, two falsifying
numbers.

It is a **floor, not a census** — a member who comes to watch and buys nothing
leaves no trace — and `VisitMix.basis` carries that sentence so no caller can
render the figure without it.

### F3 — the kitchen had no hours

`OpeningPeriod.label` holds "Deck and kitchen only" and the schema documents it
as *never parsed*. Table slots generated with `staffedOnly: false` across every
opening period, gated on one global `tableCapacity`. So a member could book a
table at 09:15 on a day the kitchen opens at noon — the same failure
`table_capacity` exists to prevent, arriving through the time dimension instead
of the capacity one.

`armory.service_hours` is its own table, not a `serving` flag on an opening
period. A kitchen serving 12:00–15:00 inside a 09:00–18:00 range day would have
to be expressed by splitting that day into three opening periods, and **the slot
grid restarts at every period boundary** — so splitting for the kitchen's sake
would silently forbid any shooting session spanning noon.

A sitting must fall **wholly** inside a service window. A member seated at 14:30
for an hour where service ends at 15:00 has been sold half a lunch. Two adjacent
windows do not combine across the gap between them.

**The table ships empty.** The founder was asked on 17 August and kitchen hours
are unsettled, so this is registered as `kitchen-hours` rather than guessed. The
permissive reading — serve whenever the doors are open — is the one that sells a
lunch nobody is cooking.

### §11.4 — the check-in clock

The specification budgeted two fields. It needed one: `checked_in_at` has always
recorded the **completion**, so what was missing is the start. The console
timestamps it in a `useState` initialiser when the sheet opens, because the sheet
opens because somebody is standing there.

Three rules, and the second is the one that keeps instrumentation switched on:

- Null means unmeasured, never zero.
- **A measurement may never refuse the operation it measures.** A member at the
  counter must not be turned away for a figure on a dashboard.
- A start after its own finish is dropped as clock skew, not stored as a
  negative duration — §8 already declines to trust the device clock.

Reported as a distribution and a count over the promise, never as a mean and
**never per officer**. §12 already frames desk speed as a property of the screens
rather than of the training, and a surface that ranked officers by check-in time
would produce officers who check people in badly and quickly.

> A test written to show that a percentile catches a bad tail disproved its own
> framing: with 95 check-ins at 6s and 5 at 120s, the mean (11.7s), the median
> and the ninetieth percentile all read healthy. `overPromise` is the figure that
> surfaces it. The test now asserts that, which is the more useful thing to know.

### The append-only guard had to be told about the new column

`0002`'s `participations_guard` enumerates every column that must stay
byte-identical after a check-in. **An enumerated guard does not extend itself.**
`arrival_at` added and left out of that tuple would have been the one field on an
append-only table anybody could rewrite afterwards — and invisible, because the
table would still refuse every other edit and the guarantee would look intact.

That matters more than the column's own importance suggests: a duration that can
be adjusted after the fact is not a measurement, and the first person to discover
it can be adjusted will be somebody whose figures look bad.

---

## Sprint 2 — the authority model

### The primitive is a grant, not a role

§18 makes the role model the first open decision and hands it to the founder,
because S3 makes it a governance document rather than a configuration file. That
is right about its **standing** and wrong about its **shape**: a system whose
permission unit is a role cannot express a duty manager covering the armoury for
one evening without inventing a role — and the evening always wins, so somebody
gets a permanent grant to solve a temporary problem and nobody takes it back.

`staff_users.role` keeps the job it had — naming the post, and resolving the
founder for `apply-credentials.ts` and `permits.ts`. It no longer decides
anything.

Eleven grants. Every split exists because a forbidden combination needs it;
nothing is split for tidiness.

### Two separations, refused on the resulting hand

```
custody      + ledger                     S3
safety_manage + intelligence_commercial   S4
```

Evaluated against the hand a person would hold **after** the change, never
against the change in isolation. §15 predicts the failure and the prediction is
about time: somebody is made armourer in August; in March a different manager,
looking at a screen showing a person with no ledger access, gives them the
ledger. Each action is individually reasonable and there is no moment at which
anybody could have noticed.

The same evaluation closes the self-grant hole without a special case — a hand is
a hand however it was assembled — and there is no path by which naming a role
avoids the check.

### The founder exception, made expensive rather than invisible

**Read is exempt.** All six surfaces and every panel, regardless of grants,
because S3 separates hands on the record and not eyes on it. A founder refused a
screen asks somebody to read it to them, which produces the information without
producing the record that it was looked at.

**Write is not.** The bundle drops one side of each separation, so the standing
hand is clean. Crossing means issuing yourself an acting grant with a reason that
lapses by clock — attributed, time-boxed, and visible in the register.

> Writing the bundle as "everything but the ledger" was wrong, and the test said
> so: it still crossed S4. It now drops `custody` and `safety_manage`, and both
> choices go the same way — the founder keeps what the business cannot run
> without and gives up what a specialist should hold anyway. Dropping
> `safety_manage` is **S4 read forwards**: the founder is the one person
> definitely measured on commercial outcomes, so the one person who should not
> hold the safety veto.
>
> That immediately exposed a second problem. §9.2 requires near-misses to be
> visible to the safety holder **and the founder**, so a panel composition
> consulting grants alone would have enforced S4 by hiding from the founder the
> exact reports §9 says they must see. Seeing an open safety item and closing one
> are different acts, and `panelsFor` exempts the first.

### Acting grants lapse by clock, not by session

§15 already requires capability to be re-evaluated per request. An acting grant
makes that sharper rather than adding a requirement: *"expires at 06:00"* must
not mean *"expires whenever they next sign in"*, which for a tablet nobody signs
out of means never.

### The separation is deliberately not enforced in the database

§12 asks for database-level enforcement wherever it is possible. This is the case
where it is not possible honestly: S3 forbids a **set**, and a row constraint
cannot see a set. A trigger counting sibling rows could, and would be
`refuseCombination` written a second time in PL/pgSQL — the duplication the
README's `firearms.status` warning exists to discourage.

So the rule lives once, in the domain, and `src/server/armory/grants.ts` is the
only writer. The check and the write share a transaction, because two managers
granting at the same moment would otherwise each read a clean hand, each decide
correctly, and together assemble the pair S3 forbids. That is §8.3's "two
devices, one allowance" wearing a different hat.

What the database **does** guarantee is that the record cannot be rewritten. A
grant is revoked, never deleted — a deleted row is a separation that was crossed
and then tidied away, and the tidying is the part an auditor would most want to
see. Eight new assertions in `scripts/enforcement.test.sql`, including the
`TRUNCATE` bypass.

---

## Sprint 3 — the route group

Seven routes. Guarded in the layout, generated from capability, never cached,
never indexed, and deliberately **not installable** — a personal-device surface
used online, sitting down, and a third service-worker scope on a codebase that
has already had to resolve two buys nothing.

### It authenticates the person, not the tablet

The existing staff session is **device-bound** by design: a device token proving
which tablet, plus a PIN proving which officer, because §10 requires the shared
console to attribute every action to a named person without a keyboard.

Management is the opposite posture. Requiring a registered device would mean the
founder cannot open the ledger from their own phone, which is the single most
likely way this surface is ever used. So it authenticates the way the portal does
and resolves staff standing from the person behind the account — §3.1's rule
applied once more. A member of staff is a person who also holds a post, so the
club has one identity for them and one place to revoke it.

`manage-shared-device` is registered: a member session is long because it is
built for a member's own phone, which is fine for personal devices and **not**
fine for a shared counter tablet. §4.1's console hand-off is the answer and is
not built.

### The guard is in the layout and is not the protection

`requireStaffPrincipal()` runs once, so every route beneath it is authenticated by
construction. Every screen still asserts its own grant before reading: the layout
says *you are staff*; only the grant says *you may see the ledger*. A separation
the navigation implies and the route allows is not a separation, so
`/manage/safety` typed into an address bar by finance returns `notFound` — the
club does not confirm the shape of surfaces somebody may not see.

### Built with real data where it exists

| Surface | State |
| --- | --- |
| **The expiry register** | Full. §9.3's "cheapest serious risk reduction", one query and one screen. Lapsed items listed first and separately. |
| **The applications queue** | Age, stage, route — and an owner column reading "Nobody" for every row. |
| **The roster** | Every member, by member number. |
| **The person record** | Standing and paperwork. |
| **The gate register** | The only panel with real content on day one, which makes it the most valuable one in month one. |

The owner column is rendered **because** the club cannot fill it. Hiding it would
make the screen look finished and the queue look owned, when *applications land
somewhere nobody owns* is on the blocker register. `applications` holds only
`decided_by_staff_id` — who **closed** an application, which says nothing about
who is carrying it — and reading that as ownership would report a healthy queue
in which every open application is unowned. Registered as `application-owner`.

### What nothing looks like

Everything unbuilt states what it is waiting for rather than rendering blank.

`Pending` is deliberately not reused: it renders nothing in production, which is
right for a marketing page that must never show invented content to a visitor and
wrong for an internal tool, where a panel silently vanishing teaches staff the
software is unreliable.

Empty states are typed into four kinds, and the third is the one a generic empty
state destroys:

| Kind | Reads as |
| --- | --- |
| `not_started` | The club has not started this |
| `clear` | Working as intended |
| `unauthored` | **Somebody has to type this** — and carries the link |
| `not_built` | Coming, and here is what it is waiting on |

M11 records the failure the third guards against: an events table nobody writes
to makes the Diary emptier than no Diary would have been.

### The register, and the density

Management drops the site's access register entirely. Soffit Blue and VIP Teal
encode **what kind of member** somebody is, and borrowing them for a staff
surface would say something untrue about the person reading it. Chalk ground,
Charred Timber chrome, Sight Ink for secondary text.

**Red means "requires a decision" and is never a primary action.** On a screen
the founder opens to find out what needs them, spending the urgent colour on a
Save button leaves nothing to say urgent with.

Density uses the 8px unit at tighter multiples. A 4px value was not introduced
and must not be: once it exists somewhere it exists everywhere, and the scale
that makes the rest of the product feel composed is gone.

---

## What this milestone did not build

| Item | Why | Tracked |
| --- | --- | --- |
| The booking book and programme authoring | §7 requires it to ship with the member Diary as one piece of work, by one person, in one sprint | — |
| Near-miss reporting | §9.2. Next, because culture is set in the first month | — |
| The operating level control | §6.2's degradation ladder as a switch | — |
| Reconciliation | The scheduled sweep is a security-review blocker and ships first | `M10_security_review.md` |
| Member analytics | Blocked on the retention schedule, and should stay blocked | `member-data-retention` |
| The console hand-off session | §4.1, and the reason management is not for shared devices yet | `manage-shared-device` |
| An application owner column | One nullable column; the staffing half is not software | `application-owner` |

---

## Still the founder's

`kitchen-hours` was raised with the founder on 17 August and is **unsettled**.
The column exists, the table is empty, no cover can be booked, and the surface
says which decision is outstanding rather than rendering an empty grid.

The role model in `ROLE_BUNDLES` is a **draft to ratify**, not a configuration.
§18 is right that it belongs with the Governance and Authority Charter — but it
should not be authored from a blank page, and a founder handed one produces a
role model late while everything is blocked on it.

**Phase 0 has not moved.** The Postgres instance is a free tier expiring 14
September 2026 and Render deletes free databases at expiry. Every figure in
Sprint 1 accrues into that instance, and a trend cannot be backfilled from memory
the way a roster can.
