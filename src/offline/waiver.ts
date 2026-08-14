import type { WaiverSignatureSnapshot } from "@/domain/capability";
import { uuidv7 } from "@/lib/uuidv7";
import type { IndexedDayPack } from "./daypack";

/**
 * SIGNING THE WAIVER AT THE DESK — §3.1, §6.4, §8.5.
 *
 * Step 9 of docs/M1_offline_acceptance.md — "sign a waiver" — and the last step
 * of that protocol's workflow that had no originating layer.
 *
 * The write was defined in src/sync/contract.ts, parsed in src/sync/operations.ts
 * and proven idempotent over two deliveries in src/sync/push.test.ts from the
 * beginning. Nothing built one. The acceptance sheet was updated at M5 to say
 * "steps 5–11 are built", which was true of equipment and not of this.
 *
 * It is not a cosmetic gap. `WAIVER_MISSING` and `WAIVER_SUPERSEDED` are
 * `overridable: false` in src/domain/capability/reasons.ts — the comment there
 * says why: "the waiver is the club's legal position if someone is injured on a
 * live range, and it takes about twenty seconds to sign, so the remedy is always
 * faster than the argument." Their remedy is literally "at the desk". Without
 * this file the desk showed a member an unwaivable block whose stated remedy the
 * build could not perform, and scripts/seed.ts plants both cases deliberately.
 *
 * ===========================================================================
 * THIS FILE IS PURE — the same shape as checkin.ts and equipment.ts
 *
 * It builds records and returns them. No IndexedDB, no outbox, no device. The
 * captured mark is passed in as its content type only; the bytes stay with the
 * caller. That keeps the §3.1 rules and the §10 key decision below assertable in
 * a unit test rather than only on hardware with a stylus.
 *
 * ===========================================================================
 * THE SIGNATURE IMAGE, AND WHY IT IS A KEY WRITTEN NOW RATHER THAN LATER
 *
 * `waiver_signatures` is append-only. drizzle/0002 rejects UPDATE at the database
 * level, so whatever `signature_image_url` holds at insert is what it holds
 * forever. There is no backfill. The choice therefore has to be made here, and
 * three of the four available answers are wrong:
 *
 *   · Write null and upload later — impossible. The column can never be filled
 *     in, so every signature taken offline would be permanently imageless, and
 *     those are precisely the ones most likely to be contested later.
 *   · Inline the image as a data URI — §10 keeps documents in a private bucket
 *     behind signed expiring URLs. The column holds a KEY, not a payload, and a
 *     desk surface is the wrong place to start storing bytes in Postgres.
 *   · Hold the write until an upload succeeds — §6.4 requires this to work
 *     offline, and a queue that will not accept a record until the network
 *     returns is not an offline workflow.
 *
 * So: the key is derived from the signature's own UUIDv7 at the moment of
 * signing, and travels in the row. The bytes follow separately whenever there is
 * somewhere to put them.
 *
 * This is not a new pattern here. src/server/armory/licences.ts already does it
 * from the other side — "the id is accepted from the caller so the portal can
 * generate a UUIDv7 before the upload and replay it safely (§7)". A client-chosen
 * identifier that both the row and the object agree on is how this system already
 * separates a record from its attachment.
 *
 * The honest consequence, recorded rather than hidden: between signing and
 * upload the key names an object that does not exist yet. That window is finite,
 * the bytes are on the tablet in `armory-session` throughout it, and no uploader
 * exists yet — the club has no object storage wired up in this repository at all.
 * See the note in docs/M1_offline_acceptance.md.
 */

export type QueuedWrite = {
  readonly id: string;
  readonly operation: "waiver_signatures.create" | "audit_log.create";
  readonly payload: unknown;
};

/**
 * A signature as it lives on the device before the server has seen it.
 *
 * `image` carries the captured mark itself. It is held in the same record rather
 * than in a store of its own so there is one list to read and one thing to keep:
 * a future uploader walks these rows, sends the bytes to `imageKey` and clears
 * the field, and until then the only copy in existence is durable next to the
 * record it belongs to.
 */
