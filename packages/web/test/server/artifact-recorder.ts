/**
 * The artifact recorder: the one way a server spec renders a fixture and
 * writes what the hydrate project (test/hydration, test/consistency) replays
 * from test/harness/__artifacts__/.
 *
 * Why a fake clock. A fixture's flush points are timers (`sleep(5)`,
 * `sleep(15)`, `sleep(60)`…) and the stream coalesces whatever settles in one
 * event-loop turn into one chunk (`deferFlush` in src/server.ts). On real
 * timers the chunking is the host's: two 60 ms timers created microseconds
 * apart straddle a millisecond boundary and fire in two turns (two chunks)
 * or do not (one chunk); under load — the parallel server suite, a CI
 * runner — a stalled loop finds a 20 ms and a 60 ms timer both due and the
 * LATER one's writes can land first, and a 5 ms event can trail a 15 ms
 * promise. Every such run re-records the artifact, and the hydrate half may
 * pass against either form, so the drift shows up as a dirty tree — or as a
 * CI red on the one consumer that does care about chunk indices
 * (test/consistency/generic, #3849).
 *
 * So the render runs on a fake clock stepped one millisecond at a time
 * (`setTimeout` / `setImmediate` faked; `deferFlush` captured the real
 * `setImmediate` at module load and keeps it). Every timer the fixture
 * created fires at its own instant in creation order, each step yields to
 * the real event loop so a burst's microtask chain and then its flush run
 * before the next step, and timers due at the same instant flush together
 * (the clock's own continuation is queued ahead of the burst's flush, as a
 * real loop runs same-instant timers before its check phase). The recording
 * is a function of the fixture — one chunk per distinct timer instant — on
 * every host. (What #3849 did for generic-hydration.gen.spec.tsx, for every
 * artifact.)
 */
import { vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStream } from "@solidjs/web";

export const artifactsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../harness/__artifacts__"
);
mkdirSync(artifactsDir, { recursive: true });

type StreamOptions = NonNullable<Parameters<typeof renderToStream>[1]>;

export interface Recording {
  /** Every write up to and including the one that carried the completed shell. */
  shell: string;
  /** Each later flush — one entry per chunk a consumer would receive. */
  chunks: string[];
  /** `chunks` joined: the response after the shell. */
  rest: string;
}

// Fixtures settle within ~100 ms of fake time; a render still open this far
// in is stuck. Every step costs one real macrotask, so the cap also keeps a
// stuck render inside vitest's test timeout, with a message that says what
// happened instead of a bare timeout.
const MAX_FAKE_MS = 2000;

/**
 * Render `code` through `renderToStream` on a fake clock stepped 1 ms at a
 * time until the stream ends; the shell and each later chunk. `options` are
 * the render's (`plugins`, …; `onCompleteShell` is chained).
 *
 * Build the fixture INSIDE `code`. A timer the fixture starts before the
 * recording — a `sleep(15)` at construction — runs on the real clock and
 * races the stepped one, which is the host's timing back again.
 */
export async function recordStream(
  code: () => any,
  options: StreamOptions = {}
): Promise<Recording> {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setImmediate", "clearImmediate"] });
  try {
    const chunks: string[] = [];
    let shell: string | undefined;
    let shellDone = false;
    let ended = false;
    renderToStream(code, {
      ...options,
      onCompleteShell(info) {
        shellDone = true;
        options.onCompleteShell?.(info);
      }
    }).pipe({
      write(chunk: string) {
        chunks.push(chunk);
        if (shellDone && shell === undefined) shell = chunks.splice(0).join("");
      },
      end() {
        if (shell === undefined) shell = chunks.splice(0).join("");
        ended = true;
      }
    });
    for (let ms = 0; ms < MAX_FAKE_MS && !ended; ms++) await vi.advanceTimersByTimeAsync(1);
    if (!ended) {
      throw new Error(
        `recordStream: the render did not end within ${MAX_FAKE_MS} ms of fake time ` +
          `(${shell === undefined ? "no shell yet" : `${chunks.length} chunk(s) after the shell`})`
      );
    }
    return { shell: shell!, chunks, rest: chunks.join("") };
  } finally {
    vi.useRealTimers();
  }
}

/**
 * Write `__artifacts__/<name>.json`.
 *
 * Locally the artifact is simply (re)written — it is committed so a change
 * in what the compiler + runtime produce shows up in the diff. Under CI the
 * checkout IS the committed artifact and nothing changed between it and this
 * run, so a recording that differs from it fails the test instead of
 * silently re-recording: either the artifact was not re-recorded with the
 * change that moved it (run the server suite and commit it), or the recorder
 * is not deterministic for this fixture. The committed artifacts are the
 * native compiler's; a `JSX_COMPILER=babel` run is an A/B and only writes.
 */
export function writeArtifact(name: string, data: unknown): void {
  const file = resolve(artifactsDir, `${name}.json`);
  const next = JSON.stringify(data, null, 2);
  const prev = existsSync(file) ? readFileSync(file, "utf-8") : undefined;
  if (prev === next) return;
  writeFileSync(file, next);
  const ci = process.env.CI && process.env.CI !== "false" && process.env.CI !== "0";
  if (!ci || process.env.JSX_COMPILER === "babel") return;
  throw new Error(
    prev === undefined
      ? `artifact ${name}.json is not committed: this run wrote it fresh. Run the server ` +
          `suite locally and commit test/harness/__artifacts__/${name}.json.`
      : `artifact ${name}.json changed on a run that did not change its fixture — ` +
          `${firstDifference(prev, next)}. Either the change that moved it was committed ` +
          `without re-recording (run the server suite locally and commit the artifact), ` +
          `or the recorder is nondeterministic for this fixture.`
  );
}

function firstDifference(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const around = (s: string) => JSON.stringify(s.slice(Math.max(0, i - 40), i + 80));
  return `first difference at offset ${i}: committed ${around(a)} vs recorded ${around(b)}`;
}
