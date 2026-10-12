// Fractional ordering. A row's `pos` is a string that sorts between its
// neighbours', so a move writes one row and never renumbers a list. Shared by
// both sides: the client computes the key for its optimistic write, the
// server checks its shape and stores it.
//
// Keys are base-62 fractions with the point in front ("V" is a half, "0V" a
// hundred-and-twenty-fourth) and never end in "0", which keeps room below
// every key. Plain string comparison orders them.
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const KEY = /^[0-9A-Za-z]{1,64}$/;

/** Whether `pos` is a key `between` could have produced. */
export function isKey(pos: unknown): pos is string {
  return typeof pos === "string" && KEY.test(pos) && !pos.endsWith("0");
}

/**
 * A key strictly between `a` and `b`. Omit `a` for "before everything",
 * `b` for "after everything". Throws when there is no room, which is only
 * when `a >= b`: two tabs that dropped into the same gap minted the same
 * key, and the caller orders those rows by id and picks other neighbours.
 */
export function between(a?: string, b?: string): string {
  if (a !== undefined && b !== undefined && a >= b) {
    throw new RangeError(`No key between "${a}" and "${b}"`);
  }
  return midpoint(a ?? "", b);
}

function midpoint(a: string, b: string | undefined): string {
  if (b !== undefined) {
    // Skip what the two share (a short `a` reads as padded with zeros).
    let n = 0;
    while ((a[n] ?? "0") === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const low = a ? DIGITS.indexOf(a[0]) : 0;
  const high = b !== undefined ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (high - low > 1) return DIGITS[(low + high) >> 1];
  // Neighbouring digits: either `b`'s first digit alone is already between
  // them, or the room is to the right of `a`.
  if (b !== undefined && b.length > 1) return b[0];
  return DIGITS[low] + midpoint(a.slice(1), undefined);
}

/** Rows in display order: by key, then by id where two tabs minted the same key. */
export function byPos<T extends { pos: string; id: string }>(a: T, b: T): number {
  return a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
