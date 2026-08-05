/**
 * The tournament engine.
 *
 * The tests that matter most are the practice round (a HARD RULE in §4), turn
 * order (the mechanic the whole product rests on), and recovery (§5 requires a
 * mis-entered score to be correctable without restarting).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeState,
  correctTurn,
  turnOrder,
  undoLastTurn,
  validateTurn,
  type TournamentConfig,
  type Turn,
} from "./engine";

/** The Duel: 2 v 2, best of three. */
const duel: TournamentConfig = {
  teams: [
    { id: "A", name: "Team A" },
    { id: "B", name: "Team B" },
  ],
  players: [
    { id: "a1", displayName: "Ada", teamId: "A" },
    { id: "a2", displayName: "Chidi", teamId: "A" },
    { id: "b1", displayName: "Ngozi", teamId: "B" },
    { id: "b2", displayName: "Emeka", teamId: "B" },
  ],
  roundCount: 3,
  shotsPerTurn: 5,
  scoring: "rounds-won",
};

const MAX_PER_TURN = 50;

/** Everyone completes the unscored practice round. */
const practice = (): Turn[] =>
  turnOrder(duel).map((p) => ({ round: 0, playerId: p.id, score: null }));

/** A full scored round, in turn order, with the given scores. */
const round = (n: number, scores: number[]): Turn[] =>
  turnOrder(duel).map((p, i) => ({ round: n, playerId: p.id, score: scores[i] }));

describe("turnOrder", () => {
  it("alternates teams rather than blocking them", () => {
    // Block order means one team sits through four turns with nothing at
    // stake. Alternating keeps the lead changing hands, which is what §2's
    // "the shot that matters" depends on.
    assert.deepEqual(
      turnOrder(duel).map((p) => p.teamId),
      ["A", "B", "A", "B"],
    );
  });

  it("is deterministic", () => {
    assert.deepEqual(
      turnOrder(duel).map((p) => p.id),
      turnOrder(duel).map((p) => p.id),
    );
  });

  it("handles uneven teams without dropping anyone", () => {
    const uneven: TournamentConfig = {
      ...duel,
      players: [
        { id: "a1", displayName: "Ada", teamId: "A" },
        { id: "a2", displayName: "Chidi", teamId: "A" },
        { id: "b1", displayName: "Ngozi", teamId: "B" },
      ],
    };
    assert.deepEqual(
      turnOrder(uneven).map((p) => p.id),
      ["a1", "b1", "a2"],
    );
  });
});

describe("the practice round", () => {
  // §4 HARD RULE: "Never let a first-timer shoot a scored round first. Public
  // failure at the first attempt is the fastest way to lose someone."

  it("starts in practice with the first player up", () => {
    const state = computeState(duel, []);
    assert.equal(state.phase, "practice");
    assert.equal(state.currentRound, 0);
    assert.equal(state.currentPlayer?.displayName, "Ada");
  });

  it("stays in practice until every player has shot", () => {
    const partial = practice().slice(0, 3);
    assert.equal(computeState(duel, partial).phase, "practice");
  });

  it("moves to scored play once everyone has practised", () => {
    const state = computeState(duel, practice());
    assert.equal(state.phase, "playing");
    assert.equal(state.currentRound, 1);
    assert.equal(state.currentPlayer?.displayName, "Ada");
  });

  it("scores nothing during practice", () => {
    const state = computeState(duel, practice());
    assert.deepEqual(
      state.standings.map((s) => s.total),
      [0, 0],
    );
  });

  it("rejects a scored practice turn", () => {
    const result = validateTurn(
      duel,
      [],
      { round: 0, playerId: "a1", score: 45 },
      MAX_PER_TURN,
    );
    assert.equal(result.ok, false);
  });
});

describe("live totals", () => {
  it("accumulates gross totals per team", () => {
    // §1: tournament scoring is "Gross, live".
    const turns = [...practice(), ...round(1, [40, 30, 35, 25])];
    const state = computeState(duel, turns);
    const a = state.standings.find((s) => s.teamId === "A");
    const b = state.standings.find((s) => s.teamId === "B");
    assert.equal(a?.total, 75); // Ada 40 + Chidi 35
    assert.equal(b?.total, 55); // Ngozi 30 + Emeka 25
  });

  it("reports shots remaining in the round and overall", () => {
    // §5: "Shots remaining — per round and overall. Creates the tension of
    // the closing shot."
    const turns = [...practice(), ...round(1, [40, 30, 35, 25]).slice(0, 2)];
    const state = computeState(duel, turns);
    assert.equal(state.shotsRemainingInRound, 10); // 2 players × 5 shots
    assert.equal(state.shotsRemainingOverall, 50); // 10 turns left × 5
  });

  it("reports the last turn for the reaction moment", () => {
    // §5: "Last shot value — briefly emphasised after each shot."
    const turns = [...practice(), ...round(1, [40, 30, 35, 25]).slice(0, 1)];
    const state = computeState(duel, turns);
    assert.equal(state.lastTurn?.displayName, "Ada");
    assert.equal(state.lastTurn?.score, 40);
  });

  it("advances the current player after each turn", () => {
    const order = turnOrder(duel);
    for (let i = 0; i < order.length; i += 1) {
      const turns = [...practice(), ...round(1, [40, 30, 35, 25]).slice(0, i)];
      assert.equal(computeState(duel, turns).currentPlayer?.id, order[i].id);
    }
  });

  it("does not award a round until every player has shot it", () => {
    const turns = [...practice(), ...round(1, [40, 30, 35, 25]).slice(0, 3)];
    const state = computeState(duel, turns);
    assert.deepEqual(
      state.standings.map((s) => s.roundsWon),
      [0, 0],
    );
  });
});

