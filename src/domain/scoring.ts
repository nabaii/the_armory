/**
 * SCORING — §6.5's Score screen, §6.2's My shooting, §3.3's `rounds`.
 *
 *   §6.5: "Select shooter, enter total, confirm. NO FREE-TEXT ENTRY IN THE
 *    NORMAL PATH. Under twenty seconds. Guests are scored identically to
 *    members."
 *   §6.2: "Score history, personal best by discipline, trend. Phase 1 shows
 *    history; Phase 2 adds standing."
 *   §13: "Leagues engine, ladder, standings, fixtures — Phase 2. Score capture
 *    in Phase 1 exists to populate them."
 *
 * ===========================================================================
 * WHAT "NO FREE-TEXT ENTRY" ACTUALLY CONSTRAINS
 *
 * It is easy to read that line as being about the keyboard and to satisfy it
 * with a numeric input. It is about something harder: at the moment of capture
 * there are four facts — who, which discipline, which format, what total — and
 * three of them must already be known.
 *
 * Who comes from the relay: the shooter is on a lane, checked in, with a
 * participation id. Discipline comes from the booking. Format is the only
 * choice the officer makes, and it is a choice from a list this module owns.
 * That leaves one number to key, on a keypad, in the twenty seconds §6.5
 * allows — and it leaves nothing that can be spelled two different ways.
 *
 * The consequence for Phase 2 is the reason it matters. §13 says Phase 1 exists
 * to populate the leagues engine, and a leagues engine cannot rank rows whose
 * `format` column holds "60 shot", "60-shot", "60 shots" and "sixty". Free text
 * here is a data cleanup nobody schedules, discovered in the month standings
 * are supposed to launch.
 *
 * ===========================================================================
 * SCORES ARE STORED IN TENTHS, FOR THE SAME REASON MONEY IS STORED IN KOBO
 *
 * `rounds.total_score` is an INTEGER (§3.3), and ISSF decimal scoring goes to
 * one decimal place — a 10.9 is a real score in a final. Those two facts have
 * to be reconciled somewhere, and §2 already decided how this codebase does it:
 * "All amounts stored as integer kobo. Never floats."
 *
 * So a decimal format stores tenths. A 623.4 is 6234, and `ScoreFormat.scale`
 * says which. Nothing in the system holds a fractional score, no comparison
 * between two scores can be wrong by a floating-point epsilon, and a personal
 * best is an integer comparison.
 *
 * The alternative — a numeric column — was rejected for the reason src/lib/
 * money.ts gives at greater length: the moment one float exists, every
 * arithmetic path has to be audited for it, and the audit is never done twice.
 *
 * ===========================================================================
 * THE FORMAT TABLE IS DATA, NOT A DECISION THIS FILE OWNS
 *
 * §14 does not list score formats as a blocking item, so they are not blocking
 * — but they are the club's to set, not the build team's. What is below is the
 * ISSF course of fire for each of the four disciplines in src/content/
 * disciplines.ts, which is the right default and is almost certainly not the
 * final list: a club runs practice formats and club matches that no federation
 * publishes.
 *
 * Changing it is editing this array. The `id` values are what land in the
 * `format` column and are therefore permanent — a format that has been shot
 * is never renamed, only deactivated, exactly as a tier is.
 */

/* ============================================================================
   FORMATS
   ========================================================================= */

export type ScoreFormat = {
  /**
   * Stored in `rounds.format`. Permanent once a round carries it.
   *
   * Prefixed with the discipline so the column is self-describing in a query
   * that has not joined anything — the shape a founder writes at a terminal
   * when the dashboard does not answer their question.
   */
  readonly id: string;
  /** Slug from src/content/disciplines.ts. Stored in `rounds.discipline`. */
  readonly discipline: string;
  /** What the officer taps. Short: it sits on a lane tablet in daylight. */
  readonly label: string;
  readonly shots: number;
  /**
   * 1 for whole-point scoring, 10 for decimal.
   *
   * The number a stored `total_score` is divided by to read as a score. Not a
   * count of decimal places — a scale, so the arithmetic is multiplication
   * rather than string manipulation.
   */
  readonly scale: 1 | 10;
  /** The highest possible total, in stored units. A perfect card. */
  readonly maxTotal: number;
  /**
   * False for a format the club has retired.
   *
   * Retired rather than deleted, for the reason every status vocabulary in this
   * system is append-only: rounds already shot under it must still render.
   */
  readonly active: boolean;
};

