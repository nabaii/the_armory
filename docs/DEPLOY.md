# Deploying to Render

Both products in this repository — the marketing site and the Armory management
system — deploy as **one Next.js service**. There is no second app to stand up.

§0 describes the database shape. Everything else is ordinary Render setup, with
two steps people skip flagged as such (§5 and §6).

---

## 0. The database

**One Postgres, one `DATABASE_URL`, two schemas** — `public` for the leagues
product, `armory` for the management system. They share a database rather than
having one each because `public.members.person_id` is a **FOREIGN KEY** into
`armory.people` (drizzle/0005), and that constraint cannot span two databases.

**One pool, two schema-scoped clients** — `src/db/pool.ts`. Both halves speak
plain Postgres over `pg`, so **any Postgres works**: Render Postgres, Neon,
Supabase, RDS, self-hosted.

> **This changed.** The leagues half previously used `drizzle-orm/neon-http`,
> which speaks only to Neon — so the driver chosen to keep the hosting decision
> open was the one component that fixed the vendor. It also bought an
> edge-compatible runtime that nothing in this repository uses. Both halves now
> share one pool, which additionally halves the connection count against a
> managed Postgres and gives the leagues half real transactions.
>
> **The constraint that replaces it:** this now needs a Node runtime with
> sockets. If it ever moves to an edge platform, `src/db/pool.ts` is what has to
> change — and §8.3's allowance transaction cannot be expressed over HTTP at
> all, so that would be a redesign rather than a swap.

Nothing else in this document depends on which provider you pick. Choose the
region by measuring latency from Abuja (§2), not from vendor documentation.

---

## 0a. Creating and linking a Render Postgres

### Create it

Render dashboard → **New → Postgres**.

| Setting | What to pick |
| --- | --- |
| Name | e.g. `armory-db` |
| Region | **The same region as the web service.** Different regions means the internal URL does not work and every query crosses the public internet. |
| PostgreSQL version | 16 or later |
| Plan | Not Free for anything you care about — see the warning below |

> ⚠️ **The Free plan database is deleted after 30 days** and cannot be restored.
> The append-only tables in this system are the club's firearm custody log; §10
> requires an off-site backup with a *tested restore*, and a free instance
> satisfies neither. Use Free to try a deploy, never to hold a real club.

### Two URLs, and they are not interchangeable

Render gives each database two connection strings. Which one you use depends on
who is connecting.

| URL | Use it for | Why |
| --- | --- | --- |
| **Internal Database URL** | The **web service** and the **cron job** | Stays on Render's private network. Faster, no egress cost, and the database is never addressed from the public internet. |
| **External Database URL** | **Migrations from your laptop**, `db:prove`, psql | The only one reachable from outside Render. |

So `DATABASE_URL` on the web service is the **Internal** URL. The commands in
§4 and §5, run from your machine, use the **External** one.

### Link it to the web service

Render dashboard → your web service → **Environment** → **Add Environment
Variable**:

- Key: `DATABASE_URL`
- Value: paste the **Internal Database URL**

If both services are in the same Render account and region, you can instead use
**Add from Database** and Render will keep the value in step with the database —
preferable, because a rotated credential updates itself.

Do the same for the cron job service in §6.

### TLS — the one thing that may go wrong on the first connect

