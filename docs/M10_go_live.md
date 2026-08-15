# M10 — staff training and seeded go-live

**Build Specification §11 M10, §12, and the closing note.**

> §11 M10: "Security review, load and period-boundary testing, restore rehearsal,
> **staff training, seeded go-live**."
>
> §12: "**A range officer who has not seen the screen before can complete the
> workflow without instruction.**"
>
> Closing: "Fifteen seconds at the desk, twenty at the lane, two minutes on the
> guest link… **staff reverting to paper is how systems like this actually
> fail.**"

Those three lines set the standard this document is measured against, and it is
not "the staff were trained". It is that a range officer who was not at the
training can still work the desk — because on the evening it matters, that is who
is holding the tablet.

---

## Part 1 — The training that is really an acceptance test

§12 asks for something unusual: not that staff can be taught the system, but that
they do not need to be. So the training session is run as a **test of the
software**, and anything an officer cannot do unaided is recorded as a defect in
this system rather than as a gap in their training.

### Who

- Every range officer who will work a shift. Not a representative.
- The founder.
- One person who has **never seen any of it** — a friend of the club, a member,
  anyone. They are the most valuable person in the room and their job is to be
  handed a tablet and left alone.

### The rule for the room

**Nobody explains anything until the officer has failed.** An observer who
answers a question has destroyed the measurement §12 asks for. Write down what
they were trying to do, what they tried, and how long it took.

### The runs

Each officer, unaided, against the seeded staging club (`npm run db:seed`):

| # | Task | §12's budget | Record |
| --- | --- | --- | --- |
| 1 | Enrol a tablet from a registration code | — | \_\_\_ |
| 2 | Sign in as themselves | — | \_\_\_ |
| 2b | A MEMBER signs in at `/sign-in/member` with phone + password | — | did they find it from `/sign-in` unaided? |
| 3 | Check in a member with a clear row | **15 s** | \_\_\_ s |
| 4 | Check in a guest **whose host has not arrived** | — | did they read the reason aloud correctly? |
| 5 | Check in the host, then the guest | — | **did the guest's row clear without a reload?** |
| 6 | Sign a waiver for a member the seed left superseded | — | \_\_\_ |
| 7 | Issue a firearm by serial and forty rounds | — | \_\_\_ |
| 8 | Record two scores at the lane | **20 s** each | \_\_\_ s |
| 9 | Record an incident | — | how many taps to reach it? |
| 10 | Close the session with a firearm still out | — | did they understand the refusal? |
| 11 | Return it, reconcile the ammunition, close | — | \_\_\_ |
| 12 | End of day | — | \_\_\_ |

And once, with a guest who is not staff:

| 13 | Complete the guest link on their own phone, on mobile data | **2 min** | \_\_\_ s |

### What to write down

For each row: **the time**, and **every sentence anybody had to explain**.

The second column is the deliverable. §4.3 requires every block to state its own
reason and its own remedy, and any refusal an officer could not act on without
help is a refusal whose wording is wrong. Those go on the defect list, not on a
training handout.

> If the answer to "how do we make this work" is a laminated card by the desk,
> the screen has failed §12 and the card will be gone in a month.

---

## Part 2 — What staff must be told, because no screen can say it

A short list, and it is short on purpose. These are facts about the *club*, not
about the software.

1. **The queue is normal.** A number next to the sync bar means records are
   waiting, not that something is broken. It clears when the link returns. §8.4
   puts it on screen at all times precisely so it stops being alarming.
2. **Never work around a block.** If the desk refuses something, the reason is on
   screen and the remedy is on screen. If neither is true, that is a defect —
   write it down and tell the founder. Do not find another way in.
3. **An override has your name on it**, and the founder sees it the same day
   (§12). That is not a threat; it is why overriding is allowed at all.
