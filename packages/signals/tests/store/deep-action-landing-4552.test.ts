/**
 * #4552 — deep()/snapshot() see an action's writes in the pass the action
 * lands in, as the per-key reads beside them do.
 *
 * A per-key read of a key a held container changed asks core for the
 * container's frame (`readSource` → `read()` of the container node without
 * a link), and so does `deep()`'s enumeration walk (`enumerationSource`):
 * the hold's own pass — the landing flush, a memo or effect that joined the
 * hold — is served the staging. `snapshot()`'s composition tested the
 * container's HELD flag instead, which stands until the seam, so in the
 * landing flush it composed the committed backing while the keys it walked
 * and the per-key reads beside it already served the landing. Nothing
 * re-runs after the commit, so the stale value stuck.
 *
 * Ruling pinned here (#3147's, applied): the held-landing visibility
 * decision is ONE decision, core's on the container node, shared by per-key
 * reads, `deep()`'s walk and `snapshot()`'s composition.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createEffect,
  createMemo,
  createRoot,
  createStore,
  deep,
  flush,
  snapshot
} from "../../src/index.js";

const settle = async (n = 4) => {
  for (let i = 0; i < n; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

type State = { a: number; b: number };

/** An action writing `a` before its yield and `b` after it; the gate between
 * them is released by the caller. */
function gatedAction(setState: (fn: (s: State) => void) => void, afterYield: boolean) {
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  const done = action(function* () {
    setState(d => {
      d.a = 1;
    });
    yield gate;
    if (afterYield)
      setState(d => {
        d.b = 1;
      });
  })();
  return { release, done };
}

describe("#4552: deep()/snapshot() see an action's writes when it lands", () => {
  it("an effect over deep(), snapshot() and per-key reads sees one frame at the landing", async () => {
    const [state, setState] = createStore<State>({ a: 0, b: 0 });
    const seen: any[] = [];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      createEffect(
        () => ({ deep: deep(state), snap: snapshot(state), a: state.a, b: state.b }),
        v => void seen.push(v)
      );
    });
    await settle();
    expect(seen).toEqual([{ deep: { a: 0, b: 0 }, snap: { a: 0, b: 0 }, a: 0, b: 0 }]);

    const { release, done } = gatedAction(setState, true);
    await settle();
    // Held: nothing reaches the effect's callback while the action runs.
    expect(seen).toHaveLength(1);

    release();
    await done;
    await settle();
    expect(seen).toHaveLength(2);
    expect(seen.at(-1)).toEqual({ deep: { a: 1, b: 1 }, snap: { a: 1, b: 1 }, a: 1, b: 1 });
    dispose();
    flush();
  });

  it("a memo over deep() ends equal to the store", async () => {
    const [state, setState] = createStore<State>({ a: 0, b: 0 });
    let m!: () => State;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      m = createMemo(() => deep(state));
      createEffect(
        () => m(),
        () => {}
      );
    });
    await settle();
    expect(m()).toEqual({ a: 0, b: 0 });

    const { release, done } = gatedAction(setState, true);
    await settle();
    release();
    await done;
    await settle();
    expect(snapshot(state)).toEqual({ a: 1, b: 1 });
    expect(m()).toEqual({ a: 1, b: 1 });
    dispose();
    flush();
  });

  it("a write before the yield only lands in deep() too (already worked)", async () => {
    const [state, setState] = createStore<State>({ a: 0, b: 0 });
    const seen: any[] = [];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      createEffect(
        () => ({ deep: deep(state), snap: snapshot(state), a: state.a, b: state.b }),
        v => void seen.push(v)
      );
    });
    await settle();

    const { release, done } = gatedAction(setState, false);
    await settle();
    release();
    await done;
    await settle();
    expect(seen.at(-1)).toEqual({ deep: { a: 1, b: 0 }, snap: { a: 1, b: 0 }, a: 1, b: 0 });
    dispose();
    flush();
  });

  it("the same writes without an action, stepped by hand, land in deep() (already worked)", async () => {
    const [state, setState] = createStore<State>({ a: 0, b: 0 });
    const seen: any[] = [];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      createEffect(
        () => ({ deep: deep(state), snap: snapshot(state), a: state.a, b: state.b }),
        v => void seen.push(v)
      );
    });
    await settle();

    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    const body = function* () {
      setState(d => {
        d.a = 1;
      });
      yield gate;
      setState(d => {
        d.b = 1;
      });
    };
    const it = body();
    const first = it.next();
    await settle();
    expect(seen.at(-1)).toEqual({ deep: { a: 1, b: 0 }, snap: { a: 1, b: 0 }, a: 1, b: 0 });
    release();
    await first.value;
    it.next();
    await settle();
    expect(seen.at(-1)).toEqual({ deep: { a: 1, b: 1 }, snap: { a: 1, b: 1 }, a: 1, b: 1 });
    dispose();
    flush();
  });
});