/**
 * The course of fire for each discipline.
 *
 * Whole-point qualification formats and one decimal final per discipline,
 * plus a short practice card — because most visits are practice, and a club
 * that can only record a full match will record almost nothing.
 */
export const SCORE_FORMATS: readonly ScoreFormat[] = [
  /* ---- 10m air rifle ---- */
  {
    id: "10m-air-rifle/60",
    discipline: "10m-air-rifle",
    label: "60 shots",
    shots: 60,
    scale: 1,
    maxTotal: 600,
    active: true,
  },
  {
    id: "10m-air-rifle/40",
    discipline: "10m-air-rifle",
    label: "40 shots",
    shots: 40,
    scale: 1,
    maxTotal: 400,
    active: true,
  },
  {
    id: "10m-air-rifle/20-practice",
    discipline: "10m-air-rifle",
    label: "20 shots practice",
    shots: 20,
    scale: 1,
    maxTotal: 200,
    active: true,
  },
  {
    id: "10m-air-rifle/final",
    discipline: "10m-air-rifle",
    label: "Final (decimal)",
    shots: 24,
    scale: 10,
    maxTotal: 2616,
    active: true,
  },

  /* ---- 50m range ---- */
  {
    id: "50m-range/60-prone",
    discipline: "50m-range",
    label: "60 shots prone",
    shots: 60,
    scale: 1,
    maxTotal: 600,
    active: true,
  },
  {
    id: "50m-range/3x40",
    discipline: "50m-range",
    label: "3 × 40 positions",
    shots: 120,
    scale: 1,
    maxTotal: 1200,
    active: true,
  },
  {
    id: "50m-range/20-practice",
    discipline: "50m-range",
    label: "20 shots practice",
    shots: 20,
    scale: 1,
    maxTotal: 200,
    active: true,
  },

  /* ---- 25m pistol ---- */
  {
    id: "25m-pistol/60",
    discipline: "25m-pistol",
    label: "60 shots",
    shots: 60,
    scale: 1,
    maxTotal: 600,
    active: true,
  },
  {
    id: "25m-pistol/30-precision",
    discipline: "25m-pistol",
    label: "30 shots precision",
    shots: 30,
    scale: 1,
    maxTotal: 300,
    active: true,
  },
  {
    id: "25m-pistol/20-practice",
    discipline: "25m-pistol",
    label: "20 shots practice",
    shots: 20,
    scale: 1,
    maxTotal: 200,
    active: true,
  },

  /* ---- 10m pistol ---- */
  {
    id: "10m-pistol/60",
    discipline: "10m-pistol",
    label: "60 shots",
    shots: 60,
    scale: 1,
    maxTotal: 600,
    active: true,
  },
  {
    id: "10m-pistol/40",
    discipline: "10m-pistol",
    label: "40 shots",
    shots: 40,
    scale: 1,
    maxTotal: 400,
    active: true,
  },
  {
    id: "10m-pistol/20-practice",
    discipline: "10m-pistol",
    label: "20 shots practice",
    shots: 20,
    scale: 1,
    maxTotal: 200,
    active: true,
  },
  {
    id: "10m-pistol/final",
    discipline: "10m-pistol",
    label: "Final (decimal)",
    shots: 24,
    scale: 10,
    maxTotal: 2616,
    active: true,
  },
];

const BY_ID = new Map(SCORE_FORMATS.map((format) => [format.id, format]));

export const formatById = (id: string): ScoreFormat | null =>
  BY_ID.get(id) ?? null;

/**
 * What the lane offers for the discipline the booking is for.
 *
 * Retired formats are excluded here and readable through `formatById`, which is
 * the split that lets a five-year-old round still render its label while
 * nobody can shoot one today.
 */
export const formatsFor = (discipline: string): readonly ScoreFormat[] =>
  SCORE_FORMATS.filter(
    (format) => format.discipline === discipline && format.active,
  );

/* ============================================================================
   ENTRY — the one number the officer keys
   ========================================================================= */

export type ScoreRefusal = {
  /** §4.3's shape: one line, in the officer's words. */
  readonly reason: string;
  readonly remedy: string | null;
};

export type ScoreEntry =
  | { readonly ok: true; readonly totalScore: number }
  | { readonly ok: false; readonly refusal: ScoreRefusal };

const refuse = (reason: string, remedy: string | null): ScoreEntry => ({
  ok: false,
  refusal: { reason, remedy },
});

