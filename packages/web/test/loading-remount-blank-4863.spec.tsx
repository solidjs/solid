/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4863: a page remounted while an action that writes its source is out.
// The remount runs in the action's guess lane, so the page's Loading,
// Errored and Show memos are born there; the action's accept corrects the
// lane, which voided their only values, and nothing re-derived them: the
// region showed neither fallback nor content. They re-derive on the truth
// at the correction (D-34, F-1; the #4861 fix). `render` comes from the
// package build (as the compiled event delegation does), so the clicks
// reach their handlers.
import { test, expect } from "vitest";
import {
  Show,
  Loading,
  Errored,
  action,
  createMemo,
  createSignal,
  createOptimistic,
  flush
} from "solid-js";
import { render } from "@solidjs/web";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

test("#4863 a Loading region remounted while an action is out shows its content", async () => {
  const air: Record<string, ((v: any) => void)[]> = {};
  const ask = (k: string) => new Promise<any>(res => (air[k] ??= []).push(res));
  const land = (k: string, v: any) => air[k].shift()!(v);
  const c = document.body.appendChild(document.createElement("div"));
  function App() {
    const [visit, setVisit] = createSignal(0);
    const [cards, setCards] = createSignal<any>(() => (visit() >= 0 ? ask("fetchCards") : null), {
      loadingValue: null
    } as any);
    const [addingTruth] = createSignal<string[]>(() => []);
    const [adding, guessAdding] = createOptimistic<string[]>(() => addingTruth());
    const rows = createMemo(() => {
      const cs = cards();
      return cs == null ? null : [...cs.map((c: any) => c.title), ...adding()];
    });
    const add = action(function* (t: string) {
      try {
        guessAdding(as => [...as, t]);
        const r: any = yield ask("addCard");
        setCards((cs: any) => (cs == null ? cs : [...cs, { id: r.id, title: r.title }]));
      } catch {}
    });
    const Page = () => (
      <div data-testid="out">
        <Loading fallback={<p>loading</p>}>
          <Errored fallback={<p>err</p>}>
            <Show when={rows() == null} fallback={<p>{rows()?.join(",")}</p>}>
              {(_x: any) => <p>first load</p>}
            </Show>
          </Errored>
        </Loading>
      </div>
    );
    const [page, setPage] = createSignal("a");
    return (
      <div>
        <button data-testid="add" onClick={() => add("x")}>
          add
        </button>
        <button data-testid="away" onClick={() => setPage("b")}>
          away
        </button>
        <button
          data-testid="back"
          onClick={() => {
            setVisit(visit() + 1);
            setPage("a");
          }}
        >
          back
        </button>
        <Show when={page() === "a"} fallback={<p>other page</p>}>
          {(_x: any) => <Page />}
        </Show>
      </div>
    );
  }
  const dispose = render(() => <App />, c);
  const click = (id: string) => (c.querySelector(`[data-testid=${id}]`) as HTMLElement).click();
  const body = () => {
    const out = c.querySelector("[data-testid=out]");
    return out ? out.textContent || "(empty)" : c.querySelector("p")!.textContent;
  };
  await tick();
  land("fetchCards", [{ id: 1, title: "a" }]);
  await tick();
  expect(body()).toBe("a");
  click("add");
  await tick();
  expect(body()).toBe("a,x");
  click("away");
  await tick();
  expect(body()).toBe("other page");
  click("back");
  await tick();
  expect(body()).toBe("loading");
  land("addCard", { id: 2, title: "x" });
  await tick();
  expect(body()).toBe("loading");
  land("fetchCards", [
    { id: 1, title: "a" },
    { id: 2, title: "x" }
  ]);
  await tick();
  expect(body()).toBe("a,x");
  dispose();
  c.remove();
});
