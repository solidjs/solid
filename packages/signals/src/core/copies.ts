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
 * Every copy from 2.0 on shares one global slot naming the copy whose
 * computation or component is running. v1 keeps its own load-time `Solid$$`
 * check, which this never sets, so neither side warns about the other.
 */
interface SolidCopy {
  /** This copy has created a root of its own (it renders by itself). */
  rooted: boolean;
}

declare global {
  var Solid$$running: SolidCopy | undefined;
}

const COPY: SolidCopy = { rooted: false };
let warned = false;

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

/** Marks this copy as the one running; returns the slot's previous value. */
export function enterCopy(): SolidCopy | undefined {
  const prev = globalThis.Solid$$running;
  globalThis.Solid$$running = COPY;
  return prev;
}

export function exitCopy(prev: SolidCopy | undefined): void {
  globalThis.Solid$$running = prev;
}

/** @internal Runs `fn` with this copy marked as the one running. */
export function runAsSolidCopy<T>(fn: () => T): T {
  const prev = enterCopy();
  try {
    return fn();
  } finally {
    exitCopy(prev);
  }
}

/** @internal An ownerless component or context read: warns if another copy is running. */
export function checkForeignOwnerless(): void {
  const running = globalThis.Solid$$running;
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
  const running = globalThis.Solid$$running;
  if (running && running !== COPY && !(running.rooted && COPY.rooted))
    warnOnce(
      "a signal or store from one copy was read inside a computation of another, so the read is not tracked and will not update."
    );
}
