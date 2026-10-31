/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { expect, test } from "vitest";
import { render } from "../src/index.js";
import {
  createMemo,
  createProjection,
  createSignal,
  Errored,
  flush,
  For,
  Loading,
  Show
} from "solid-js";

type Row = { id: number; name: string };

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

test.each([true, false])(
  "an answer replaces the error a boundary was born with (projection: %s)",
  async projection => {
    const asks: { key: string; res: (v: Row[]) => void }[] = [];
    const ask = (key: string) => new Promise<Row[]>(res => asks.push({ key, res }));
    const land = async (key: string, v: Row[]) => {
      for (const a of asks.filter(a => a.key === key)) {
        asks.splice(asks.indexOf(a), 1);
        a.res(v);
      }
      await tick();
    };
    const container = document.createElement("div");
    const [q, setQ] = createSignal("");
    const dispose = render(() => {
      const src = createMemo(() => {
        const s = q();
        if (s === "") return [] as Row[];
        if (s.length < 2) throw new Error("too short");
        return ask(`search:${s}`);
      });
      const results: () => Row[] = projection
        ? (() => {
            const p = createProjection(() => src(), [] as Row[], { key: "id" });
            return () => p;
          })()
        : src;
      return (
        <Show when={q() !== ""}>
          <Errored fallback={(e: () => any) => <p>{e().message}</p>}>
            <Loading fallback={<p>loading</p>}>
              <For each={results()}>{r => <i>{r.name}</i>}</For>
            </Loading>
          </Errored>
        </Show>
      );
    }, container);
    await tick();
    expect(container.textContent).toBe("");
    setQ("a");
    await tick();
    expect(container.textContent).toBe("too short");
    setQ("ap");
    await tick();
    expect(container.textContent).toBe("too short");
    await land("search:ap", [
      { id: 1, name: "apple" },
      { id: 2, name: "apricot" }
    ]);
    expect(container.textContent).toBe("appleapricot");
    dispose();
  }
);
