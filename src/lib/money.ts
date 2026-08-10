/**
 * MONEY — integer kobo, never floats.
 *
 * Build Specification §2: "All amounts stored as integer kobo. Never floats.
 * NGN only at launch."
 *
 * ===========================================================================
 * WHY A MODULE RATHER THAN A CONVENTION
 *
 * The rule is easy to state and easy to break. `total / 100` appears in a
 * template, a rounding error appears in a founder's revenue report, and the
 * club reconciles a bar float against a number that was never right. So kobo
 * are a distinct type in the type system: `Kobo` is a branded number, and the
 * only way to obtain one is through a constructor that has already rejected
 * fractions, infinities and negatives-where-forbidden.
 *
 * Formatting is one-way on purpose. There is a kobo → string function and no
 * string → kobo function that accepts "₦12,500.00" — parsing formatted money
 * back is where currency bugs come from. Input is collected in naira and minor
 * units as separate integers, or in kobo directly.
 */

/**
 * A monetary amount in kobo. 100 kobo = ₦1.
 *
 * Branded so that a plain number cannot be passed where an amount is expected.
 * The brand costs nothing at runtime and catches the one mistake that matters:
 * a naira figure reaching a kobo column, silently understating every amount in
 * the system by a factor of a hundred.
 */
export type Kobo = number & { readonly __brand: "kobo" };

/** 2^53 - 1 kobo is ₦90 trillion. The ceiling is a sanity bound, not a limit. */
const MAX_KOBO = Number.MAX_SAFE_INTEGER;

export class MoneyError extends Error {}

/**
 * Construct an amount from a kobo integer.
 *
 * Throws rather than clamping or rounding. An amount that cannot be
 * represented exactly is a bug upstream, and the correct response is to stop —
 * a silently rounded charge is a dispute with a member six weeks later.
 */
export function kobo(value: number): Kobo {
  if (!Number.isFinite(value)) {
    throw new MoneyError(`Amount is not a finite number: ${value}`);
  }
  if (!Number.isInteger(value)) {
    throw new MoneyError(
      `Amount must be a whole number of kobo, received ${value}. ` +
        "Fractional kobo do not exist; round at the point the price is set, " +
        "not at the point it is stored.",
    );
  }
  if (Math.abs(value) > MAX_KOBO) {
    throw new MoneyError(`Amount exceeds the representable range: ${value}`);
  }
  return value as Kobo;
}

/** Construct from whole naira. `naira(12_500)` → 1,250,000 kobo. */
export function naira(value: number): Kobo {
  if (!Number.isInteger(value)) {
    throw new MoneyError(
      `naira() takes whole naira; received ${value}. For an amount with ` +
        "minor units use fromParts(naira, kobo).",
    );
  }
  return kobo(value * 100);
}

/** Construct from naira and kobo parts, as they are entered on a form. */
export function fromParts(nairaPart: number, koboPart: number): Kobo {
  if (!Number.isInteger(nairaPart) || !Number.isInteger(koboPart)) {
    throw new MoneyError("Both parts must be whole numbers.");
  }
  if (koboPart < 0 || koboPart > 99) {
    throw new MoneyError(`Kobo part must be 0–99, received ${koboPart}.`);
  }
  const sign = nairaPart < 0 ? -1 : 1;
  return kobo(nairaPart * 100 + sign * koboPart);
}

export const ZERO = kobo(0);

/* ---------------------------------------------------------------------------
   ARITHMETIC

   Closed over Kobo: adding two amounts gives an amount, and there is no
   operation that produces a fraction. Division is deliberately absent —
   splitting a charge is `allocate()`, which cannot lose a kobo.
   -------------------------------------------------------------------------- */

export const add = (...amounts: readonly Kobo[]): Kobo =>
  kobo(amounts.reduce<number>((total, amount) => total + amount, 0));

export const subtract = (a: Kobo, b: Kobo): Kobo => kobo(a - b);