4. **There is no walk-in enrolment, and that is deliberate** (§6.4: "explicitly
   not present"). If somebody is not expected, the answer is a booking, not a
   form.
5. **Do not share a PIN.** §10: "Shared accounts destroy the attribution the
   custody log exists to provide." The custody log is what the club's licence
   rests on.
6. **A tablet that says it has been signed out has been revoked.** Do not try to
   fix it. Call the founder — it may have been revoked because it was reported
   stolen.
7. **Report an incident even when it feels too small.** The button is one tap
   from every lane screen because the cost of not recording one is unbounded.

---

## Part 3 — The seeded go-live

§11's phrase is "seeded go-live", and the sequence matters: the club opens on data
that was put there deliberately, not on an empty database that fills up by
accident.

### Before opening

- [ ] Migrations applied through `0006`; `npm run db:migrate` reports nothing pending.
- [ ] `npm run db:prove` passes on **production** — 29 assertions. This is the one
      check that proves §12's database-level enforcement survived the deploy.
- [ ] `npm run verify` green on the deployed commit.
- [ ] `npm audit` run; anything high or critical triaged and recorded.
- [ ] **`docs/M10_restore_rehearsal.md` executed and signed.** §10 makes this a
      precondition, not a task.
- [ ] `docs/M1_offline_acceptance.md` executed on the **actual tablet model
      purchased**, including the physical power cut. §8.5: devtools offline mode
      is not evidence.
- [ ] `docs/M10_security_review.md` blockers closed, or explicitly accepted in
      writing by the founder with a date.

### The §14 decisions, entered as data

These live in `armory.club_settings` (drizzle/0006) and are **null until set** —
null means "not decided", and every reader handles it. Entering them is a row
update, not a deploy.

- [ ] `guest_overage_price_kobo` — until this is set, **no overage charge is
      raised**. Guests are not refused; the club simply does not bill for them.
- [ ] `roster_cap` — until set, §6.6's roster panel reports "no roster cap set"
      and admission enforces nothing.
- [ ] `waiver_validity_days` — null means a signature against the active version
      never expires. Fails open, deliberately.
- [ ] `guest_retention_days` — **null means no automatic erasure.** Erasure on
      request works today and is the obligation with a deadline; this governs
      only the sweep, and erasing on a period nobody agreed is the one setting
      here whose mistake cannot be undone. §10, blocked on counsel.
- [ ] `storage_enabled` — false. §13 keeps the workflow behind this flag.
- [ ] `disciplines_requiring_qualification` — empty means none demand a sign-off.

### The club's own data

- [ ] Tiers, with real names and real fees (§14). The matrix works without them;
      members reading §6.2's Account screen do not.
- [ ] The active waiver version — **exactly one** (§3.1, enforced by a unique
      index). Its body is what the desk displays before taking a signature.
- [ ] Lanes, per discipline, with position capacity. Availability is computed from
      these; §6.2 forbids a manually maintained calendar.
- [ ] Opening hours and session length (§14) — availability publishes nothing
      until these exist, and the booking screen says so rather than showing a
      plausible week nobody chose.
- [ ] Staff users with individual PINs. One per named person (§10).
- [ ] **Member passwords issued**, if the club is opening before §9's SMS
      provider lands. `POST /api/people/:id/password` mints one per member; it
      is shown once and the member is asked to change it on first sign-in.
      ⚠️ **Do not run `npm run db:seed` against production.** It writes a known
      password for twenty members. It is staging data and always has been.
- [ ] The firearm register, with serials. Every firearm's opening custody event.
- [ ] Ammunition lots, with real received quantities.
- [ ] Founding members, with `is_founding` set.

### The devices

- [ ] Each tablet enrolled with its own code, printed once by the seed and not
      recoverable. Desk tablets registered as `desk`, lane tablets as `lane` —
      the surface decides which screen the tablet shows and cannot be changed
      from the tablet.
- [ ] Each one synced once online, then **opened again with the network off** to
      confirm it runs from its own day pack.
- [ ] A device deliberately revoked **from the dashboard's Tablets panel** and
      confirmed wiped, then restored and re-enrolled with a reissued code.
      Steps 29 and 30 of the offline acceptance protocol.
      Note that restore is not undo: a revoked tablet's credential is destroyed,
      so putting one back to work is restore *then* reissue, and the code is
      shown once.

### Money

- [ ] Paystack live keys configured; the webhook URL pointed at
      `/api/armory/paystack/webhook`. **Only one webhook URL exists per Paystack
      account** — if the club also runs the first-visit booking flow, decide
      which endpoint the account points at before opening.
- [ ] One real payment of a small amount, end to end, confirming the payment row
      lands with `status = succeeded` and the member's balance moves.
- [ ] The same webhook delivered twice from the Paystack dashboard: **one payment
      row** (§12.1).
- [ ] **`CRON_SECRET` set, and a schedule added on the hosting platform** calling
      `POST /api/payments/reconcile`. Every fifteen minutes is ample; the
      endpoint is safe at any frequency and safe to run twice at once.
      An unset secret closes the scheduler path — it does not open it — so a
      founder can still run the sweep by hand from a staff session, and until
      the schedule exists a lost webhook is found by a human or not at all.

### The first week

- [ ] The founder opens the dashboard **every morning**. §12 requires overrides to
      surface the same day, and that requirement is only met if somebody looks.
- [ ] Every refusal an officer could not act on is written down and fixed. That
      list is the real output of the first week.
- [ ] Sync queue depth checked at close each night. §8.4: "silent queues are how
      data is lost."

---

## Sign-off

The club opens when the founder signs the line below, having read the outstanding
items rather than having been told there are none.

| | Name | Date |
| --- | --- | --- |
| Restore rehearsal executed | | |
| Offline acceptance executed on the purchased tablet | | |
| Security review read; blockers closed or accepted | | |
| Staff training run; defect list raised | | |
| **Founder's decision to open** | | |
