/**
 * Dev: duplicate-copy detection.
 *
 * Two copies of Solid on a page are only a bug when they meet: one copy's
 * code runs inside the other's computation or component and finds no owner
 * or listener of its own (each copy keeps them in its own module state), so
 * it neither reacts nor sees the other's providers. That is the shape of
 * every duplicate report on record: a library's precompiled JSX on copy B
 * reading the app's props or signals from copy A, a runtime that bundled its
 * own solid-js. Copies that never meet (a devtools panel rendering into its
 * own root, an isolated widget) are fine at any version, so nothing is
 * checked when a copy loads.
 *
 * Every copy from 2.0 on shares one global record, `Solid$$copies`. It is a
 * contract between all future versions of Solid, so its shape never changes:
 *
 * - `copies`: each copy adds 1 when it loads.
 * - `running`: while `copies > 1`, each copy names itself here (an object
 *   with a `rooted` boolean, compared by identity) around its computations
 *   and components, and restores the previous value after.
 *
 * A copy that sees `copies < 2` skips the slot entirely, so a page with one
 * copy pays one property read per check. v1 keeps its own load-time `Solid$$`
 * check, which this never sets, so neither side warns about the other.
 */
interface SolidCopy {
  /** This copy has created a root of its own (it renders by itself). */
  rooted: boolean;
}

interface SolidCopies {
  copies: number;
  running: SolidCopy | undefined;
}

declare global {
  var Solid$$copies: SolidCopies | undefined;
}

const COPY: SolidCopy = { rooted: false };
let warned = false;
let shared: SolidCopies;

if (__DEV__) {
  shared = globalThis.Solid$$copies ||= { copies: 0, running: undefined };
  shared.copies++;
}

function warnOnce(detail: string): void {
  if (warned) return;
  warned = true;
  console.warn(
    `You appear to have multiple instances of Solid: ${detail} Make sure every package resolves the same solid-js (e.g. \`resolve.dedupe\` in Vite) and that libraries keep solid-js external.`
  );
}

export function markCopyRooted(): void {
  COPY.rooted = true;
}

/**
 * Marks this copy as the one running; returns the slot's previous value. A
 * nested run of the same copy (most runs inside a flush) only reads the slot.
 */
export function enterCopy(): SolidCopy | undefined {
  if (!__DEV__ || shared.copies < 2) return COPY;
  const prev = shared.running;
  if (prev !== COPY) shared.running = COPY;
  return prev;
}

export function exitCopy(prev: SolidCopy | undefined): void {
  if (prev !== COPY) shared.running = prev;
}

/** @internal Runs `fn` with this copy marked as the one running. */
export function runAsSolidCopy<T>(fn: () => T): T {
  if (!__DEV__ || shared.copies < 2) return fn();
  const prev = enterCopy();
  try {
    return fn();
  } finally {
    exitCopy(prev);
  }
}

/** @internal An ownerless component or context read: warns if another copy is running. */
export function checkForeignOwnerless(): void {
  if (!__DEV__ || shared.copies < 2) return;
  const running = shared.running;
  if (running && running !== COPY)
    warnOnce(
      "a component or useContext() from one copy ran inside a component rendered by another, so it has no owner and will not react or find its providers."
    );
}

/**
 * An untracked read: warns if another copy's computation is running, unless
 * both copies render through roots of their own (an app calling into an
 * isolated copy's API, which reads its own state untracked by design).
 */
export function checkForeignRead(): void {
  if (!__DEV__ || shared.copies < 2) return;
  const running = shared.running;
  if (running && running !== COPY && !(running.rooted && COPY.rooted))
    warnOnce(
      "a signal or store from one copy was read inside a computation of another, so the read is not tracked and will not update."
    );
}