export type LocalWaiverSignature = {
  /** UUIDv7. The primary key the row will have on the server, and the image key. */
  readonly id: string;
  readonly personId: string;
  readonly waiverVersionId: string;
  readonly signedAt: string;
  /** §10's object-storage key. Null when the tablet took no mark. */
  readonly imageKey: string | null;
  /** The bytes, until something uploads them. Null once it has, or if none. */
  readonly image: Blob | null;
  /** §10: the officer who witnessed it. Null when no shift is live. */
  readonly witnessedByStaffId: string | null;
};

/** What the caller captured. Bytes stay with the caller; this is the shape. */
export type CapturedSignature = {
  readonly contentType: "image/png" | "image/jpeg";
  readonly bytes: Blob;
};

export type WaiverRefusal = {
  readonly reason: string;
  readonly remedy: string | null;
};

export type WaiverWrites = {
  readonly signature: LocalWaiverSignature;
  readonly queue: readonly QueuedWrite[];
};

export type WaiverResult =
  | { readonly ok: true; readonly writes: WaiverWrites }
  | { readonly ok: false; readonly refusal: WaiverRefusal };

export type SignContext = {
  /** §10. The officer on shift, who watched the member sign. */
  readonly actorStaffId: string | null;
  /** Device clock. The domain time; the server records its own too (§2). */
  readonly now: Date;
  /** The mark, or null when the tablet could not take one. */
  readonly captured: CapturedSignature | null;
};

const EXTENSION: Record<CapturedSignature["contentType"], string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
};

const refuse = (reason: string, remedy: string | null): WaiverResult => ({
  ok: false,
  refusal: { reason, remedy },
});

/**
 * A pack with no waiver text, said once.
 *
 * Exported because two places need these exact words: the builder refuses with
 * them, and the desk says them instead of opening a signing sheet onto a blank
 * document. §4.3 gives a block one sentence; two spellings of it would be two
 * blocks as far as the officer reading them is concerned.
 */
export const NO_WAIVER_TEXT: WaiverRefusal = {
  reason: "This tablet does not have the current waiver text to show.",
  remedy: "Sync while there is a connection, then sign.",
};

/**
 * Build the records for one signature.
 *
 * `alreadySigned` is the signature this device currently believes the person
 * holds — from the pack, from the desk, or the later of the two. It is passed in
 * rather than looked up so this function stays a function of its arguments, and
 * so the caller cannot accidentally check one source while the screen shows the
 * other.
 */
