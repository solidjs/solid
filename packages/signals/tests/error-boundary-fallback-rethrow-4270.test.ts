// #4270: an error rethrown from an inner boundary's fallback is caught by the
// outer boundary, whose source is the inner fallback's computed. The inner
// content recovering disposes that computed; the outer must recover with it.
import {
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  untrack
} from "../src/index.js";

class NotFound extends Error {}
class Other extends Error {}

it.each([false, true])(
  "an outer boundary recovers when the inner fallback that rethrew is replaced by content (nested: %s)",
  nested => {
    const [which, setWhich] = createSignal(0);
    let screen = "";
    createRoot(() => {
      const m = createMemo(() => {
        const w = which();
        if (w === 1) throw new NotFound("nf");
        if (w === 2) throw new Other("other");
        return "ok" + w;
      });
      const makeInner = () =>
        createErrorBoundary(
          () => m(),
          err => {
            const e = err();
            if (!(e instanceof NotFound)) throw e;
            return "inner:" + e.message;
          }
        );
      const inner = nested ? null : untrack(makeInner);
      const outer = untrack(() =>
        createErrorBoundary(
          nested ? makeInner : () => inner!(),
          err => "outer:" + (err() as Error).message
        )
      );
      createRenderEffect(
        () => outer(),
        v => {
          screen = v;
        }
      );
    });
    const seen: string[] = [];
    flush();
    seen.push(screen);
    for (const w of [1, 0, 2, 0, 1, 0]) {
      setWhich(w);
      flush();
      seen.push(screen);
    }
    expect(seen).toEqual(["ok0", "inner:nf", "ok0", "outer:other", "ok0", "inner:nf", "ok0"]);
  }
);