This codebase demands a verified certificate in production (§10, "TLS in
transit"). Render's Postgres certificate may not be in Node's built-in CA
bundle, in which case the first connection fails with one of:

```
SELF_SIGNED_CERT_IN_CHAIN
UNABLE_TO_VERIFY_LEAF_SIGNATURE
```

**The fix is to supply Render's CA, not to stop checking.** Download the CA
certificate from the database's page in the Render dashboard, then add:

- Key: `DATABASE_CA_CERT`
- Value: the certificate, PEM, `-----BEGIN CERTIFICATE-----` and all
  (a single line with literal `\n` is fine — `src/db/pool.ts` handles both)

🚫 **Do not set `rejectUnauthorized: false`.** It is the first search result for
that error and it does not fix a certificate problem — it deletes the check that
noticed one. The link carries every member's home address, date of birth and
firearm licence. There is deliberately no environment variable in this codebase
that turns verification off.

### Connection budget

`src/db/pool.ts` opens **one pool, max 10**, shared by both schemas. Render's
smaller plans cap connections in the low tens, so leave headroom for the
migration run and any psql session. If you scale the web service to more than
one instance, each instance gets its own pool of 10 — which is also the point at
which §10's per-instance rate limiting stops being adequate (see §10 below).

---

## 1. Push

Three commits are ahead of `origin/main`:

```bash
git push
```

Render redeploys `main` on push. Everything below assumes that has happened.

---

## 2. Render service settings

A **Web Service**, from this repository, branch `main`.

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build command | `npm ci && npm run build` |
| Start command | `npm run start` |
| Node version | Read from `.node-version` (**24.11.0**) — do not override |
| Health check path | `/` |

The build does **not** need `DATABASE_URL`. Both clients are lazily constructed
precisely so a build never opens a connection, and `/console` is `force-static`
with every data route `force-dynamic`. A build that fails for want of a database
is a bug, not a configuration problem.

---

## 3. Environment variables

Set these in the Render dashboard. Nothing here belongs in the repository.

### Required for the management system

| Variable | Without it |
| --- | --- |
| `DATABASE_URL` | Nothing works. Both schemas, one URL. See §0. On Render, this is the **Internal** URL — see §0a. |
| `DATABASE_CA_CERT` | Only needed if the first connection fails certificate verification. See §0a. Not a secret, but it belongs in the dashboard with the rest. |
| `NEXT_PUBLIC_ORIGIN` | Payment callbacks fall back to a relative path and Paystack cannot redirect a member back. Set it to the real origin, e.g. `https://thearmory.ng`. |

### Required to take money (§9)

| Variable | Without it |
| --- | --- |
| `PAYSTACK_SECRET_KEY` | `startPayment` refuses; no top-ups, no subscriptions. |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | Client-side Paystack surfaces degrade. |

### Required for the reconciliation sweep (§9)

| Variable | Without it |
| --- | --- |
| `CRON_SECRET` | The scheduler path is **closed** — deliberately, not open. A founder can still run the sweep by hand from a staff session. See §6. |

### Required for email (the marketing site's flows)

| Variable | Without it |
| --- | --- |
| `POSTMARK_SERVER_TOKEN`, `MAIL_FROM` | No sign-in links, no booking confirmations. |
| `MAIL_FALLBACK_TO` | Staff alerts have nowhere to go; the intake layer refuses submissions rather than dropping them. |

### Optional

`CRM_PROVIDER`, `CRM_TOKEN`, `TURNSTILE_SECRET_KEY`,
`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `GOOGLE_CALENDAR_ID`,
`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`.

Each degrades a first-visit-booking feature and none affects the management
system. `src/lib/content-gate.ts` reports what is missing.

---

## 4. Migrations — run them, and not from the build

```bash
DATABASE_URL='<production url>' npm run db:migrate
```

**Run this before the new code serves traffic.** Migration `0002` installs the
append-only triggers and the derived-column guards that §12 requires; code
deployed ahead of them would write to a database that does not yet refuse what
it must refuse.

**Do not put migrations in the build command.** Builds run on machines that may
not reach the database, and two concurrent builds would race the same migration.
Use one of:

- Render's **Pre-Deploy Command** (paid instance types), set to
  `npm run db:migrate`; or
- a **manual run** from your machine against the production URL, immediately
  before pushing.

Migrations through `0007` should apply. `db:migrate` reporting *nothing pending*
afterwards is the check.

---

## 5. Prove the database is what you think it is

```bash
DATABASE_URL='<production url>' npm run db:prove
```

29 assertions in one rolled-back transaction: append-only tables refusing UPDATE,
DELETE and TRUNCATE; `firearms.status`, `ammunition_lots.quantity_remaining` and
`accounts.balance_kobo` refusing a direct write; one payment row per
`gateway_reference`.

**This is the step that catches a deploy where the tables arrived and the
triggers did not.** A database in that state passes every casual inspection and
silently discards the club's central guarantee. Record the pass count.

---

## 6. The reconciliation cron job (§9)

A **separate Render service**, type **Cron Job**:

| Setting | Value |
| --- | --- |
| Schedule | `*/15 * * * *` |
| Command | `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" "$APP_ORIGIN/api/payments/reconcile"` |
| Environment | `CRON_SECRET` (same value as the web service), `APP_ORIGIN` |

This is not optional if you are taking money. `/api/armory/paystack/webhook`
answers 200 even when its own write fails — a non-2xx makes Paystack retry and
eventually **disable the webhook**, and losing the endpoint is worse than losing
one event *because this sweep recovers it*. Without the schedule, a lost webhook
is found by a human or not at all.

The endpoint is safe at any frequency and safe to run twice at once: recovery is
guarded on `status = 'pending'`.

---

## 7. Paystack

One webhook URL per Paystack account. Point it at **one** of:

- `/api/armory/paystack/webhook` — the club: subscriptions, guest overage,
  top-ups.
- `/api/paystack/webhook` — first-visit booking deposits.

Both verify the signature on the raw body and both ignore events whose metadata
they do not recognise, so the one you do not choose simply never fires.

**Decide before you take a live payment.**

---

## 8. Seed data — staging only

```bash
DATABASE_URL='<staging url>' npm run db:seed
```

⚠️ **Never against production.** It writes a hundred invented people and — since
the member password login — a **known password** for twenty of them. It is the
only credential in this repository written from a literal, and it is safe only
because those people do not exist.

The script is idempotent and cannot clean up after itself: the append-only
triggers mean seeded custody events, waivers and rounds can never be deleted.
Seeding production is not a mistake you can undo.

---

## 9. After the first deploy

1. `/` renders — the marketing site needs no database.
2. `/sign-in` sends a link (needs Postmark).
3. `/sign-in/member` signs in a seeded member on **staging** (phone + password).
4. `/console` on a tablet: enrol with a device code, sync once online, then
   **reopen with the network off** and confirm it runs from its own day pack.
5. `/api/dashboard` as the founder returns a roster count that matches the
   database.
6. Take one small real payment end to end, then redeliver the same webhook from
   the Paystack dashboard and confirm **one** payment row (§12.1).

---

## 10. What is still not deployable, and why

These are recorded in `docs/M10_security_review.md` as open blockers. None is
closable by deploying.

| # | Blocker | Consequence today |
| --- | --- | --- |
| 1 | **Encryption at rest** not confirmed | §10 requirement unmet. Record the provider setting. |
| 2 | **Restore never rehearsed** (`docs/M10_restore_rehearsal.md`) | §10 phrases this as a prohibition: *a backup never restored is a hope.* |
| 3 | **No object storage** | Licence scans, member photographs and waiver signature images have nowhere to go. Signature images stay on the tablet. |
| 4 | **OTP rate limiting is per-instance** | `src/server/rate-limit.ts` holds counters in module memory. **Run one instance, or put a rate-limit rule at the CDN.** Scaling to two silently doubles every limit. |

Also outstanding and not blocking a deploy: no SMS provider, so §9's OTP does
not exist and the member password login (`drizzle/0007`) is standing in for it.

---

## The short version

```bash
git push                                             # 1

# From your machine, with the EXTERNAL url (the internal one is Render-only):
DATABASE_URL='<external>' npm run db:migrate         # 4  before traffic
DATABASE_URL='<external>' npm run db:prove           # 5  expect 29 passes

# 0a. DATABASE_URL on the web service = the INTERNAL url
# 3.  Set the rest of the env vars in the dashboard
# 6. Add the cron job
# 7. Point the Paystack webhook at one endpoint
```