/** Multiply by a whole quantity — four guest visits at the overage price. */
export const times = (amount: Kobo, quantity: number): Kobo => {
  if (!Number.isInteger(quantity)) {
    throw new MoneyError(
      `Quantity must be a whole number, received ${quantity}. To take a ` +
        "percentage or a share, use allocate().",
    );
  }
  return kobo(amount * quantity);
};

/**
 * Split an amount into whole-kobo shares that sum EXACTLY to the original.
 *
 * The classic failure this exists to prevent: ₦100 split three ways as
 * 33.33 + 33.33 + 33.33 = ₦99.99, and one kobo vanishes from the ledger. Here
 * the remainder is distributed a kobo at a time across the shares in order, so
 * the total is always preserved and the distribution is deterministic.
 */
export function allocate(amount: Kobo, ratios: readonly number[]): Kobo[] {
  if (ratios.length === 0) throw new MoneyError("Cannot allocate to no shares.");
  if (ratios.some((r) => r < 0)) {
    throw new MoneyError("Allocation ratios must not be negative.");
  }

  const total = ratios.reduce((sum, r) => sum + r, 0);
  if (total <= 0) throw new MoneyError("Allocation ratios must sum above zero.");

  const shares = ratios.map((ratio) =>
    Math.floor((amount * ratio) / total),
  );
  let remainder = amount - shares.reduce((sum, share) => sum + share, 0);

  /* Hand out the remaining kobo one at a time, largest ratio first, so the
     distribution is stable rather than dependent on floating-point order. */
  const order = ratios
    .map((ratio, index) => ({ ratio, index }))
    .sort((a, b) => b.ratio - a.ratio || a.index - b.index);

  for (let i = 0; remainder > 0; i = (i + 1) % order.length) {
    shares[order[i].index] += 1;
    remainder -= 1;
  }

  return shares.map((share) => kobo(share));
}

export const isZero = (amount: Kobo): boolean => amount === 0;
export const isNegative = (amount: Kobo): boolean => amount < 0;
export const compare = (a: Kobo, b: Kobo): number => (a < b ? -1 : a > b ? 1 : 0);

/* ---------------------------------------------------------------------------
   FORMATTING

   Rendered Nigerian naira. One-way, for the reason in the header comment.
   -------------------------------------------------------------------------- */

/**
 * "₦12,500.00", or "₦12,500" when the minor units are zero.
 *
 * Trailing ".00" is dropped by default because club prices are whole naira and
 * the decimals are noise on a tier card. Pass `{ minorUnits: true }` on a
 * statement or an invoice line, where alignment matters more than brevity.
 */
export function format(
  amount: Kobo,
  options: { minorUnits?: boolean; symbol?: boolean } = {},
): string {
  const { minorUnits = false, symbol = true } = options;

  const negative = amount < 0;
  const absolute = Math.abs(amount);
  const major = Math.floor(absolute / 100);
  const minor = absolute % 100;

  const grouped = major.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body =
    minorUnits || minor !== 0
      ? `${grouped}.${minor.toString().padStart(2, "0")}`
      : grouped;

  return `${negative ? "-" : ""}${symbol ? "₦" : ""}${body}`;
}

/**
 * What Paystack expects. §9: "Amounts in kobo throughout."
 *
 * A named function rather than passing the number directly, so that the one
 * place the boundary is crossed is greppable — and so that if a second gateway
 * ever wants naira, the conversion has an obvious home rather than being
 * inlined at the call site.
 */
export const toPaystackAmount = (amount: Kobo): number => {
  if (amount <= 0) {
    throw new MoneyError("Paystack will not charge a zero or negative amount.");
  }
  return amount;
};

/** Parse an amount coming back from the gateway or out of the database. */
export const fromStorage = (value: number | string | null | undefined): Kobo => {
  if (value === null || value === undefined) return ZERO;
  return kobo(typeof value === "string" ? Number.parseInt(value, 10) : value);
};
