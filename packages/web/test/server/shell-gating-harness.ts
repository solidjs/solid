// Shared harness for the shell-gating specs (lazy-shell-gating,
// dynamic-shell-gating). These specs are about ORDER — did the shell flush
// before or after this source settled — and used to prove it with wall-clock
// deltas against timers (`shellAt < DATA`). Under a loaded CI worker the
// event loop stalls past the timer and the delta lies. Here every async
// source is a gate the test settles by hand, so the claim "the shell waited
// for X" is "no shell before X was settled, shell after", with no clock in
// it.
import { renderToStream } from "@solidjs/web";

export interface Gate<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
  /** Whether the gate has been settled (either way). */
  readonly settled: boolean;
}

/** A promise the test settles, with a flag the shell can be checked against. */
export function gate<T = void>(): Gate<T> {
  let settled = false;
  let resolve!: (v: T) => void;
  let reject!: (r: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = v => {
      settled = true;
      res(v);
    };
    reject = r => {
      settled = true;
      rej(r);
    };
  });
  return {
    promise,
    resolve,
    reject,
    get settled() {
      return settled;
    }
  };
}

export interface Collected {
  /** The first chunk, once it flushes. Rejects if it has not within `SHELL_TIMEOUT_MS`. */
  shell: Promise<string>;
  /** The whole response. */
  done: Promise<{ html: string; chunks: number }>;
  /** Whether the first chunk has flushed yet. */
  shellFlushed(): boolean;
  /** The gates that had settled at the moment the shell flushed. */
  settledAtShell: Set<Gate<unknown>>;
}

const SHELL_TIMEOUT_MS = 4000;

/**
 * Render and observe the chunk sequence. `gates` are watched so the test can
 * ask which of them had settled when the shell went out — the ordering fact
 * the wall clock used to stand in for.
 */
export function collect(code: () => any, gates: Gate<any>[] = [], options?: any): Collected {
  let shellFlushed = false;
  const settledAtShell = new Set<Gate<unknown>>();
  let resolveShell!: (s: string) => void;
  let rejectShell!: (e: Error) => void;
  const shell = new Promise<string>((res, rej) => {
    resolveShell = res;
    rejectShell = rej;
  });
  const timer = setTimeout(
    () => rejectShell(new Error(`the shell did not flush within ${SHELL_TIMEOUT_MS}ms`)),
    SHELL_TIMEOUT_MS
  );
  const done = new Promise<{ html: string; chunks: number }>(resolve => {
    const chunks: string[] = [];
    renderToStream(code, options).pipe({
      write: (c: string) => {
        if (!shellFlushed) {
          shellFlushed = true;
          for (const g of gates) if (g.settled) settledAtShell.add(g);
          clearTimeout(timer);
          resolveShell(c);
        }
        chunks.push(c);
      },
      end: () => {
        clearTimeout(timer);
        resolve({ html: chunks.join(""), chunks: chunks.length });
      }
    });
  });
  // A shell that never flushes surfaces through `shell`, not as an unhandled rejection.
  shell.catch(() => {});
  return { shell, done, shellFlushed: () => shellFlushed, settledAtShell };
}

/**
 * Let the renderer do everything it can with the gates as they are: drain
 * microtasks and two macrotask turns. With no timer in the code under test,
 * anything the shell was going to do without our gates has happened by now —
 * so `shellFlushed()` afterwards is the ordering fact, not a race.
 */
export async function drain(): Promise<void> {
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
}
