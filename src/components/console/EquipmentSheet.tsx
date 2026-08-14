"use client";

import { useState } from "react";
import type { LocalAmmunitionIssue, LocalIssue } from "@/offline/close";

/**
 * ISSUE EQUIPMENT — §6.4.
 *
 *   "Issue equipment — Firearm BY SERIAL and ammunition BY QUANTITY, written as
 *    custody and ammunition rows against the participation. Works offline."
 *
 * ===========================================================================
 * BY SERIAL, TYPED, NOT PICKED FROM A LIST
 *
 * The register holds every firearm the club owns. A picker would be a scroll
 * through dozens of near-identical rows while an officer holds the actual thing,
 * with its serial stamped on the frame, in their other hand.
 *
 * So the serial is typed and matched. A wrong serial is refused with a sentence
 * naming what was not found, which is the failure an officer can act on — and
 * §12's "Guest shoots a member-owned firearm → blocked at pairing" depends on
 * matching the SPECIFIC firearm rather than a plausible one, which
 * src/domain/capability/index.ts calls out: the commonest cause of that block is
 * two similar serials on one bench.
 *
 * ===========================================================================
 * ROUNDS ARE COUNTED OUT, AND COUNTED BACK IN AT CLOSE
 *
 * §3.4: "Reconciled per participation, not per day. qty_issued must equal
 * qty_fired plus qty_returned at reconciliation." This screen does the issuing;
 * the count back is on the close screen, because that is when the shooter hands
 * back what they did not fire.
 */

export function EquipmentSheet({
  name,
  lots,
  issued,
  ammunition,
  onIssueFirearm,
  onReturnFirearm,
  onIssueAmmunition,
  onClose,
}: {
  name: string;
  lots: readonly { id: string; calibre: string; quantityRemaining: number }[];
  /** Firearms already out to this shooter. */
  issued: readonly LocalIssue[];
  ammunition: readonly LocalAmmunitionIssue[];
  onIssueFirearm: (serialNumber: string) => Promise<string | null>;
  onReturnFirearm: (issue: LocalIssue) => void;
  onIssueAmmunition: (input: { lotId: string; qty: number }) => Promise<string | null>;
  onClose: () => void;
}) {
  const [serial, setSerial] = useState("");
  const [lotId, setLotId] = useState(lots[0]?.id ?? "");
  const [qty, setQty] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const out = issued.filter((row) => row.returnedAt === null);

  async function run(action: () => Promise<string | null>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setError(await action());
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label={`Issue equipment to ${name}`}
      className="fixed inset-0 z-20 overflow-y-auto bg-[--color-bone] p-4"
    >
      <header className="flex items-start gap-3 border-b border-[--color-terrazzo] pb-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-medium">{name}</h2>
          <p className="text-sm text-[--color-sight-ink]">Issue equipment</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded border border-[--color-reticle-black] px-3 py-2 text-sm font-medium"
        >
          Done
        </button>
      </header>

      {error && (
        <p
          role="alert"
          className="mt-3 border-l-8 border-[--color-ten-ring-deep] py-2 pl-3 font-medium"
        >
          {error}
        </p>
      )}

      {/* ---------------------------------------------------------- FIREARMS */}

      <h3 className="mt-6 text-sm font-medium tracking-wide uppercase">
        Firearms out
      </h3>

      {out.length === 0 ? (
        <p className="mt-1 text-sm text-[--color-sight-ink]">Nothing issued.</p>
      ) : (
        <ul className="mt-2 divide-y divide-[--color-terrazzo]">
          {out.map((row) => (
            <li key={row.custodyEventId} className="flex items-center gap-3 py-2">
              <span className="flex-1 font-mono">{row.serialNumber}</span>
              <button
                type="button"
                onClick={() => onReturnFirearm(row)}
                className="rounded border border-[--color-reticle-black] px-3 py-2 text-sm font-medium"
              >
                Return
              </button>
            </li>
          ))}
        </ul>
      )}

      <label className="mt-3 block space-y-1">
        <span className="text-sm font-medium">Issue by serial</span>
        <div className="flex gap-2">
          <input
            value={serial}
            onChange={(event) => setSerial(event.target.value)}
            /* No autocorrect or capitalisation. A serial is not a word, and a
               phone keyboard "helpfully" capitalising one is a refused issue and
               a confused officer. */
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="flex-1 border border-[--color-reticle-black] px-3 py-2 font-mono"
            placeholder="AB1234"
          />
          <button
            type="button"
            disabled={busy || serial.trim().length === 0}
            onClick={() =>
              void run(async () => {
                const problem = await onIssueFirearm(serial.trim());
                if (!problem) setSerial("");
                return problem;
              })
            }
            className="shrink-0 border border-[--color-reticle-black] px-4 py-2 font-medium disabled:border-[--color-sight-grey] disabled:text-[--color-sight-grey]"
          >
            Issue
          </button>
        </div>
      </label>

      {/* -------------------------------------------------------- AMMUNITION */}

      <h3 className="mt-8 text-sm font-medium tracking-wide uppercase">
        Ammunition
      </h3>

      {ammunition.length > 0 && (
        <ul className="mt-2 divide-y divide-[--color-terrazzo]">
          {ammunition.map((row) => (
            <li key={row.issueId} className="flex items-center gap-3 py-2">
              <span className="flex-1">{row.qtyIssued} rounds</span>
              <span className="text-sm text-[--color-sight-ink]">
                {/* §3.4's reconciliation happens at close. Until then the
                    officer needs to see that it is outstanding. */}
                {row.qtyFired === null ? "to reconcile" : "counted"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {lots.length === 0 ? (
        <p className="mt-1 text-sm text-[--color-sight-ink]">
          This device has no ammunition lots on file. Sync while there is a
          connection.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <label className="block space-y-1">
            <span className="text-sm font-medium">Lot</span>
            <select
              value={lotId}
              onChange={(event) => setLotId(event.target.value)}
              className="w-full border border-[--color-reticle-black] px-3 py-2"
            >
              {lots.map((lot) => (
                <option key={lot.id} value={lot.id}>
                  {lot.calibre} — {lot.quantityRemaining} remaining
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-medium">Rounds</span>
            <div className="flex gap-2">
              <input
                value={qty}
                onChange={(event) => setQty(event.target.value)}
                inputMode="numeric"
                pattern="[0-9]*"
                className="flex-1 border border-[--color-reticle-black] px-3 py-2 text-lg"
                placeholder="40"
              />
              <button
                type="button"
                disabled={busy || qty.trim().length === 0}
                onClick={() =>
                  void run(async () => {
                    const problem = await onIssueAmmunition({
                      lotId,
                      qty: Number(qty),
                    });
                    if (!problem) setQty("");
                    return problem;
                  })
                }
                className="shrink-0 border border-[--color-reticle-black] px-4 py-2 font-medium disabled:border-[--color-sight-grey] disabled:text-[--color-sight-grey]"
              >
                Issue
              </button>
            </div>
          </label>
        </div>
      )}
    </section>
  );
}
