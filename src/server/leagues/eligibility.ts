import type { memberStatus } from "@/db/schema";
import type { MembershipStatus } from "@/domain/enums";

/**
 * LEAGUE ELIGIBILITY — who may play, captain, and appear on the club ladder.
 *
 * ===========================================================================
 * THE ACCESS MODEL, FROM THE BRIEF
 *
 * "Open to all, better for members. Members-only starves the acquisition engine
 *  — every league is a four-person recruiting event and three of those four may
 *  not be members yet. But open-and-equal cannibalises memberships: if
 *  pay-per-visit buys an identical experience, the reason to join disappears."
 *
 * The resolution, verbatim: "Non-members can join and play a league, paying per
 * visit each time. Members can create and captain leagues, appear on the
 * persistent season-long club ladder, get league entry priced in, receive
 * priority booking for league slots, and are eligible for status events."
 *
 * And the summary line the whole product hangs on: "Anyone can play; members
 * are the club."
 *
 * ===========================================================================
 * THE SEASON CAP
 *
 * The Brief left this open — "Should a non-member play indefinitely, or face a
 * cap… A cap makes conversion forcing rather than optional; too tight a cap
 * kills the viral loop before it catches. Deferred by the founder; revisit
 * before Leagues is specified."
 *
 * Settled at ONE FULL SEASON. The reasoning:
 *
 *   · A full season is long enough for the loop to do its work. The mechanism
 *     is social obligation — "people return because they told a friend they
 *     would be there" — and that needs a group to form a habit, not four
 *     rounds.
 *   · By the end of a season the per-visit cost has already made the argument
 *     without anyone pitching: "anyone playing weekly discovers, without being
 *     pitched, that membership is cheaper."
 *   · It converts at the moment of maximum attachment — when their league is
 *     about to start a new season without them.
 *
 * A round-count cap was rejected as too forcing; no cap at all leaves
 * conversion entirely optional, which is the cannibalisation risk.
 */

type Status = (typeof memberStatus.enumValues)[number];

/** Seasons a non-member may complete before membership is required. */
export const NON_MEMBER_SEASON_CAP = 1;

const FULL_MEMBER: readonly Status[] = ["member", "founding_member"];

export const isFullMember = (status: Status): boolean =>
  FULL_MEMBER.includes(status);

/* ---------------------------------------------------------------------------
   PRIVILEGES

   Each is a separate predicate rather than one `canDoEverything` flag, because
   they genuinely differ — a lapsed member keeps their history but loses their
   ladder position, and a non-member can play but not captain.
   -------------------------------------------------------------------------- */

/** "Members can create and captain leagues." Non-members cannot. */
export const canCaptainLeague = (status: Status): boolean => isFullMember(status);

/**
 * "Members… appear on the persistent season-long club ladder."
 *
 * This is the sharpest members-only privilege, and the reason is worth keeping
 * visible: the club ladder is the standing that makes membership legible. A
 * non-member's scores still count inside their own league — they are simply
 * absent from the club-wide table.
 */
export const canAppearOnClubLadder = (status: Status): boolean =>
  isFullMember(status);

/** "Priority booking for league slots." */
export const hasPriorityBooking = (status: Status): boolean =>
  isFullMember(status);

/** "Eligible for status events — the championship, the season finale." */
export const canEnterStatusEvents = (status: Status): boolean =>
  isFullMember(status);

/** Founding members are "permanently and visibly distinguished". */
export const isFounding = (status: Status): boolean => status === "founding_member";

/* ---------------------------------------------------------------------------
   WHERE STANDING COMES FROM
   -------------------------------------------------------------------------- */