export function buildWaiverSignature(
  indexed: IndexedDayPack,
  input: {
    readonly personId: string;
    readonly alreadySigned: WaiverSignatureSnapshot | null;
  },
  context: SignContext,
): WaiverResult {
  const pack = indexed.pack;

  if (!indexed.personById.has(input.personId)) {
    return refuse(
      "This device does not have that person on file.",
      "Sync while there is a connection.",
    );
  }

  /**
   * A signature is worth nothing if the signer could not read what they signed.
   *
   * The pack carries the active version's text for exactly this moment, and a
   * pack stored before that field existed does not. Refused with a sentence
   * rather than taking a mark against a document the desk could not display —
   * which would produce a row that looks like consent and is not evidence of any.
   */
  if (!pack.activeWaiverBody || !pack.activeWaiverVersion) {
    return refuse(NO_WAIVER_TEXT.reason, NO_WAIVER_TEXT.remedy);
  }

  /**
   * Already signed, and still standing.
   *
   * §3.1 permits a resignature — "a new row", never an edit — so this is not a
   * prohibition on signing twice. It is the guard against the two ways a second
   * row gets written by accident: an officer double-tapping Confirm, and an
   * officer opening the sheet on a row whose block was something else entirely.
   * Both would put two signatures a minute apart in an append-only table, and
   * §7's idempotency cannot catch it because each carries a fresh UUIDv7.
   *
   * Decided on the same two facts the capability service decides on, in the same
   * order: the version must be the active one (§3.1's "exactly one active version
   * at a time"), and the signature must be inside its validity window if the club
   * has set one (null fails open, per §14).
   */
  const signed = input.alreadySigned;
  if (signed && signed.waiverVersionId === pack.activeWaiverVersionId) {
    const stillValid =
      pack.waiverValidityDays === null ||
      signed.signedAt.getTime() + pack.waiverValidityDays * 86_400_000 >
        context.now.getTime();

    if (stillValid) {
      return refuse("This person has already signed the current waiver.", null);
    }
  }

  const id = uuidv7();
  const signedAt = context.now.toISOString();

  /* §10. Derived from the row's own id, so the row and the object agree without
     either being told about the other, and no UPDATE is ever needed to reconcile
     them. No person id in the path: the key is held to the founder role and there
     is no reason for it to name anybody. */
  const imageKey = context.captured
    ? `waivers/${id}.${EXTENSION[context.captured.contentType]}`
    : null;

  return {
    ok: true,
    writes: {
      signature: {
        id,
        personId: input.personId,
        waiverVersionId: pack.activeWaiverVersionId,
        signedAt,
        imageKey,
        image: context.captured?.bytes ?? null,
        witnessedByStaffId: context.actorStaffId,
      },
      queue: [
        {
          /* The record's id IS the queue item's id (§7) — a replay is an insert
             on a key that already exists. Same rule as every other write. */
          id,
          operation: "waiver_signatures.create",
          payload: {
            personId: input.personId,
            waiverVersionId: pack.activeWaiverVersionId,
            signatureImageUrl: imageKey,
            signedAt,
          },
        },
        {
          id: uuidv7(),
          operation: "audit_log.create",
          payload: {
            action: "waiver.sign",
            entityType: "waiver_signature",
            entityId: id,
            occurredAt: signedAt,
            isOverride: false,
            overrideReason: null,
            /* The key is deliberately absent. §10 holds it to the founder role
               and the audit log is read on the dashboard — src/server/armory/
               licences.ts makes the same exclusion for the same reason: "there is
               no reason for a storage key to travel further than the column it
               lives in." */
            after: {
              personId: input.personId,
              waiverVersionId: pack.activeWaiverVersionId,
              signedAt,
            },
          },
        },
      ],
    },
  };
}

/**
 * What this device has taken today, as the capability service wants it.
 *
 * The waiver equivalent of `presentPersonIds` in checkin.ts, and it exists for
 * the same reason: a rule that must clear without a reload has to read local
 * state. Passed to `subjectFor`, which takes the later of this and the pack.
 *
 * Latest per person wins, so a member who signed twice on one tablet — the
 * resignature §3.1 allows — is represented by the one that stands.
 */
export function signedWaivers(
  signatures: readonly LocalWaiverSignature[],
): ReadonlyMap<string, WaiverSignatureSnapshot> {
  const latest = new Map<string, WaiverSignatureSnapshot>();

  for (const signature of signatures) {
    const signedAt = new Date(signature.signedAt);
    const existing = latest.get(signature.personId);

    if (!existing || signedAt.getTime() > existing.signedAt.getTime()) {
      latest.set(signature.personId, {
        waiverVersionId: signature.waiverVersionId,
        signedAt,
      });
    }
  }

  return latest;
}

/**
 * Signatures whose image is still only on this tablet.
 *
 * Not surfaced on the end-of-day screen, deliberately: that screen's list is a
 * close GUARD — anything on it forces an override with a written reason before
 * the range can be locked (see EndOfDay.tsx) — and an officer cannot upload
 * anything, so listing it there would demand a nightly override for a condition
 * no one on the range floor can clear. This is here for the uploader that will
 * read it, and for a founder asking why a key 404s.
 */
export const pendingImages = (
  signatures: readonly LocalWaiverSignature[],
): readonly LocalWaiverSignature[] =>
  signatures.filter((signature) => signature.image !== null);