/**
 * Turn what was keyed into what is stored.
 *
 * Takes a string rather than a number because that is what an input holds, and
 * because the difference between "" and 0 is the difference between an officer
 * who has not finished and an officer recording a zero. A number parameter
 * would have collapsed the two before this function ever saw them.
 *
 * ===========================================================================
 * WHY AN IMPOSSIBLE SCORE IS REFUSED AND A SURPRISING ONE IS NOT
 *
 * Above `maxTotal` is refused: it is not a score, it is a typo, and a 6000 in
 * the column corrupts every personal best and every future standing computed
 * from it.
 *
 * A 598 out of 600 is not refused, and there is no "are you sure". It is a
 * world-class card and it is also what a member shoots on the day they are
 * proudest — a confirmation dialogue there tells them the system doubts them,
 * and §6.5 gives the whole interaction twenty seconds. The guard against a
 * mis-key is §1.2 rule 3: a correction is a new row citing the old one, which
 * this system supports and which leaves both numbers visible.
 */
export function parseScore(format: ScoreFormat, keyed: string): ScoreEntry {
  const trimmed = keyed.trim();

  if (trimmed === "") {
    return refuse("Enter the total.", null);
  }

  /* Digits, and one decimal point only where the format has decimals. Not a
     general number parse: `parseFloat("12abc")` is 12, and a score that was
     half-typed into a barcode scanner should be refused rather than truncated
     into something plausible. */
  const pattern = format.scale === 10 ? /^\d+(\.\d)?$/ : /^\d+$/;

  if (!pattern.test(trimmed)) {
    return refuse(
      format.scale === 10
        ? "Enter the total as a number, to one decimal place."
        : "Enter the total as a whole number.",
      null,
    );
  }

  /* Scaled by splitting the string rather than by multiplying a float.
     `Number("251.4") * 10` is in fact exactly 2514 — it is exact for every
     value up to the largest ceiling in the table above, which was checked
     rather than assumed. That is precisely the problem: the safety is a
     property of the current RANGE, not of the arithmetic, and nobody adding a
     format with a larger ceiling in two years will re-check it. Splitting on
     the point is safe by construction at any magnitude, which is the same
     reason §2 keeps money off the float path entirely rather than bounding it. */
  const [whole, tenth = "0"] = trimmed.split(".");
  const totalScore =
    format.scale === 10
      ? Number(whole) * 10 + Number(tenth)
      : Number(whole);

  if (totalScore > format.maxTotal) {
    return refuse(
      `A ${format.label} card cannot exceed ${describeScore(format, format.maxTotal)}.`,
      "Check the total and enter it again.",
    );
  }

  return { ok: true, totalScore };
}

/** A stored score, as a person reads it. */
export function describeScore(format: ScoreFormat, totalScore: number): string {
  if (format.scale === 1) return String(totalScore);

  const whole = Math.trunc(totalScore / 10);
  const tenth = totalScore % 10;
  return `${whole}.${tenth}`;
}

/* ============================================================================
   HISTORY — §6.2's My shooting
   ========================================================================= */

/**
 * A round, as every reader of history needs it.
 *
 * Deliberately not the database row. The portal, the person-detail panel and
 * any future standings all want the same five fields, and a shape that names
 * only those cannot accidentally carry `device_id` onto a member's phone.
 */
export type ScoredRound = {
  readonly id: string;
  readonly discipline: string;
  readonly format: string;
  readonly totalScore: number;
  readonly capturedAt: Date;
  /** Set when this round supersedes an earlier one (§1.2 rule 3). */
  readonly correctsRoundId: string | null;
};

/**
 * The rounds that still stand, newest first.
 *
 * §1.2 rule 3 — "a correction is a new row referencing the old one" — means the
 * table holds both the mistake and the fix, and every reader must agree about
 * which one counts. Doing that at each call site is how a personal best comes
 * to include a score the member had corrected away.
 *
 * A superseded round is not deleted and is not hidden from an audit; it is
 * excluded from the numbers that describe a person's shooting, which is a
 * different question.
 */
export function standingRounds(
  rounds: readonly ScoredRound[],
): readonly ScoredRound[] {
  const superseded = new Set(
    rounds
      .map((round) => round.correctsRoundId)
      .filter((id): id is string => id !== null),
  );

  return [...rounds]
    .filter((round) => !superseded.has(round.id))
    .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());
}

export type PersonalBest = {
  readonly discipline: string;
  readonly format: string;
  readonly totalScore: number;
  readonly capturedAt: Date;
};

/**
 * The best card in each format the person has shot.
 *
 * Per FORMAT, not per discipline, despite §6.2 saying "personal best by
 * discipline" — because a 60-shot 585 and a 20-shot practice 195 are not
 * comparable and picking the larger number would report the wrong card as the
 * better one. The discipline is on each entry, so a screen that wants to group
 * by discipline can; a screen that wanted the raw maximum would be showing a
 * number that means nothing.
 */