/**
 * The leagues standing implied by a club membership.
 *
 * ===========================================================================
 * WHY THIS EXISTS: TWO ANSWERS TO ONE QUESTION
 *
 * `members.status` is the leagues product's notion of standing and
 * `armory.memberships.status` is the club's. While nothing joined them that was
 * a tolerable duplication. `members.person_id` joined them, and it stopped
 * being tolerable: `linkPortalAccount` deliberately leaves `members.status` at
 * its default, so every member the club onboards reads as `non_member` to this
 * file — and the club's own founder was refused captaincy, the club ladder,
 * priority booking and status events by a column nobody had written.
 *
 * The fix is not to sync the two, which is the divergence §3.4 warns about in a
 * different table for the same reason. It is to have ONE answer: where a person
 * link exists, the club's membership decides, and `members.status` is left to
 * the leagues-only accounts it was designed for — someone who signed in to
 * watch a ladder and has never been near the club.
 *
 * ===========================================================================
 * THE MAPPING MIRRORS §4, IT DOES NOT INVENT A SECOND OPINION
 *
 * `standing()` in src/domain/capability/index.ts passes `active` and blocks
 * every other status, `pending` included. This agrees with it: privileges begin
 * when the membership is live, not when it is applied for. A `pending` member
 * has been admitted and not yet paid (§5), which is precisely the state the
 * club itself refuses to grant on.
 *
 * ===========================================================================
 * ONE IMPRECISION, RECORDED RATHER THAN HIDDEN
 *
 * `suspended` and `resigned` both land on `lapsed`, because the leagues enum
 * has four values and neither of those is one of them. Privileges resolve
 * correctly — all three lose them and keep their history — but a suspended
 * member reading a lapsed member's words is the kind of near-miss §4.3 objects
 * to. Fixing it properly means a value in `member_status`, which is a migration
 * this change does not need; noted here so the next person finds the reason
 * rather than the symptom.
 */
export function leaguesStandingFor(
  club: MembershipStatus,
  isFoundingTier: boolean,
): Status {
  switch (club) {
    case "active":
      return isFoundingTier ? "founding_member" : "member";
    case "pending":
      return "non_member";
    case "lapsed":
    case "suspended":
    case "resigned":
      return "lapsed";
  }
}

/* ---------------------------------------------------------------------------
   JOINING A LEAGUE
   -------------------------------------------------------------------------- */

export type JoinEligibility =
  | { ok: true; payPerVisit: boolean }
  | { ok: false; reason: "season-cap-reached"; seasonsPlayed: number }
  | { ok: false; reason: "lapsed" };

/**
 * Whether a member may join a league for a new season.
 *
 * `nonMemberSeasonsPlayed` must be derived from `league_players.statusAtJoin`,
 * NOT from the member's current status — see the note on that column. Someone
 * who played a season as a non-member and then joined the club has a history
 * that current status would erase, and the cap would silently mis-count.
 */
export function canJoinLeague({
  status,
  nonMemberSeasonsPlayed,
}: {
  status: Status;
  nonMemberSeasonsPlayed: number;
}): JoinEligibility {
  /* Full members always may, and their league entry is priced into
     membership rather than charged per visit. */
  if (isFullMember(status)) return { ok: true, payPerVisit: false };

  /* A lapsed member is not a non-member — they had the club and let it go, so
     they rejoin rather than start the non-member clock again. Routing them to
     the cap message would be both wrong and insulting. */
  if (status === "lapsed") return { ok: false, reason: "lapsed" };

  if (nonMemberSeasonsPlayed >= NON_MEMBER_SEASON_CAP) {
    return {
      ok: false,
      reason: "season-cap-reached",
      seasonsPlayed: nonMemberSeasonsPlayed,
    };
  }

  /* Non-member, within the cap: plays, and pays per visit each time. That
     per-visit cost is what does the selling. */
  return { ok: true, payPerVisit: true };
}

/**
 * Count of distinct seasons a member has played WHILE a non-member.
 *
 * Takes the participation history rather than querying, so the rule is pure and
 * testable and the caller owns the read. Distinct by season: playing in two
 * leagues in the same season is one season, not two — a cap that punished
 * someone for joining a second league with different friends would work
 * directly against the acquisition loop it exists to protect.
 */
export function countNonMemberSeasons(
  participation: readonly { seasonId: string; statusAtJoin: Status }[],
): number {
  const seasons = new Set<string>();
  for (const row of participation) {
    if (!isFullMember(row.statusAtJoin)) seasons.add(row.seasonId);
  }
  return seasons.size;
}

/**
 * What to tell someone the cap has stopped.
 *
 * Voice matters here more than anywhere else in the product: this is a
 * conversion moment aimed at someone who has just spent a season enjoying the
 * club. Assured and hospitable, never a paywall. No urgency, no countdown, no
 * exclamation mark — Guidelines §9.
 */
export const SEASON_CAP_MESSAGE = {
  heading: "Your next season is a members' one.",
  body:
    "You have played a full season with us. Carrying on means joining the club — " +
    "which also puts you on the club ladder, prices your league entry in, and " +
    "gives you priority on league slots.",
} as const;
