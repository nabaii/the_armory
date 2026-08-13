import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Subject, TierPermissions } from "./capability";
import { noticeSummary, noticesDue, type NoticeCandidate } from "./notices";

/**
 * §12.1: "Member licence expired yesterday → … Warnings were sent at 60, 30 and
 *         7 days."
 * §4.3:  "Blocks that a member could have resolved in advance must have been
 *         surfaced in the portal in advance."
 *
 * The ladder is the club's evidence that it warned somebody before the desk
 * refused them. These tests are about the two ways that evidence goes wrong:
 * a warning that never fires, and a warning that fires so often the member
 * stops reading them.
 */

const NOW = new Date("2026-08-13T09:00:00.000Z");

const TIER: TierPermissions = {
  id: "tier-full",
  name: "Full",
  canHost: true,
  guestAllowanceAnnual: 12,
  guestConcurrentMax: 2,
  canOwnFirearm: true,
  canStoreFirearm: false,
  disciplineAccess: ["pistol", "rifle"],
  bookingHorizonDays: 30,
  concurrentBookingsMax: 3,
};

/** Days from NOW, at the same wall-clock time, so the rung is unambiguous. */
const inDays = (days: number): Date =>
  new Date(NOW.getTime() + days * 86_400_000);

function member(overrides: Partial<Subject> = {}): Subject {
  return {
    personId: "person-1",
    membership: {
      id: "m-1",
      status: "active",
      tier: TIER,
      endedOn: null,
      renewsOn: null,
    },
    waiver: null,
    licences: [],
    qualifications: [],
    ...overrides,
  };
}

const roster = (...subjects: Subject[]): NoticeCandidate[] =>
  subjects.map((subject) => ({ subject }));

describe("the ladder fires on 60, 30 and 7 — and only there", () => {
  for (const rung of [60, 30, 7]) {
    it(`warns a member whose licence expires in ${rung} days`, () => {
      const notices = noticesDue(
        roster(
          member({
            licences: [
              {
                id: "l-1",
                status: "verified",
                calibres: ["9mm"],
                expiresOn: inDays(rung),
              },
            ],
          }),
        ),
        NOW,
      );

      assert.equal(notices.length, 1);
      assert.equal(notices[0].daysRemaining, rung);
      assert.equal(notices[0].items[0].kind, "licence");
    });
  }

  for (const quiet of [61, 59, 31, 29, 8, 6, 1]) {
    it(`stays silent at ${quiet} days`, () => {
      const notices = noticesDue(
        roster(
          member({
            licences: [
              {
                id: "l-1",
                status: "verified",
                calibres: ["9mm"],
                expiresOn: inDays(quiet),
              },
            ],
          }),
        ),
        NOW,
      );

      assert.deepEqual(notices, []);
    });
  }

  it("says nothing about a licence that has already expired", () => {
    /* The ladder warns BEFORE. Once it has expired the member meets a block
       with a remedy at the desk and in the portal, and a message announcing
       something that already happened reads as the system having missed it. */
    const notices = noticesDue(
      roster(
        member({
          licences: [
            {
              id: "l-1",
              status: "verified",
              calibres: ["9mm"],
              expiresOn: inDays(-1),
            },
          ],
        }),
      ),
      NOW,
    );

    assert.deepEqual(notices, []);
  });

  it("ignores a licence that was never verified", () => {
    /* §3.1: "Capability activates only on verified." An unverified licence
       grants nothing, so its expiry costs the member nothing and warning them
       about it would send them to renew a document the club has not looked at. */
    const notices = noticesDue(
      roster(
        member({
          licences: [
            {
              id: "l-1",
              status: "pending_review",
              calibres: ["9mm"],
              expiresOn: inDays(30),
            },
          ],
        }),
      ),
      NOW,
    );

    assert.deepEqual(notices, []);
  });
});

