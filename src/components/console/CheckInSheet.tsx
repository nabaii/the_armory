"use client";

import { useState } from "react";
import type { LaneOption } from "@/offline/lanes";

/**
 * ASSIGNING A LANE AT CHECK-IN — §6.4.
 *
 *   "Check in — THREE TAPS MAXIMUM from Today to checked in with a lane
 *    assigned. Calls the capability service; a block states its reason in one
 *    line."
 *
 * ===========================================================================
 * THE TAP BUDGET, COUNTED
 *
 *   1. "Check in" on the Today row — opens this sheet with a lane preselected.
 *   2. "Check in on <lane>" — done.
 *
 * Two, and the third is spent only when the officer wants a different bay. That
 * is the whole reason the suggestion is preselected rather than the list opening
 * with nothing chosen: an unselected list would make three taps the FLOOR rather
 * than the ceiling, and §1.2 gives the whole interaction fifteen seconds.
 *
 * ===========================================================================
 * WHY THE OFFICER IS ASKED AT ALL
 *
 * The system could assign silently and save a tap. src/offline/lanes.ts argues
 * against it: the officer knows things this device does not — that bay four has
 * a left-handed shooter on it, that a nervous first-timer should not stand next
 * to the loudest calibre on the range. A silent assignment gets overruled by an
 * officer physically moving somebody and not telling the tablet, and then the
 * record is wrong about where a person stood on a live range.
 *
 * So the default is offered, not imposed, and changing it costs one tap.
 */

export function CheckInSheet({
  name,
  lanes,
  suggested,
  noLaneReason,
  overridable,
  blockedLine,
  onConfirm,
  onCancel,
}: {
  name: string;
  lanes: readonly LaneOption[];
  suggested: LaneOption | null;
  /** One line, when there is no lane to give. §4.3's shape. */
  noLaneReason: string | null;
  /** §4.3: whether this row's block may be let through with a reason. */
  overridable: boolean;
  /** The block itself, if the row was not clear. */
  blockedLine: string | null;
  onConfirm: (input: {
    laneId: string;
    override: { reason: string } | null;
    /**
     * When this sheet opened — Management §11.4, the club's fifteen seconds.
     *
     * The officer opening the sheet is the closest thing the console has to
     * the moment somebody presented at the desk, and it is close enough: the
     * sheet opens because a person is standing there.
     */
    arrivalAt: Date;
  }) => void;
  onCancel: () => void;
}) {
  const [laneId, setLaneId] = useState(suggested?.id ?? "");
  const [reason, setReason] = useState("");

  /**
   * THE CLOCK STARTS HERE, AND IT IS ONE `useState` INITIALISER.
   *
   *   §11.4: "The club's central operating promise is currently unmeasured…
   *    Nothing measures it. The console can timestamp arrival and completion at
   *    almost no cost."
   *
   * A lazy initialiser rather than a `useEffect`, so it is the first render of
   * this sheet that is timed rather than the commit after it — and so React's
   * development double-invocation cannot move it. Nothing downstream may fail
   * because of it: a check-in completes whether or not this number survives.
   */
  const [openedAt] = useState(() => new Date());

  const chosen = lanes.find((lane) => lane.id === laneId) ?? null;
  const needsReason = overridable && blockedLine !== null;
  const reasonReady = !needsReason || reason.trim().length >= 12;

  return (
    <section
      aria-label={`Check in ${name}`}
      className="fixed inset-0 z-20 flex flex-col overflow-y-auto bg-[--color-bone] p-4"
    >
      <header className="flex items-start gap-3 border-b border-[--color-terrazzo] pb-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-medium">{name}</h2>
          <p className="text-sm text-[--color-sight-ink]">Choose a lane</p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 rounded border border-[--color-reticle-black] px-3 py-2 text-sm font-medium"
        >
          Cancel
        </button>
      </header>

      {/* The block, if there is one. §4.3: one line, never a stack. An officer
          who is about to override needs to see exactly what they are waiving. */}
      {blockedLine && (
        <p className="mt-3 border-l-8 border-[--color-ten-ring-deep] py-2 pl-3 font-medium">
          {blockedLine}
        </p>
      )}

      {noLaneReason ? (
        <p className="mt-4 border-l-4 border-[--color-deck-oak] py-2 pl-3 font-medium">
          {noLaneReason}
        </p>
      ) : (
        <ul className="mt-4 space-y-1">
          {lanes.map((lane) => (
            <li key={lane.id}>
              <label
                className={`flex items-center gap-3 border p-3 ${
                  lane.assignable
                    ? "border-[--color-terrazzo]"
                    : "border-[--color-terrazzo] opacity-50"
                }`}
              >
                <input
                  type="radio"
                  name="lane"
                  value={lane.id}
                  checked={laneId === lane.id}
                  onChange={() => setLaneId(lane.id)}
                  disabled={!lane.assignable}
                  className="size-5 shrink-0"
                />
                <span className="flex-1 font-medium">{lane.label}</span>
                <span className="text-sm text-[--color-sight-ink]">
                  {/* A bay that is down says so rather than vanishing — an
                      officer looking for lane two is owed the reason. */}
                  {lane.unavailableReason ??
                    (lane.capacity > 1
                      ? `${lane.free} of ${lane.capacity} free`
                      : "Free")}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {needsReason && (
        <label className="mt-4 block space-y-1">
          <span className="text-sm font-medium">
            Reason for letting this through
          </span>
          {/* §3.6: "An override is permitted but never silent." The twelve
              characters are the same bar applied everywhere else in the system,
              for the reason the capability service gives: "a mandatory field
              that accepts 'ok' is not mandatory." */}
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            className="w-full border border-[--color-reticle-black] p-2 text-sm"
            placeholder="Something a founder can read tomorrow morning and understand without asking anyone."
          />
        </label>
      )}

      <button
        type="button"
        disabled={!chosen?.assignable || !reasonReady}
        onClick={() =>
          chosen &&
          onConfirm({
            laneId: chosen.id,
            override: needsReason ? { reason: reason.trim() } : null,
            arrivalAt: openedAt,
          })
        }
        className="mt-6 w-full border border-[--color-reticle-black] px-4 py-3 font-medium disabled:border-[--color-sight-grey] disabled:text-[--color-sight-grey]"
      >
        {chosen ? `Check in on ${chosen.label}` : "Choose a lane"}
      </button>
    </section>
  );
}
