/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * An optimistic guess that puts a different row object at an index, where
 * the arrangement comparator called it "the same row", left `<For>` holding
 * the old row proxy while direct reads used the new one: an edit to the row
 * then showed in direct reads but not in the DOM.
 *
 *   A. keyless rows with identical contents, swapped in the draft
 *   B. a fresh row with the same `id` returned from the setter
 *   C. a fresh keyless row with the same contents returned from the setter
 */
import { describe, expect, test } from "vitest";
import { action, createOptimisticStore, flush, For } from "solid-js";
import { render } from "../src/index.js";

type Row = { id?: number; n: number };
const row = (id: boolean, n: number, i: number): Row => (id ? { id: i, n } : { n });

const cases = [
  { name: "A. keyless identical rows swapped in the draft", id: false, mode: "swap" },
  { name: "B. a fresh row with the same id returned", id: true, mode: "fresh" },
  { name: "C. a fresh keyless row with the same contents returned", id: false, mode: "fresh" }
] as const;

for (const c of cases)
  for (const keyed of [true, false])
    describe(`${c.name}, <For keyed={${keyed}}>`, () => {
      test("an edit of the replaced row renders at once and reverts at the settle", async () => {
        const el = document.createElement("div");
        let release!: () => void;
        const server = new Promise<void>(r => (release = r));
        let items!: Row[];
        let edit!: () => Promise<void>;
        const dispose = render(() => {
          const [store, set] = createOptimisticStore<Row[]>([row(c.id, 1, 1), row(c.id, 1, 2)]);
          items = store;
          edit = action(function* () {
            if (c.mode === "swap")
              set(d => {
                const x = d[0];
                d[0] = d[1];
                d[1] = x;
              });
            else set(() => [row(c.id, 1, 1), row(c.id, 1, 2)]);
            set(d => {
              d[0].n = 2;
            });
            yield server;
          });
          return (
            <ul>
              {keyed ? (
                <For each={store}>{r => <li>{r.n}</li>}</For>
              ) : (
                <For each={store} keyed={false}>
                  {r => <li>{r().n}</li>}
                </For>
              )}
            </ul>
          );
        }, el);
        expect(el.innerHTML).toBe("<ul><li>1</li><li>1</li></ul>");
        const done = edit();
        flush();
        expect(items.map(r => r.n).join(",")).toBe("2,1");
        expect(el.innerHTML).toBe("<ul><li>2</li><li>1</li></ul>");
        release();
        await done;
        flush();
        expect(items.map(r => r.n).join(",")).toBe("1,1");
        expect(el.innerHTML).toBe("<ul><li>1</li><li>1</li></ul>");
        dispose();
      });
    });