describe("deciding a winner", () => {
  it("awards a round to the higher team total", () => {
    const state = computeState(duel, [...practice(), ...round(1, [40, 20, 40, 20])]);
    const a = state.standings.find((s) => s.teamId === "A");
    assert.equal(a?.roundsWon, 1); // A 80 vs B 40
  });

  it("awards a tied round to nobody", () => {
    // Otherwise a team could "win" more rounds than were played.
    const state = computeState(duel, [...practice(), ...round(1, [30, 30, 30, 30])]);
    assert.deepEqual(
      state.standings.map((s) => s.roundsWon),
      [0, 0],
    );
  });

  it("completes after the configured rounds", () => {
    const turns = [
      ...practice(),
      ...round(1, [40, 20, 40, 20]),
      ...round(2, [40, 20, 40, 20]),
      ...round(3, [40, 20, 40, 20]),
    ];
    const state = computeState(duel, turns);
    assert.equal(state.phase, "complete");
    assert.equal(state.winner?.teamId, "A");
    assert.equal(state.currentPlayer, null);
    assert.equal(state.shotsRemainingOverall, 0);
  });

  it("breaks a rounds-won tie on gross total", () => {
    // The aggregate is the number the screen shows largest, so using it as
    // the tiebreak never looks arbitrary to the room.
    /* Scores are listed in TURN ORDER — Ada(A), Ngozi(B), Chidi(A), Emeka(B) —
       not grouped by team. Getting that wrong is what made this test fail on
       first run, and it is exactly the confusion alternating order is meant to
       create for a watching room. */
    const turns = [
      ...practice(),
      ...round(1, [50, 10, 40, 10]), // A 90, B 20 → A
      ...round(2, [10, 50, 10, 40]), // A 20, B 90 → B
      ...round(3, [30, 30, 30, 30]), // A 60, B 60 → nobody
    ];
    const state = computeState(duel, turns);
    assert.equal(state.phase, "complete");
    assert.deepEqual(
      state.standings.map((s) => s.roundsWon),
      [1, 1],
    );
    assert.equal(state.winner?.teamId ?? "draw", "draw");
  });

  it("reports a genuine draw rather than inventing a winner", () => {
    const turns = [
      ...practice(),
      ...round(1, [30, 30, 30, 30]),
      ...round(2, [30, 30, 30, 30]),
      ...round(3, [30, 30, 30, 30]),
    ];
    const state = computeState(duel, turns);
    assert.equal(state.isDraw, true);
    assert.equal(state.winner, null);
  });
});

describe("sudden death — The Decider", () => {
  const decider: TournamentConfig = {
    teams: [
      { id: "A", name: "Ada" },
      { id: "B", name: "Ngozi" },
    ],
    players: [
      { id: "a1", displayName: "Ada", teamId: "A" },
      { id: "b1", displayName: "Ngozi", teamId: "B" },
    ],
    roundCount: 5,
    shotsPerTurn: 5,
    scoring: "sudden-death",
  };

  const practise = (): Turn[] => [
    { round: 0, playerId: "a1", score: null },
    { round: 0, playerId: "b1", score: null },
  ];

  it("ends the moment a round is won outright", () => {
    const turns = [
      ...practise(),
      { round: 1, playerId: "a1", score: 45 },
      { round: 1, playerId: "b1", score: 40 },
    ];
    const state = computeState(decider, turns);
    assert.equal(state.phase, "complete");
    assert.equal(state.winner?.teamId, "A");
  });

  it("continues through a tied round", () => {
    const turns = [
      ...practise(),
      { round: 1, playerId: "a1", score: 42 },
      { round: 1, playerId: "b1", score: 42 },
    ];
    const state = computeState(decider, turns);
    assert.equal(state.phase, "playing");
    assert.equal(state.currentRound, 2);
  });
});

