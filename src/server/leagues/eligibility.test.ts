/**
 * League eligibility — the access model.
 *
 * "Anyone can play; members are the club." These tests pin the two halves of
 * that against each other, because the tension is the whole design: members-only
 * starves acquisition, open-and-equal cannibalises membership.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NON_MEMBER_SEASON_CAP,
  canAppearOnClubLadder,
  canCaptainLeague,
  canEnterStatusEvents,
  canJoinLeague,
  countNonMemberSeasons,
  hasPriorityBooking,
  isFounding,
  isFullMember,
} from "./eligibility";

describe("privileges", () => {
  it("treats members and founding members as full members", () => {
    assert.equal(isFullMember("member"), true);
    assert.equal(isFullMember("founding_member"), true);
  });

  it("does not treat non-members or lapsed members as full", () => {
    assert.equal(isFullMember("non_member"), false);
    assert.equal(isFullMember("lapsed"), false);
  });

  it("restricts captaincy to members", () => {
    // "Members can create and captain leagues."
    assert.equal(canCaptainLeague("member"), true);
    assert.equal(canCaptainLeague("founding_member"), true);
    assert.equal(canCaptainLeague("non_member"), false);
    assert.equal(canCaptainLeague("lapsed"), false);
  });

  it("restricts the club ladder to members", () => {
    // The sharpest members-only privilege — the standing that makes
    // membership legible. A non-member still scores inside their own league.
    assert.equal(canAppearOnClubLadder("member"), true);
    assert.equal(canAppearOnClubLadder("non_member"), false);
  });

  it("restricts priority booking and status events to members", () => {
    assert.equal(hasPriorityBooking("member"), true);
    assert.equal(hasPriorityBooking("non_member"), false);
    assert.equal(canEnterStatusEvents("founding_member"), true);
    assert.equal(canEnterStatusEvents("non_member"), false);
  });

  it("distinguishes founding members permanently", () => {
    assert.equal(isFounding("founding_member"), true);
    assert.equal(isFounding("member"), false);
  });
});

describe("canJoinLeague", () => {
  it("lets a first-time non-member play, paying per visit", () => {
    const result = canJoinLeague({ status: "non_member", nonMemberSeasonsPlayed: 0 });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.payPerVisit, true);
  });

  it("does not charge members per visit — league entry is priced in", () => {
    const result = canJoinLeague({ status: "member", nonMemberSeasonsPlayed: 0 });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.payPerVisit, false);
  });

  it("stops a non-member after the season cap", () => {
    const result = canJoinLeague({
      status: "non_member",
      nonMemberSeasonsPlayed: NON_MEMBER_SEASON_CAP,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "season-cap-reached");
  });

  it("never caps a member, however many seasons they played before joining", () => {
    // Someone who played a season as a non-member and then joined must not be
    // blocked by their own history — that would punish the exact conversion
    // the cap exists to produce.
    const result = canJoinLeague({ status: "member", nonMemberSeasonsPlayed: 9 });
    assert.equal(result.ok, true);
  });

  it("routes a lapsed member to rejoining, not to the cap message", () => {
    // A lapsed member had the club and let it go. Telling them they have "used
    // up their free season" would be both wrong and insulting.
    const result = canJoinLeague({ status: "lapsed", nonMemberSeasonsPlayed: 0 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "lapsed");
  });
});

describe("countNonMemberSeasons", () => {
  const S1 = "season-1";
  const S2 = "season-2";

  it("counts nothing for a member", () => {
    assert.equal(
      countNonMemberSeasons([
        { seasonId: S1, statusAtJoin: "member" },
        { seasonId: S2, statusAtJoin: "founding_member" },
      ]),
      0,
    );
  });

  it("counts a season played as a non-member", () => {
    assert.equal(
      countNonMemberSeasons([{ seasonId: S1, statusAtJoin: "non_member" }]),
      1,
    );
  });

  it("counts two leagues in the SAME season as one season", () => {
    // A cap that punished someone for joining a second league with different
    // friends would work directly against the acquisition loop it protects.
    assert.equal(
      countNonMemberSeasons([
        { seasonId: S1, statusAtJoin: "non_member" },
        { seasonId: S1, statusAtJoin: "non_member" },
      ]),
      1,
    );
  });

  it("counts distinct seasons separately", () => {
    assert.equal(
      countNonMemberSeasons([
        { seasonId: S1, statusAtJoin: "non_member" },
        { seasonId: S2, statusAtJoin: "non_member" },
      ]),
      2,
    );
  });

  it("uses status AT JOIN, not current status", () => {
    // The reason statusAtJoin exists as a column. If this read live status, a
    // non-member's history would vanish the moment they joined the club and
    // the cap would silently mis-count for everyone who converted.
    const history = [
      { seasonId: S1, statusAtJoin: "non_member" as const },
      { seasonId: S2, statusAtJoin: "member" as const },
    ];
    assert.equal(countNonMemberSeasons(history), 1);
  });

  it("returns zero for no history", () => {
    assert.equal(countNonMemberSeasons([]), 0);
  });
});

describe("the cap end to end", () => {
  it("permits season one and blocks season two for a non-member", () => {
    const history: { seasonId: string; statusAtJoin: "non_member" }[] = [];

    const first = canJoinLeague({
      status: "non_member",
      nonMemberSeasonsPlayed: countNonMemberSeasons(history),
    });
    assert.equal(first.ok, true, "first season should be allowed");

    history.push({ seasonId: "season-1", statusAtJoin: "non_member" });

    const second = canJoinLeague({
      status: "non_member",
      nonMemberSeasonsPlayed: countNonMemberSeasons(history),
    });
    assert.equal(second.ok, false, "second season should require membership");
  });

  it("unblocks the moment they join the club", () => {
    const history = [{ seasonId: "season-1", statusAtJoin: "non_member" as const }];
    const afterJoining = canJoinLeague({
      status: "member",
      nonMemberSeasonsPlayed: countNonMemberSeasons(history),
    });
    assert.equal(afterJoining.ok, true);
    if (afterJoining.ok) assert.equal(afterJoining.payPerVisit, false);
  });
});
