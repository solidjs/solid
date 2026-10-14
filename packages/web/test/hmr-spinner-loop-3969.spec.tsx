/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #3969: a refetch plus a write that swaps a `<Show>` to a fallback holding
// `<Spinner on={isPending(project)} />` tripped the flush loop guard under the
// dev server: solid-refresh runs each component inside a transparent memo
// (`createProxy` in solid-js/refresh). Mounted by the held swap, that memo is
// born held; the insert effect reading it also reads the verdict lane of
// `isPending`. Its pass joined the hold only through the born-held memo, yet
// the lane entry treated it as lane work that read a held write and re-derived
// it on the committed world — where it read the same staging. The lane held,
// the effect re-ran on the screen, the lane showed and re-ran it, every round.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  Loading,
  Show,
  createMemo,
  createSignal,
  flush,
  isPending,
  untrack
} from "solid-js";
import { render, type JSX } from "../src/index.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// What solid-refresh's proxy does around a component body.
const hmr =
  <P,>(c: (p: P) => JSX.Element) =>
  (props: P) =>
    createMemo(() => untrack(() => c(props)), { transparent: true }) as unknown as JSX.Element;

for (const wrapped of ["none", "spinner", "app", "both"] as const)
  test(`Save settles without the loop guard (HMR-wrapped: ${wrapped})`, async () => {
    const loops: string[] = [];
    const E = globalThis.Error;
    const W = function (this: unknown, m?: string, o?: ErrorOptions) {
      if (String(m).includes("Infinite Loop")) loops.push(String(m));
      return Reflect.construct(E, [m, o], new.target || W);
    } as unknown as ErrorConstructor;
    Object.defineProperty(W, "prototype", { value: E.prototype });
    Object.setPrototypeOf(W, E);
    globalThis.Error = W;
    try {
      const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
      const [refresh, setRefresh] = createSignal(0);
      const fetchAfter = <T,>(value: T) => (refresh(), wait(20).then(() => value));
      const id = <P,>(c: (p: P) => JSX.Element) => c;
      const Spinner = (wrapped === "spinner" || wrapped === "both" ? hmr : id)(
        (props: { on: boolean }) => (
          <Show when={props.on}>
            <span>updating</span>
          </Show>
        )
      );
      let select!: () => void;
      let save!: () => void;
      const App = (wrapped === "app" || wrapped === "both" ? hmr : id)(() => {
        const project = createMemo(() => fetchAfter({ id: "a" }));
        const rows = createMemo(() => fetchAfter([{ id: project().id }]));
        const tags = createMemo(() => fetchAfter(["A", "B"]));
        const [selected, setSelected] = createSignal(false);
        select = () => setSelected(true);
        save = () => {
          setRefresh(n => n + 1);
          setSelected(false);
        };
        return (
          <Loading fallback={<p>loading</p>}>
            <div>
              <Show
                when={tags().length > 0 && selected()}
                fallback={<Spinner on={isPending(project)} />}
              >
                <span>selected</span>
              </Show>
              <p>{rows()[0]!.id}</p>
            </div>
          </Loading>
        );
      });
      const container = document.createElement("div");
      const dispose = render(() => <App />, container);
      const settle = async () => {
        for (let i = 0; i < 5; i++) {
          await vi.advanceTimersByTimeAsync(25);
          flush();
        }
      };
      await settle();
      expect(container.textContent).toBe("a");
      select();
      flush();
      await settle();
      expect(container.textContent).toBe("selecteda");
      save();
      flush();
      // The swap to the fallback reads the refetching `tags`: it holds with
      // the refetch, so the screen keeps what it showed until it lands.
      expect(container.textContent).toBe("selecteda");
      await settle();
      expect(loops).toEqual([]);
      expect(container.textContent).toBe("a");
      dispose();
    } finally {
      globalThis.Error = E;
    }
  });
