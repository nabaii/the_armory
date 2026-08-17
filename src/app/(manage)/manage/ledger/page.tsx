import { notFound } from "next/navigation";
import { admitsSurface } from "@/domain/grants";
import { Panel } from "@/components/manage/Panel";
import { requireStaffPrincipal } from "@/server/armory/manage-session";

/**
 * LEDGER — Management System §10.
 *
 * Constrained by S3: nobody holding armoury custody sees this surface. That is
 * not enforced here — it is enforced in `refuseCombination`, at the moment the
 * grant is issued, which is the whole argument of §5.1. A screen that checked it
 * would be the second implementation, and the second one is always the one that
 * drifts.
 *
 * The reads behind charges and balances have existed since M8. What this surface
 * is waiting on is the reconciliation sweep, which is also a security-review
 * blocker, and a day of categorised charges to put in the takings split.
 */

export default async function Ledger() {
  const principal = await requireStaffPrincipal();
  if (!admitsSurface(principal, "ledger")) notFound();

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-3 p-2 lg:p-3">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold leading-none">Ledger</h1>
        <p className="text-[13px] text-sight-ink">
          What the club is owed, and what it took.
        </p>
      </header>

      <div className="grid gap-2 md:grid-cols-2">
        <Panel
          title="Takings, by category"
          empty={{
            kind: "not_built",
            line:
              "Membership, range, F&B and guest fees. The vocabulary landed this sprint; the split needs charges raised against it before it says anything.",
          }}
        />
        <Panel
          title="Reconciliation"
          empty={{
            kind: "not_built",
            line:
              "Paystack against the ledger, unmatched in both directions. The scheduled sweep is a security-review blocker and ships before this screen.",
          }}
        />
        <Panel
          title="Balances"
          empty={{ kind: "not_built", line: "Outstanding by member, with age. M8 holds the data." }}
        />
        <Panel
          title="Failed payments"
          empty={{
            kind: "not_built",
            line: "With the remedy, and whether the member has been told. Feeds their action stack privately.",
          }}
        />
      </div>
    </div>
  );
}
