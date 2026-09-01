// Minimal repro: `isPending` defers superseded-flight teardown.
//
// When a memo's async-iterable flight is superseded, Solid normally closes
// the stale iterator (`it.return()`) immediately at recompute — verified here
// with a plain reader, with a fresh-mounted reader, and with a reader under
// `createLoadingBoundary` using `latest`. But adding a single
// `isPending(() => m())` read to the boundary content changes the behavior:
// the superseded iterator is left running (it "lands" a value that flight
// identity then discards) and `return()` only fires after the SUPERSEDING
// flight settles. Toggle the `isPending` line below to flip between the two
// behaviors. Discovered via examples/effect, where superseded search fibers
// (Effect) should be interrupted eagerly at supersede time.
//
// Run: node repro-close-timing.mjs
import {
  createRoot,
  createSignal,
  createMemo,
  createEffect,
  createLoadingBoundary,
  isPending,
  latest,
  flush
} from "../../packages/signals/dist/dev.js";

const t0 = performance.now();
const stamp = () => (performance.now() - t0).toFixed(0).padStart(5) + "ms";
const events = [];
const note = msg => events.push(`${stamp()}  ${msg}`);

function source(label, ms) {
  return {
    [Symbol.asyncIterator]() {
      note(`open  ${label}`);
      let done = false;
      return {
        async next() {
          if (done) return { done: true, value: undefined };
          await new Promise(r => setTimeout(r, ms));
          if (done) return { done: true, value: undefined };
          done = true;
          note(`land  ${label}`);
          return { done: false, value: label };
        },
        async return() {
          note(`close ${label}`);
          done = true;
          return { done: true, value: undefined };
        }
      };
    }
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const { setQ, mountReader } = createRoot(() => {
  const [q, set] = createSignal("");
  const m = createMemo(() => {
    const v = q();
    return v ? source(v, 400) : [];
  });
  // Mimics <Show> flipping on AFTER the flight-triggering write: the memo's
  // first pull of the in-flight compute comes from a freshly created reader.
  const mount = () =>
    createRoot(() => {
      // Approximates the browser structure: reader content lives under a
      // fresh <Loading> boundary created in the same flush as the flight.
      const view = createLoadingBoundary(
        () => {
          try {
            // Comment out this isPending read → closes become eager again.
            const pending = isPending(() => m());
            return { pending, value: latest(() => m()) };
          } catch {
            return undefined;
          }
        },
        () => "loading-fallback"
      );
      createEffect(
        () => view(),
        () => {}
      );
    });
  return { setQ: set, mountReader: mount };
});
flush();

(async () => {
  note("-- fresh-reader case: write 'a', THEN mount reader, then supersede");
  setQ("a");
  flush(); // memo not pulled yet (no observers) — like an unmounted region
  mountReader();
  flush(); // reader's first run pulls the 'a' flight
  await sleep(100);
  note("write 'ab' (supersedes 'a')");
  setQ("ab");
  flush();
  await sleep(800);

  note("-- steady-state control: supersede 'c' with 'cd' under same reader");
  setQ("c");
  flush();
  await sleep(100);
  note("write 'cd' (supersedes 'c')");
  setQ("cd");
  flush();
  await sleep(800);

  console.log(events.join("\n"));
})();
