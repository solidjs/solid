/**
 * #4428 — born held asks the pass that creates the node, not the owner it
 * lives in.
 *
 * D-27 ("a joined pass's children are the hold's"): a pass that read a node
 * with no screen joins the hold, and a node it creates during that pass is
 * born held. The born-held test at a first pass's close asks
 * `creatorPass(oldcontext)` — the nearest computed up the context the first
 * pass ran in. `fallback()` builds the boundary's fallback memo (`b._fb`)
 * beside the output, `runWithOwner(out._parent, …)`, while the output's own
 * pass runs, so its first pass ran in the output's owner — here a mount that
 * read the hold (JOINED) — and the fallback was born held by the enclosing
 * pass's flag, though the pass creating it (the output) read nothing held.
 * The fallback memo is now lazy: its first pass runs in the output's read of
 * it, and born held asks the output, as for a memo the output created under
 * itself.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  getOwner,
  untrack
} from "../src/index.js";
import { CONFIG_HELD, STATUS_UNINITIALIZED } from "../src/core/constants.js";

const settle = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  flush();
};

function hold() {
  const [x, setX] = createSignal(0);
  createRoot(() => createRenderEffect(x, () => {}));
  flush();
  let release!: () => void;
  action(function* () {
    setX(1);
    yield new Promise<void>(r => (release = r));
  })();
  flush();
  return { x, release: () => release() };
}

describe("#4428: the fallback memo is the output's creation", () => {
  it("a Loading fallback built while a joined mount's output runs is not born held", async () => {
    const { x, release } = hold();
    let fb: any;
    const log: unknown[] = [];
    createRoot(() => {
      const content = createMemo(async () => {
        await new Promise(() => {});
        return "C";
      });
      // A mount during the hold whose pass reads the held x: it joins, and
      // is born held itself (D-27 / A29).
      const mount = createMemo(() => {
        const v = x();
        const shown = untrack(() =>
          createLoadingBoundary(
            () => content(),
            () => {
              fb = getOwner();
              return "F";
            }
          )
        );
        return `${v}:${shown()}`;
      });
      createRenderEffect(mount, v => {
        log.push(v);
      });
    });
    flush();
    // The mount waits for the hold (born held) ...
    expect(log).toEqual([]);
    // ... but its fallback memo, created by the output's pass (which read
    // nothing held), publishes: not held, initialized, its value committed.
    expect(fb._config & CONFIG_HELD).toBe(0);
    expect(fb._statusFlags & STATUS_UNINITIALIZED).toBe(0);
    expect(fb._value).toBe("F");
    release();
    await settle();
    expect(log).toEqual(["1:F"]);
  });

  it("a fallback that reads the hold itself is still born held (its own read, D-1)", async () => {
    const { x, release } = hold();
    let fb: any;
    const log: unknown[] = [];
    createRoot(() => {
      const content = createMemo(async () => {
        await new Promise(() => {});
        return "C";
      });
      const shown = untrack(() =>
        createLoadingBoundary(
          () => content(),
          () => {
            fb = getOwner();
            return `F${x()}`;
          }
        )
      );
      createRenderEffect(shown, v => {
        log.push(v);
      });
    });
    flush();
    expect(fb._config & CONFIG_HELD).not.toBe(0);
    expect(log).toEqual([]);
    release();
    await settle();
    expect(log).toEqual(["F1"]);
  });
});
