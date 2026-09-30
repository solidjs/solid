/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */

/**
 * #3698 — the report: a `<Show>` over an optimistic value held an unrelated
 * synchronous write for the lifetime of the action that wrote the optimism.
 *
 * `Show`'s condition memo owns a child (the compiler emits a memo inside the
 * `when` getter), and a lane pass over a memo that owns children parked the
 * previous children as a transaction zombie — which queued and stamped the
 * memo as the action's pending node and made its next mainline recompute
 * re-enter the hold (signals: optimistic-read-lane-not-transaction-3698).
 * Reading an active override is lane work, not a transaction entry (#3460
 * ruling): `drag()` publishes at once, is not pending, and the content hides,
 * while the action stays open.
 */
import { describe, expect, test } from "vitest";
import { action, createOptimistic, createSignal, flush, isPending, latest, Show } from "solid-js";
import { render } from "@solidjs/web";

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function snapshot(div: HTMLElement) {
  return Array.from(div.querySelectorAll("p"))
    .map(p => p.textContent)
    .join(" | ");
}

describe("#3698 <Show> over an optimistic value", () => {
  for (const keyed of [true, false]) {
    test(`keyed=${keyed}: an unrelated sync write during the action publishes at once and hides the content`, async () => {
      const div = document.createElement("div");
      document.body.appendChild(div);
      let resolveMove!: () => void;
      let setDrag!: (v: boolean) => void;
      let move!: () => Promise<void>;
      function App() {
        const [optimistic, setOptimistic] = createOptimistic(false);
        const [drag, sd] = createSignal(false);
        setDrag = sd;
        move = action(function* () {
          setOptimistic(true);
          yield new Promise<void>(r => (resolveMove = r));
        });
        return (
          <>
            <p>opt: {String(optimistic())}</p>
            <p>drag: {String(drag())}</p>
            <p>latest: {String(latest(drag))}</p>
            <p>pending: {String(isPending(drag))}</p>
            <Show when={optimistic() && !drag()} keyed={keyed as any}>
              <p>Optimistic content</p>
            </Show>
          </>
        );
      }
      const dispose = render(() => <App />, div);
      flush();
      expect(snapshot(div)).toBe("opt: false | drag: false | latest: false | pending: false");

      // The action, from an imperative scope (a timer stands in for a handler).
      let done!: Promise<void>;
      setTimeout(() => (done = move()), 0);
      await delay(5);
      flush();
      expect(snapshot(div)).toBe(
        "opt: true | drag: false | latest: false | pending: false | Optimistic content"
      );

      // The independent synchronous write while the action is open.
      setTimeout(() => setDrag(true), 0);
      await delay(5);
      flush();
      expect(snapshot(div)).toBe("opt: true | drag: true | latest: true | pending: false");

      // The action completes: the override reverts, `drag` is untouched.
      resolveMove();
      await done;
      await delay(5);
      flush();
      expect(snapshot(div)).toBe("opt: false | drag: true | latest: true | pending: false");
      dispose();
    });
  }
});
