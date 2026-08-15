import { isArmoryDatabaseConfigured } from "@/db/armory/client";
import { env } from "@/server/env";
import { log } from "@/server/log";
import { ok, unavailable } from "@/server/armory/http";
import { requireStaff } from "@/server/armory/http";
import { constantTimeEquals } from "@/server/paystack";
import { reconcilePayments } from "@/server/armory/reconcile";

/**
 * POST /api/payments/reconcile — §9's reconciliation job, given a way to run.
 *
 *   §9, Paystack: "Webhook-driven state, never client-reported success.
 *    Idempotent on gateway_reference. RECONCILIATION JOB FOR WEBHOOKS THAT
 *    NEVER ARRIVE."
 *
 * ===========================================================================
 * TWO CALLERS, TWO CREDENTIALS, AND NEITHER IS OPTIONAL
 *
 * A scheduler has no staff session and never will — it is a cron entry on the
 * hosting platform, holding a secret in an environment variable. A founder has
 * a staff session and no way to obtain a cron secret.
 *
 * So the route accepts either, and refuses without both being absent. The
 * founder path exists because §9's job is also the answer to "a member says
 * they paid and it is not showing" — a question asked at a counter, needing an
 * answer in the next thirty seconds, not at the next scheduled run.
 *
 * ===========================================================================
 * THE SECRET IS COMPARED IN CONSTANT TIME, AND ITS ABSENCE IS A REFUSAL
 *
 * An unset `CRON_SECRET` does NOT mean "allow anybody". It means the scheduler
 * path is closed and only a founder can run this. The other reading is the
 * classic shape of an endpoint that is wide open on the one deployment where
 * somebody forgot to set the variable.
 *
 * ===========================================================================
 * SAFE TO CALL AT ANY FREQUENCY
 *
 * `settlePendingPayment` is guarded on `status = 'pending'`, so two schedulers,
 * a scheduler racing a founder, or a scheduler racing the webhook it is
 * covering for all produce one credit. No lock is needed and none is taken —
 * see the header of src/server/armory/reconcile.ts.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const authorised = await isAuthorised(request);

  if (!authorised) {
    /* Deliberately terse and deliberately 401 rather than 403: a prober should
       learn nothing about which of the two credentials it failed. */
    return new Response("Unauthorised", { status: 401 });
  }

  if (!isArmoryDatabaseConfigured()) {
    return unavailable("The club's system is not configured yet.");
  }

  try {
    const outcome = await reconcilePayments({ now: new Date() });

    /* Logged as well as returned, because the scheduler's caller is a cron job
       that reads nothing. The log is where a founder or an engineer finds out
       that four payments could not be confirmed for a week. */
    log.info("payments reconciled", outcome);

    return ok(outcome);
  } catch (error) {
    log.error("PAYMENT RECONCILIATION FAILED", {
      message: error instanceof Error ? error.message : String(error),
    });

    /* 503 rather than 200: unlike the webhook, this caller is our own
       scheduler, and a retry is exactly what should happen. The reasoning that
       makes the webhook answer 200 on failure — that a non-2xx eventually
       disables it — does not apply to a cron entry. */
    return unavailable("The reconciliation could not be completed just now.");
  }
}

/**
 * A scheduler holding the cron secret, or a founder holding a staff session.
 *
 * The secret is checked first because it is the cheap path and the common one;
 * the staff check costs a query.
 */
async function isAuthorised(request: Request): Promise<boolean> {
  const presented = request.headers.get("authorization");
  const secret = env.cronSecret;

  /* Constant time, and only after the length check inside it. A secret
     compared with `===` leaks its prefix to anybody willing to time enough
     requests, and this one runs a job against the club's money. */
  if (secret && presented && constantTimeEquals(presented, `Bearer ${secret}`)) {
    return true;
  }

  const auth = await requireStaff(request, { atLeast: "founder" });
  return !("response" in auth);
}
