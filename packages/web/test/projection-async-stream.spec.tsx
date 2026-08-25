/**
 * @jsxImportSource @solidjs/web
 *
 * Regression: a client render (no SSR/hydration) of a createProjection whose
 * derive is an async generator pushing into array state, read through
 * Repeat/length under a Loading boundary — the rendering example's Stream
 * page on client navigation. `state.push` after an `await` READS
 * `state.length` from the derive's continuation (outside the sync write
 * scope); that read used to hit the store's seed-invisibility firewall gate,
 * throw NotReadyError into the derive, and the post-await read diagnostic
 * escalated it to a reactivity halt — the boundary stayed on its fallback
 * forever. Own-draft ops carry the write override and are exempt now.
 */
import { describe, expect, test } from "vitest";
import { render } from "../src/index.js";
import { createMemo, createProjection, For, Loading, Repeat, flush } from "solid-js";

function tick(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  flush();
  await Promise.resolve();
  flush();
}

interface Item {
  id: number;
  text: string;
}

async function* getData(): AsyncIterable<Item> {
  const items: Item[] = [
    { id: 1, text: "First" },
    { id: 2, text: "Second" }
  ];
  for (const item of items) {
    await tick(5);
    yield item;
  }
}

describe("client-only async-generator projection under Loading", () => {
  test("memo list streams in (control)", async () => {
    const container = document.createElement("div");
    const App = () => {
      const memoItems = createMemo<Item[]>(async function* () {
        let accum: Item[] = [];
        for await (const val of getData()) {
          yield (accum = [...accum, val]);
        }
      });
      return (
        <Loading fallback={<span>loading memo</span>}>
          <ul>
            <For each={memoItems()}>{item => <li>{item.id}</li>}</For>
          </ul>
        </Loading>
      );
    };
    const dispose = render(() => <App />, container);
    flush();
    expect(container.textContent).toContain("loading memo");
    await tick(15);
    await settle();
    expect(container.querySelectorAll("li").length).toBeGreaterThan(0);
    dispose();
  });

  test("projection list streams in", async () => {
    const container = document.createElement("div");
    const App = () => {
      const projItems = createProjection<Item[]>(async function* (state) {
        for await (const val of getData()) {
          state.push(val);
          yield;
        }
      }, []);
      return (
        <Loading fallback={<span>loading projection</span>}>
          <ul>
            <Repeat count={projItems.length}>{i => <li>{projItems[i].id}</li>}</Repeat>
          </ul>
        </Loading>
      );
    };
    const dispose = render(() => <App />, container);
    flush();
    expect(container.textContent).toContain("loading projection");
    await tick(15);
    await settle();
    expect(container.querySelectorAll("li").length).toBeGreaterThan(0);
    dispose();
  });
});