describe("one member, one message", () => {
  it("merges everything landing on the same rung", () => {
    const notices = noticesDue(
      roster(
        member({
          licences: [
            {
              id: "l-1",
              status: "verified",
              calibres: ["9mm"],
              expiresOn: inDays(30),
            },
          ],
          qualifications: [
            { discipline: "pistol", level: "club", expiresAt: inDays(30) },
          ],
        }),
      ),
      NOW,
    );

    assert.equal(notices.length, 1, "the member would have received two messages");
    assert.equal(notices[0].items.length, 2);
  });

  it("keeps different rungs as separate conversations", () => {
    const notices = noticesDue(
      roster(
        member({
          licences: [
            {
              id: "l-1",
              status: "verified",
              calibres: ["9mm"],
              expiresOn: inDays(60),
            },
          ],
          qualifications: [
            { discipline: "pistol", level: "club", expiresAt: inDays(7) },
          ],
        }),
      ),
      NOW,
    );

    assert.equal(notices.length, 2);
    assert.deepEqual(
      notices.map((n) => n.daysRemaining),
      [7, 60],
      "the more urgent warning must come first",
    );
  });
});

describe("the key", () => {
  const subject = member({
    licences: [
      { id: "l-1", status: "verified", calibres: ["9mm"], expiresOn: inDays(30) },
    ],
  });

  it("is identical when the sweep is run twice on the same day", () => {
    /* A retried job, a redeploy, a founder pressing the button twice. None of
       them may produce a second WhatsApp message. */
    const first = noticesDue(roster(subject), NOW);
    const second = noticesDue(
      roster(subject),
      new Date(NOW.getTime() + 6 * 3_600_000),
    );

    assert.equal(first[0].key, second[0].key);
  });

  it("changes when the underlying expiry date changes", () => {
    /* A renewed licence is a new thing to warn about, and its 60-day rung must
       not be suppressed by the key of the licence it replaced. */
    const renewed = member({
      licences: [
        {
          id: "l-1",
          status: "verified",
          calibres: ["9mm"],
          expiresOn: inDays(60),
        },
      ],
    });

    const before = noticesDue(roster(subject), NOW);
    const after = noticesDue(roster(renewed), NOW);

    assert.notEqual(before[0].key, after[0].key);
  });

  it("does not depend on the order two same-day expiries arrive in", () => {
    const licence = {
      id: "l-1",
      status: "verified" as const,
      calibres: ["9mm"],
      expiresOn: inDays(30),
    };
    const qualification = {
      discipline: "pistol",
      level: "club",
      expiresAt: inDays(30),
    };

    const one = noticesDue(
      roster(member({ licences: [licence], qualifications: [qualification] })),
      NOW,
    );
    const other = noticesDue(
      roster(member({ qualifications: [qualification], licences: [licence] })),
      NOW,
    );

    assert.equal(one[0].key, other[0].key);
  });
});

describe("the sentence a member reads", () => {
  it("names one thing plainly", () => {
    const [notice] = noticesDue(
      roster(
        member({
          licences: [
            {
              id: "l-1",
              status: "verified",
              calibres: ["9mm"],
              expiresOn: inDays(7),
            },
          ],
        }),
      ),
      NOW,
    );

    assert.equal(noticeSummary(notice), "Firearm licence expires in 7 days.");
  });

  it("joins several without reading as a list of errors", () => {
    const [notice] = noticesDue(
      roster(
        member({
          licences: [
            {
              id: "l-1",
              status: "verified",
              calibres: ["9mm"],
              expiresOn: inDays(30),
            },
          ],
          qualifications: [
            { discipline: "pistol", level: "club", expiresAt: inDays(30) },
          ],
        }),
      ),
      NOW,
    );

    const summary = noticeSummary(notice);
    assert.match(summary, / and /);
    assert.doesNotMatch(summary, /undefined|null/);
    assert.equal(summary.split("\n").length, 1);
  });
});

describe("a roster", () => {
  it("produces nothing for members with nothing expiring", () => {
    const notices = noticesDue(
      roster(member(), member({ personId: "person-2" })),
      NOW,
    );
    assert.deepEqual(notices, []);
  });

  it("warns a member about their membership renewal", () => {
    const notices = noticesDue(
      roster(
        member({
          membership: {
            id: "m-1",
            status: "active",
            tier: TIER,
            endedOn: null,
            renewsOn: inDays(30),
          },
        }),
      ),
      NOW,
    );

    assert.equal(notices.length, 1);
    assert.equal(notices[0].items[0].kind, "membership");
  });
});