describe("recovery", () => {
  // §5: "Simple recovery — a mis-entered score must be correctable without
  // restarting the tournament."

  it("corrects a score and recomputes the result", () => {
    const wrong = [...practice(), ...round(1, [4, 20, 40, 20])]; // Ada 40 typed as 4
    assert.equal(
      computeState(duel, wrong).standings.find((s) => s.teamId === "A")?.total,
      44,
    );

    const fixed = correctTurn(wrong, { round: 1, playerId: "a1", score: 40 });
    const state = computeState(duel, fixed);
    assert.equal(state.standings.find((s) => s.teamId === "A")?.total, 80);
    assert.equal(state.standings.find((s) => s.teamId === "A")?.roundsWon, 1);
  });

  it("can flip a decided tournament back open", () => {
    // The strongest form of "without restarting": a wrong score that ended the
    // Decider must be undoable, and play resumes exactly where it was.
    const decider: TournamentConfig = {
      teams: [
        { id: "A", name: "Ada" },
        { id: "B", name: "Ngozi" },
      ],
      players: [
        { id: "a1", displayName: "Ada", teamId: "A" },
        { id: "b1", displayName: "Ngozi", teamId: "B" },
      ],
      roundCount: 5,
      shotsPerTurn: 5,
      scoring: "sudden-death",
    };
    const turns: Turn[] = [
      { round: 0, playerId: "a1", score: null },
      { round: 0, playerId: "b1", score: null },
      { round: 1, playerId: "a1", score: 45 },
      { round: 1, playerId: "b1", score: 40 },
    ];
    assert.equal(computeState(decider, turns).phase, "complete");

    const fixed = correctTurn(turns, { round: 1, playerId: "b1", score: 45 });
    assert.equal(computeState(decider, fixed).phase, "playing");
  });

  it("undoes the most recent turn", () => {
    const turns = [...practice(), ...round(1, [40, 30, 35, 25])];
    const undone = undoLastTurn(turns);
    assert.equal(undone.length, turns.length - 1);
    assert.equal(computeState(duel, undone).currentPlayer?.displayName, "Emeka");
  });

  it("leaves the list untouched when correcting a turn that is not there", () => {
    const turns = [...practice(), ...round(1, [40, 30, 35, 25])];
    assert.deepEqual(correctTurn(turns, { round: 9, playerId: "a1", score: 1 }), turns);
  });
});

describe("validateTurn", () => {
  it("accepts the current player's turn", () => {
    const turns = practice();
    assert.equal(
      validateTurn(duel, turns, { round: 1, playerId: "a1", score: 40 }, MAX_PER_TURN).ok,
      true,
    );
  });

  it("rejects an out-of-order turn", () => {
    // Turn order is the mechanic. Accepting turns out of order would quietly
    // dissolve it and desynchronise the screen from the line.
    const result = validateTurn(
      duel,
      practice(),
      { round: 1, playerId: "b2", score: 40 },
      MAX_PER_TURN,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /Ada/);
  });

  it("rejects an impossible score rather than clamping it", () => {
    const result = validateTurn(
      duel,
      practice(),
      { round: 1, playerId: "a1", score: 51 },
      MAX_PER_TURN,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /outside 0–50/);
  });

  it("rejects a non-integer score", () => {
    for (const score of [40.5, Number.NaN]) {
      const r = validateTurn(
        duel,
        practice(),
        { round: 1, playerId: "a1", score },
        MAX_PER_TURN,
      );
      assert.equal(r.ok, false, `accepted ${score}`);
    }
  });

  it("rejects any turn once the tournament is decided", () => {
    const turns = [
      ...practice(),
      ...round(1, [40, 20, 40, 20]),
      ...round(2, [40, 20, 40, 20]),
      ...round(3, [40, 20, 40, 20]),
    ];
    const r = validateTurn(duel, turns, { round: 4, playerId: "a1", score: 40 }, MAX_PER_TURN);
    assert.equal(r.ok, false);
  });
});

describe("privacy on the live screen", () => {
  it("exposes display names only", () => {
    // §5: "No personal data beyond first names or chosen display names. The
    // screen is visible to everyone in the building and will be photographed."
    const state = computeState(duel, [...practice(), ...round(1, [40, 30, 35, 25])]);
    const serialised = JSON.stringify(state);
    for (const name of ["Ada", "Chidi", "Ngozi", "Emeka"]) {
      assert.ok(!serialised.includes(`${name}@`), "an email reached the screen");
    }
    assert.equal(serialised.includes("fullName"), false);
    assert.equal(serialised.includes("email"), false);
  });

  it("carries no timestamp", () => {
    // §8 applies to the screen too: "This applies equally to the live screen,
    // which is visible to everyone in the building and will be photographed."
    const state = computeState(duel, [...practice(), ...round(1, [40, 30, 35, 25])]);
    const serialised = JSON.stringify(state);
    assert.doesNotMatch(serialised, /\d{4}-\d{2}-\d{2}/);
    assert.equal(serialised.includes("At\":"), false);
  });
});
