/**
 * UUIDv7 — the identity of every record in the management system.
 *
 * ===========================================================================
 * WHY THIS FUNCTION EXISTS AT ALL
 *
 * Build Specification §2: "UUIDv7 for all primary keys, generated client-side
 * where the record can originate offline. Offline-created records must not
 * require a server round trip to obtain an identity."
 *
 * That requirement is not about elegance. It is what makes §7's idempotency
 * possible: because the DEVICE names the row, a queued write delivered twice
 * is an upsert on a primary key that already exists, not a second insert. §7
 * calls that "the single most important API requirement in the system", and it
 * rests entirely on identity being generated before the network is involved.
 *
 * A database default could not do this. `gen_random_uuid()` runs on the
 * server, which is precisely where the tablet cannot reach at the moment the
 * range officer issues a firearm during a power cut.
 *
 * ===========================================================================
 * WHY v7 RATHER THAN v4
 *
 * v7 puts a millisecond timestamp in the high bits, so ids sort by creation
 * time. Three consequences the system actually depends on:
 *
 *   · B-tree locality. Random v4 keys scatter inserts across the whole index;
 *     v7 appends. On the custody log — append-only, never deleted, growing for
 *     the life of the club — that is the difference between an index that
 *     stays warm and one that does not.
 *   · A replayed outbox (§8.4) preserves order without a sequence column.
 *   · An id is legible: it carries when the record was made on the device,
 *     which is exactly what a reconciliation argument needs.
 *
 * It is NOT a substitute for `occurred_at`. Time in an id is a hint from a
 * device whose clock may be wrong; the spec's rule that client and server
 * clocks are both recorded still holds everywhere.
 *
 * ===========================================================================
 * LAYOUT (RFC 9562 §5.7)
 *
 *   0                   1                   2                   3
 *   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 *  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 *  |                       unix_ts_ms (48 bits)                    |
 *  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 *  |  ver (4) |        rand_a (12)      |var(2)|   rand_b (62)      |
 *  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 */

/**
 * Monotonic guard.
 *
 * Two records created in the same millisecond would otherwise sort
 * arbitrarily, and the desk genuinely does produce them — checking in a party
 * of four is four inserts inside one tick. Within a millisecond we increment
 * the 12-bit rand_a counter, which preserves both uniqueness and issue order.
 *
 * If the counter saturates (4096 ids in one millisecond, far beyond anything
 * this system will do) we wait for the clock rather than emit an id that sorts
 * backwards.
 */
let lastTimestamp = -1;
let counter = 0;

/** Cryptographically secure randomness, in the browser and on the server. */
function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  /* globalThis.crypto is present in modern browsers, in Node 19+, and in every
     edge runtime. No `require("crypto")` fallback: a build that silently used
     Math.random for the identity of a custody event would be worse than one
     that failed. */
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

const HEX = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, "0"),
);

/**
 * A new UUIDv7.
 *
 * `now` is injectable so tests can assert ordering and the monotonic guard
 * without sleeping.
 */
export function uuidv7(now: number = Date.now()): string {
  let timestamp = now;

  if (timestamp === lastTimestamp) {
    counter += 1;
    if (counter > 0x0fff) {
      /* Saturated. Borrow from the next millisecond rather than wrap the
         counter — an id that sorts before its predecessor breaks the ordering
         property the outbox relies on. */
      timestamp += 1;
      lastTimestamp = timestamp;
      counter = 0;
    }
  } else if (timestamp > lastTimestamp) {
    lastTimestamp = timestamp;
    counter = 0;
  } else {
    /* The clock went backwards — NTP correction, or a tablet whose battery
       died and came back with a bad time. Hold the last timestamp and keep
       counting, so ids stay unique and ordered even while the clock is wrong.
       The true time of the event lives in occurred_at, not here. */
    counter += 1;
    timestamp = lastTimestamp;
  }

  const bytes = new Uint8Array(16);

  /* 48-bit big-endian millisecond timestamp. Written with division rather than
     bit shifts: JavaScript bitwise operators coerce to 32 bits, which would
     silently truncate a 48-bit value. */
  bytes[0] = Math.floor(timestamp / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(timestamp / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(timestamp / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(timestamp / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(timestamp / 2 ** 8) & 0xff;
  bytes[5] = timestamp & 0xff;

  /* Version 7 in the high nibble of byte 6, then the 12-bit counter. */
  bytes[6] = 0x70 | ((counter >>> 8) & 0x0f);
  bytes[7] = counter & 0xff;

  const random = randomBytes(8);
  /* RFC 4122 variant: binary 10 in the two high bits of byte 8. */
  bytes[8] = (random[0] & 0x3f) | 0x80;
  for (let i = 1; i < 8; i += 1) bytes[8 + i] = random[i];

  return (
    HEX[bytes[0]] + HEX[bytes[1]] + HEX[bytes[2]] + HEX[bytes[3]] + "-" +
    HEX[bytes[4]] + HEX[bytes[5]] + "-" +
    HEX[bytes[6]] + HEX[bytes[7]] + "-" +
    HEX[bytes[8]] + HEX[bytes[9]] + "-" +
    HEX[bytes[10]] + HEX[bytes[11]] + HEX[bytes[12]] +
    HEX[bytes[13]] + HEX[bytes[14]] + HEX[bytes[15]]
  );
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Whether a string is a well-formed UUIDv7.
 *
 * Every write endpoint validates the client-supplied id with this before it
 * reaches the database (§7). A device is permitted to name its own rows, which
 * makes the id untrusted input on a public-facing surface — the guest link
 * posts one — so it is checked for shape and version, never merely for length.
 */
export function isUuidv7(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!UUID_PATTERN.test(value)) return false;
  /* Version nibble, and the RFC 4122 variant bits. */
  if (value[14] !== "7") return false;
  const variant = Number.parseInt(value[19], 16);
  return variant >= 0x8 && variant <= 0xb;
}

/**
 * The millisecond timestamp embedded in a v7 id.
 *
 * Used by the outbox to report queue age on the desk (§8.4: "Depth and
 * last-sync time are visible on the desk at all times"), and by nothing that
 * makes a decision — see the warning above about device clocks.
 */
export function uuidv7Timestamp(value: string): number | null {
  if (!isUuidv7(value)) return null;
  return Number.parseInt(value.slice(0, 8) + value.slice(9, 13), 16);
}
