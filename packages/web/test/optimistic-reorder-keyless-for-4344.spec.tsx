/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4344 — an optimistic reorder inside an action, on rows without an `id`:
 * direct store reads showed `c,b,a` while `<For>` (keyed and non-keyed) kept
 * rendering `a,b,c`. The container's arrangement guess was judged equal to
 * the committed rows (two keyless rows at one index counted as one row), so
 * `<For>` never re-ran. With an `id` the rows differ by key and it did.
 * Direct reads and `<For>` must agree, at the guess and after the settle.
 */
import { describe, expect, test } from "vitest";
import { action, createOptimisticStore, flush, For } from "solid-js";
import { render } from "../src/index.js";

const tick = () => new Promise(r => setTimeout(r, 0));

type Row = { id?: string; name: string };

for (const withId of [false, true])
  for (const keyed of [true, false])
    describe(`<For keyed={${keyed}}>, rows have id: ${withId}`, () => {
      test("a reorder inside an action renders at once and reverts at the settle", async () => {
        const row = (n: string): Row => (withId ? { id: n, name: n } : { name: n });
        const el = document.createElement("div");
        let release!: () => void;
        const server = new Promise<void>(r => (release = r));
        let items!: Row[];
        let reorder!: () => Promise<void>;
        const dispose = render(() => {
          const [store, setItems] = createOptimisticStore<Row[]>([row("a"), row("b"), row("c")]);
          items = store;
          reorder = action(function* () {
            setItems(() => [row("c"), row("b"), row("a")]);
            yield server;
          });
          return (
            <ul>
              {keyed ? (
                <For each={store}>{r => <li>{r.name}</li>}</For>
              ) : (
                <For each={store} keyed={false}>
                  {r => <li>{r().name}</li>}
                </For>
              )}
            </ul>
          );
        }, el);
        const rows = () => el.innerHTML;
        expect(rows()).toBe("<ul><li>a</li><li>b</li><li>c</li></ul>");
        const done = reorder();
        flush();
        // The guess shows at once (F-11): the same frame as the direct read.
        expect(items.map(r => r.name).join(",")).toBe("c,b,a");
        expect(rows()).toBe("<ul><li>c</li><li>b</li><li>a</li></ul>");
        await tick();
        flush();
        expect(items.map(r => r.name).join(",")).toBe("c,b,a");
        expect(rows()).toBe("<ul><li>c</li><li>b</li><li>a</li></ul>");
        release();
        await done;
        flush();
        // Nothing wrote the truth: the guess reverts, on screen too.
        expect(items.map(r => r.name).join(",")).toBe("a,b,c");
        expect(rows()).toBe("<ul><li>a</li><li>b</li><li>c</li></ul>");
        dispose();
      });
    });
