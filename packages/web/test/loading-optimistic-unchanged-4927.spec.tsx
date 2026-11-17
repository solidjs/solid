/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4927: `<Loading on={page()}>` over content derived from the page's text
// and an optimistic flag. The page moves (A -> B) while an action is out
// with a guess on the flag; the action then guesses again. The second guess
// re-derives the content in the action's lane, which is served A's text (the
// lane breaks out of a flight that is not its own, A31). That pass must not
// settle the pending the fallback waits on, whatever it computed, and
// whatever ran inside it: the screen stays on the fallback until B's text
// lands (F-4, F-1, #4862).
import { describe, test, expect } from "vitest";
import {
  Loading,
  action,
  createMemo,
  createOptimistic,
  createSignal,
  createStore,
  flush
} from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

type Shape = "store" | "memo" | "nested-memo";

function setup(shape: Shape) {
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const take = (key: string) => {
    const i = asks.findIndex(a => a.key === key);
    if (i < 0) throw new Error("no ask " + key);
    return asks.splice(i, 1)[0];
  };
  const c = document.body.appendChild(document.createElement("div"));
  const [page, setPage] = createSignal("A");
  const text = createMemo(() => ask(`text:${page()}`));
  const [uppercase, guessUppercase] = createOptimistic(false);
  const format = (t: string) => (uppercase() ? t.toUpperCase() : t);

  let content: () => string;
  if (shape === "store") {
    const [view] = createStore(() => ({ text: format(text()) }));
    content = () => view.text;
  } else if (shape === "memo") {
    const view = createMemo(() => ({ text: format(text()) }));
    content = () => view().text;
  } else {
    // A nested computation runs inside the outer one's pass, after the outer
    // pass was served A's text: what it records must not stand for the outer.
    const view = createMemo(() => {
      const t = text();
      const inner = createMemo(() => format(text()));
      return { text: inner() === format(t) ? inner() : t };
    });
    content = () => view().text;
  }

  let release!: () => void;
  const run = action(function* () {
    guessUppercase(true);
    yield new Promise<void>(r => (release = r));
    guessUppercase(false);
    yield ask("save");
  });

  const dispose = render(
    () => (
      <div>
        <h1>Page: {page()}</h1>
        <Loading on={page()} fallback={<p>Loading</p>}>
          <p>Content: {content()}</p>
        </Loading>
      </div>
    ),
    c
  );
  const screen = () => c.textContent!.replace(/\s+/g, " ").trim();
  const cleanup = () => {
    dispose();
    c.remove();
  };
  return { take, asks, setPage, run, release: () => release(), screen, cleanup };
}

describe("#4927 an optimistic re-derivation over a held page keeps Loading's fallback", () => {
  test.each(["store", "memo", "nested-memo"] as Shape[])("%s", async shape => {
    const t = setup(shape);
    t.take("text:A").res("A");
    await tick();
    expect(t.screen()).toBe("Page: AContent: A");
    t.run();
    await tick();
    t.setPage("B");
    await tick();
    expect(t.screen()).toBe("Page: BLoading");
    // The second guess leaves the formatted text unchanged ("A" upper-cased).
    t.release();
    await tick();
    expect(t.screen()).toBe("Page: BLoading");
    while (t.asks.some(a => a.key === "text:B")) {
      t.take("text:B").res("b");
      await tick();
    }
    expect(t.screen()).toBe("Page: BContent: b");
    t.take("save").res(undefined);
    await tick();
    expect(t.screen()).toBe("Page: BContent: b");
    t.cleanup();
  });
});
