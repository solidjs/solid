/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #5002: a memo reads an errored list through `x catch alt`, which makes a
// new error boundary on each run. A guess on another list re-runs the memo;
// the new boundary's first read of the errored list asks nothing (F-9) and
// the memo shows the guess's consequence in the guess's frame (F-1, D-33).
import { test, expect } from "vitest";
import {
  Loading,
  Errored,
  For,
  action,
  createMemo,
  createSignal,
  createOptimisticStore,
  flush,
  untrack
} from "solid-js";
import * as Solid from "solid-js";
import { render } from "../src/index.js";
const createErrorBoundary = (Solid as any).createErrorBoundary;
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

test("an errored list is not asked again when a memo reads it through a fresh error boundary", async () => {
  const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
  const take = (key: string) =>
    asks.splice(
      asks.findIndex(a => a.key === key),
      1
    )[0];
  const keys = () => asks.map(a => a.key).join(",");
  const c = document.body.appendChild(document.createElement("div"));
  let api: any;
  // `x catch () => alt`: an error boundary over x; inside a memo, a new one on each run
  const caught = (f: () => any, alt: any) => {
    const acc = untrack(() =>
      (createErrorBoundary as any)(
        () => f(),
        () => ({ fb: alt })
      )
    );
    return () => {
      const v = acc();
      return v && typeof v === "object" && "fb" in v ? v.fb : v;
    };
  };
  function App() {
    const [todo] = createOptimisticStore(
      async () => await ask("todo"),
      [] as any[],
      { key: "id" } as any
    );
    const [doing, setDoing] = createOptimisticStore(
      async () => await ask("doing"),
      [] as any[],
      { key: "id" } as any
    );
    // which list holds #4
    const where = createMemo(() =>
      caught(() => todo.some((r: any) => r.id === 4), false)()
        ? "todo"
        : caught(() => doing.some((r: any) => r.id === 4), false)()
          ? "doing"
          : ""
    );
    const remove = action(function* () {
      setDoing((rs: any[]) => rs.filter(r => r.id !== 4));
      yield ask("move");
    });
    api = { remove };
    const list = (rs: any[]) => (
      <Loading fallback="loading">
        <Errored fallback={() => "error"}>
          <For each={rs}>{(r: any) => <span>{r.id}</span>}</For>
        </Errored>
      </Loading>
    );
    return (
      <div>
        {list(todo)}|{list(doing)}|#4 in {where()}
      </div>
    );
  }
  render(() => <App />, c);
  const screen = () => c.textContent!.replace(/\s+/g, " ").trim();
  await tick();
  take("todo").rej(new Error("declined"));
  take("doing").res([{ id: 3 }, { id: 4 }]);
  await tick();
  expect(screen()).toBe("error|34|#4 in doing");
  expect(keys()).toBe("");
  api.remove();
  await tick(); // a guess on Doing; To do is untouched
  expect(keys()).toBe("move"); // was "move,todo": To do was asked again
  expect(screen()).toBe("error|3|#4 in"); // was "error|3|#4 in doing": `where` waited on that ask
});