export function personalBests(
  rounds: readonly ScoredRound[],
): readonly PersonalBest[] {
  const best = new Map<string, PersonalBest>();

  for (const round of standingRounds(rounds)) {
    const current = best.get(round.format);

    if (!current || round.totalScore > current.totalScore) {
      best.set(round.format, {
        discipline: round.discipline,
        format: round.format,
        totalScore: round.totalScore,
        capturedAt: round.capturedAt,
      });
    }
  }

  return [...best.values()].sort((a, b) => a.format.localeCompare(b.format));
}

export type Trend = {
  readonly format: string;
  readonly direction: "up" | "down" | "steady";
  /** Change in the recent average, in stored units. Signed. */
  readonly change: number;
  /** One line, for a member. Never a percentage of a score. */
  readonly line: string;
};

/** Below this many cards in a format there is no trend, only noise. */
const TREND_MINIMUM = 4;
/** The most cards either side of the comparison uses. */
const TREND_WINDOW = 3;

/**
 * Whether a person's recent cards are better than the ones before them.
 *
 * ===========================================================================
 * WHY THIS REFUSES TO ANSWER BELOW FOUR CARDS
 *
 * A trend from two scores is the difference between two scores, and calling it
 * a trend makes it sound like evidence. A member whose second visit went worse
 * than their first has not got worse at shooting; they have had a bad morning,
 * and a system that tells them otherwise on their second ever visit is working
 * against the thing the club is selling.
 *
 * So below four cards this returns nothing, and the screen says how many more
 * are needed — which is also a reason to come back.
 *
 * Averages rather than bests, because a best is a ceiling and consistency is
 * what improves first. Compared within one format for the same reason personal
 * bests are: two formats are two different questions.
 *
 * ===========================================================================
 * THE TWO WINDOWS ARE THE SAME SIZE, ALWAYS
 *
 * A fixed window of three each side reads correctly and is wrong at exactly the
 * size most members are: with four cards it compares an average of three
 * against a single card, so one bad morning four visits ago sets the baseline
 * for everything after it. The comparison then improves — as a statement about
 * the member — every time an old card ages out of a window it was alone in.
 *
 * So the window is half of what exists, capped at three. Four cards compares
 * two against two; ten compares three against three. Symmetric at every size,
 * which is the only way the number means the same thing on the second reading
 * as on the first.
 */
export function trendFor(
  rounds: readonly ScoredRound[],
  format: string,
): Trend | null {
  const inFormat = standingRounds(rounds).filter(
    (round) => round.format === format,
  );

  if (inFormat.length < TREND_MINIMUM) return null;

  const window = Math.min(TREND_WINDOW, Math.floor(inFormat.length / 2));

  /* `standingRounds` is newest first, so the head is the recent window. */
  const recent = inFormat.slice(0, window);
  const previous = inFormat.slice(window, window * 2);

  const change = mean(recent) - mean(previous);
  const scoreFormat = formatById(format);

  /* Two points on a 60-shot card is inside ordinary day-to-day variation, and
     calling it an improvement would make the word worthless by the fourth
     visit. Held as an absolute so the wording cannot claim a change nobody
     would notice — in stored units, so decimal formats get the same 2.0. */
  const threshold = scoreFormat?.scale === 10 ? 20 : 2;

  if (Math.abs(change) < threshold) {
    return {
      format,
      direction: "steady",
      change,
      line: "Holding steady across your recent cards.",
    };
  }

  const points = scoreFormat
    ? describeScore(scoreFormat, Math.round(Math.abs(change)))
    : String(Math.round(Math.abs(change)));

  return change > 0
    ? {
        format,
        direction: "up",
        change,
        line: `Up ${points} points on your previous cards.`,
      }
    : {
        format,
        direction: "down",
        change,
        line: `Down ${points} points on your previous cards.`,
      };
}

/** How many more cards before a trend exists. Zero once there is one. */
export const cardsUntilTrend = (
  rounds: readonly ScoredRound[],
  format: string,
): number =>
  Math.max(
    0,
    TREND_MINIMUM -
      standingRounds(rounds).filter((round) => round.format === format).length,
  );

const mean = (rounds: readonly ScoredRound[]): number =>
  rounds.length === 0
    ? 0
    : rounds.reduce((sum, round) => sum + round.totalScore, 0) / rounds.length;
