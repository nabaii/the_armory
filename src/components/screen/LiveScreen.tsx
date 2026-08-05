import { cn } from "@/lib/cn";
import type { TournamentState } from "@/server/tournament/engine";

/* ============================================================================
   THE LIVE SCREEN — display half.

   §5 sets six display requirements and a legibility constraint. The sizes below
   are derived from the constraint rather than chosen:

   "Readable at 5–10 metres. Test from the rail and the bar seating, not from a
    desk."

   The usual legibility rule for comfortable reading is a cap height of roughly
   viewing-distance / 200. At 10 m that is 5 cm. On a 55-inch television —
   about 122 cm wide at 1920 px — 1 cm is ~15.7 px, so 5 cm is ~79 px of cap
   height, which is a font-size near 110 px for a grotesque.

   Everything is therefore in viewport units so it holds at any screen size:
   team totals at 16vw are ~307 px on that television, comfortably past the
   threshold, and player names at 3.2vw are ~61 px.

   ⚠ The rule gives a floor, not a verdict. §5 says to test from the rail and
   the bar seating with the actual screen, and that has not happened — it is
   part of the `live-screen-scope` gate item.

   COLOUR. Charred Timber ground with Chalk type: 14.05:1, and a dark ground is
   right for a lit venue. Ten Ring Red appears on exactly two things — the
   leading team and the last shot — because §5 repeats the brand rule: "red is a
   point, never a plane."
   ========================================================================= */

export function LiveScreen({ state }: { state: TournamentState }) {
  if (state.phase === "complete") return <ResultState state={state} />;

  const leader = leadingTeam(state);

  return (
    <div className="flex min-h-dvh flex-col justify-between p-[2vw] text-chalk">
      {/* ---------------------------------------------------- ROUND PROGRESS */}
      <header className="flex items-baseline justify-between">
        <p className="u-kicker text-[1.4vw] text-terrazzo">
          {state.phase === "practice"
            ? "Practice — not scored"
            : `Round ${state.currentRound}`}
        </p>
        <p className="u-kicker text-[1.4vw] text-terrazzo">
          {/* §5: "Shots remaining — per round and overall." */}
          {state.shotsRemainingInRound} shots left this round
        </p>
      </header>

      {/* ------------------------------------------ TEAM NAMES AND TOTALS
          §5: "Largest elements on screen. Tabular numerals, legible across the
          room at the rail." */}
      <div
        className={cn(
          "grid flex-1 items-center gap-[3vw]",
          state.standings.length > 2 ? "grid-cols-3" : "grid-cols-2",
        )}
      >
        {state.standings.map((team) => {
          const leading = team.teamId === leader?.teamId;
          return (
            <div key={team.teamId} className="text-center">
              <p
                className={cn(
                  "font-display font-bold uppercase tracking-[0.06em]",
                  "text-[3.2vw] leading-none",
                  leading ? "text-ten-ring-red" : "text-terrazzo",
                )}
              >
                {team.name}
              </p>
              <p
                className={cn(
                  "font-display font-bold leading-[0.85] tabular-nums",
                  "text-[16vw]",
                  leading ? "text-ten-ring-red" : "text-chalk",
                )}
              >
                {team.total}
              </p>
              <p className="font-display text-[1.8vw] leading-none text-terrazzo tabular-nums">
                {team.roundsWon} {team.roundsWon === 1 ? "round" : "rounds"}
              </p>
            </div>
          );
        })}
      </div>

      {/* ------------------------------------------------------- WHOSE TURN
          §5: "Unmistakable — the current player highlighted. The screen should
          answer 'who is up' at a glance." It gets the whole bottom band. */}
      <footer className="flex items-end justify-between gap-[2vw]">
        <div>
          <p className="u-kicker text-[1.4vw] text-terrazzo">Now shooting</p>
          <p className="font-display text-[5vw] font-bold leading-none text-chalk">
            {state.currentPlayer?.displayName ?? "—"}
          </p>
        </div>

        {/* §5: "Last shot value — briefly emphasised after each shot." The
            moment of reaction, and the only other thing allowed to be red. */}
        {state.lastTurn?.score != null && (
          <div className="text-right">
            <p className="u-kicker text-[1.4vw] text-terrazzo">
              {state.lastTurn.displayName}
            </p>
            <p className="font-display text-[7vw] font-bold leading-none text-ten-ring-red tabular-nums">
              {state.lastTurn.score}
            </p>
          </div>
        )}
      </footer>
    </div>
  );
}

/**
 * §5: "Clear winner declaration at the end, held on screen while photographs
 * are taken."
 *
 * Held indefinitely — nothing dismisses it on a timer. The group will
 * photograph this, and a screen that resets itself after ten seconds is a
 * screen that ruins the photograph.
 */
function ResultState({ state }: { state: TournamentState }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-[2vw] p-[2vw] text-center text-chalk">
      <p className="u-kicker text-[1.6vw] text-terrazzo">
        {state.isDraw ? "Result" : "Winner"}
      </p>

      <p className="font-display text-[9vw] font-bold leading-[0.9] text-ten-ring-red">
        {state.isDraw ? "Drawn" : (state.winner?.name ?? "—")}
      </p>

      <div className="flex items-baseline gap-[4vw]">
        {state.standings.map((team) => (
          <div key={team.teamId}>
            <p className="font-display text-[2vw] uppercase tracking-[0.06em] text-terrazzo">
              {team.name}
            </p>
            <p className="font-display text-[7vw] font-bold leading-none tabular-nums">
              {team.total}
            </p>
            <p className="font-display text-[1.6vw] text-terrazzo tabular-nums">
              {team.roundsWon} {team.roundsWon === 1 ? "round" : "rounds"}
            </p>
          </div>
        ))}
      </div>

      <p className="u-kicker mt-[2vw] text-[1.2vw] text-terrazzo">
        The winning target is yours to frame
      </p>
    </div>
  );
}

/** Leader by rounds won, then gross — the same rule that decides the result. */
function leadingTeam(state: TournamentState) {
  const ranked = [...state.standings].sort(
    (a, b) => b.roundsWon - a.roundsWon || b.total - a.total,
  );
  const [first, second] = ranked;
  if (!first) return null;
  /* Nobody leads a dead heat. Highlighting both would make red a plane. */
  if (second && first.roundsWon === second.roundsWon && first.total === second.total) {
    return null;
  }
  return first;
}
