"use client";

import type { RelayLane, RelayShooter } from "@/offline/relay";

/**
 * THE RELAY SCREEN — §6.5.
 *
 *   "Relay — Who is on which lane right now. LARGE TYPE, READABLE AT ARM'S
 *    LENGTH IN DAYLIGHT."
 *
 * Renders and nothing else. Every fact on screen was assembled by
 * src/offline/relay.ts from local state, so this file has no condition in it
 * beyond choosing which of three shapes a lane gets.
 *
 * ===========================================================================
 * WHAT "LARGE TYPE" COSTS, AND WHY IT IS SPENT HERE
 *
 * The desk's Today screen (src/components/console/Today.tsx) fits a photograph,
 * a name, a tier, a discipline, a time and a status glyph on one row. None of
 * that fits at this size, and the difference is not taste — it is that an
 * officer reads Today at a counter with the tablet in their hands, and reads
 * this from two metres with ear defenders on and the sun behind them.
 *
 * So the lane number is the largest thing on the screen, because it is what an
 * officer looks up FROM the range and matches against a bay in front of them.
 * The shooter's name is next. The serial is set in a monospace face because the
 * comparison being made is character by character against a stamp on a frame.
 *
 * ===========================================================================
 * A BAY WITH NOTHING TO SAY SAYS NOTHING
 *
 * There is no "OK", no green tick and no "1/1 occupied" on a lane running
 * normally. §6.6's exception list makes the same argument at greater length:
 * a column of reassurance is a column the eye stops reading, and the one bay
 * that needs attention is then the one nobody sees.
 */

export function Relay({
  lanes,
  onPair,
  onScore,
}: {
  lanes: readonly RelayLane[];
  /** §6.5's Pair. Assign this shooter to a firearm by serial. */
  onPair: (shooter: RelayShooter) => void;
  /** §6.5's Score. Select shooter, enter total, confirm. */
  onScore: (shooter: RelayShooter) => void;
}) {
  if (lanes.length === 0) {
    return (
      <p className="p-6 text-xl text-[--color-sight-ink]">
        This device has no lanes on file. Sync while there is a connection.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-[--color-terrazzo]">
      {lanes.map((lane) => (
        <li
          key={lane.laneId}
          className={`flex gap-4 px-4 py-4 ${
            lane.status === "available"
              ? ""
              : /* Shut bays are dimmed rather than hidden — see relay.ts. The
                   heavy leading edge is the same device Today uses, so the two
                   screens agree about what "do not use this" looks like. */
                "border-l-8 border-[--color-ten-ring-deep] opacity-70"
          }`}
        >
          {/* The largest thing on the screen. It is what an officer matches
              against the bay in front of them. */}
          <div className="w-20 shrink-0 text-right">
            <span className="block text-5xl leading-none font-semibold tabular-nums">
              {lane.number}
            </span>
            <span className="mt-1 block text-xs tracking-wide text-[--color-sight-ink] uppercase">
              {lane.discipline}
            </span>
          </div>

          <div className="min-w-0 flex-1">
            {lane.note && (
              <p className="mb-2 text-lg font-medium">{lane.note}</p>
            )}

            {lane.shooters.length === 0 ? (
              !lane.note && (
                <p className="text-xl text-[--color-sight-ink]">Empty</p>
              )
            ) : (
              <ul className="space-y-3">
                {lane.shooters.map((shooter) => (
                  <li
                    key={shooter.participationId}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-2"
                  >
                    <span className="min-w-0 flex-1 text-2xl leading-tight font-medium">
                      {shooter.name}
                      {shooter.isGuest && (
                        <>
                          {" "}
                          <span className="text-base font-normal text-[--color-sight-ink]">
                            guest
                          </span>
                        </>
                      )}
                    </span>

                    {/* Monospace because the comparison is character by
                        character against a serial stamped on a frame. */}
                    <span className="font-mono text-lg text-[--color-sight-ink]">
                      {shooter.firearmSerial ?? "—"}
                    </span>

                    {shooter.cardsRecorded > 0 && (
                      <span className="text-lg tabular-nums text-[--color-sight-ink]">
                        {shooter.cardsRecorded}{" "}
                        {shooter.cardsRecorded === 1 ? "card" : "cards"}
                      </span>
                    )}

                    <span className="flex shrink-0 gap-2">
                      {/* §6.5: "completable in under twenty seconds, standing,
                          one-handed." Both targets are deliberately large. */}
                      <button
                        type="button"
                        onClick={() => onPair(shooter)}
                        className="rounded border border-[--color-reticle-black] px-4 py-3 text-base font-medium"
                      >
                        {shooter.firearmSerial ? "Re-pair" : "Pair"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onScore(shooter)}
                        className="rounded border border-[--color-reticle-black] px-4 py-3 text-base font-medium"
                      >
                        Score
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
