/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4929 (fuzz seed 100, board app): a toggle's guess on the checklist store
// is out when an archive unmounts the selected card's region and clears the
// selection. Selecting another card remounts `<Loading on={selected()}>`
// while that card's checklist question is in flight: the new region shows
// its fallback, not the store's value for "nothing selected".
import { test, expect } from "vitest";
import {
  Show,
  Loading,
  Errored,
  For,
  action,
  onFlush,
  createSignal,
  createOptimisticStore,
  refresh,
  flush
} from "solid-js";
import { render } from "../src/index.js";
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

for (const withToggle of [true, false])
  test(`#4929 a newly selected card's checklist loads under Loading on(selected) (toggle out: ${withToggle})`, async () => {
    const asks: { key: string; res: (v: any) => void }[] = [];
    const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
    const take = (key: string) => {
      const i = asks.findIndex(a => a.key === key);
      if (i < 0) throw new Error("no ask " + key);
      return asks.splice(i, 1)[0];
    };
    const c = document.body.appendChild(document.createElement("div"));

    const [selected, setSelected] = createSignal<number | null>(null);
    const [listAns] = createSignal<any>(async () => {
      const s = selected();
      return s == null ? null : { card: s, items: await ask(`checklist:${s}`) };
    });
    const [checklist, setChecklist] = createOptimisticStore<any[]>(
      () => {
        const l = listAns();
        return l == null
          ? []
          : l.items.map((it: any) => ({ id: it.id, text: it.text, done: it.done }));
      },
      [],
      { key: "id" } as any
    );
    const [cards, setCards] = createOptimisticStore<any[]>(
      () => [
        { id: 1, title: "Write spec" },
        { id: 2, title: "Fix login" }
      ],
      [],
      { key: "id" } as any
    );
    const sel = () => {
      const s = selected();
      return s == null ? null : (cards.find((r: any) => r.id === s) ?? null);
    };

    const toggle = action(function* (j: number, card: number, item: number, to: boolean) {
      setChecklist((d: any) => {
        d[j].done = to;
      });
      yield ask(`toggle:${card},${item}`);
      refresh(listAns);
    });
    const archive = action(function* (id: number) {
      setCards((rs: any[]) => rs.filter(r => r.id !== id));
      onFlush(() => setSelected(null));
      yield ask(`archive:${id}`);
    });

    const dispose = render(
      () => (
        <div>
          <Show when={sel()} fallback={<p>select a card</p>}>
            <Loading on={selected()} fallback={<p>loading checklist</p>}>
              <Errored fallback={<p>err</p>}>
                <p>
                  #{sel()?.id} {sel()?.title}:{" "}
                  <For each={checklist}>
                    {(it: any) => (
                      <span>
                        [{it.done ? "x" : " "}] {it.text}{" "}
                      </span>
                    )}
                  </For>
                  {checklist.filter((x: any) => x.done).length}/{checklist.length} done
                </p>
              </Errored>
            </Loading>
          </Show>
        </div>
      ),
      c
    );
    const screen = () => c.textContent!.replace(/\s+/g, " ").trim();
    try {
      setSelected(1);
      await tick();
      take("checklist:1").res([
        { id: 11, text: "outline", done: false },
        { id: 12, text: "draft", done: false }
      ]);
      await tick();
      if (withToggle) {
        toggle(0, 1, 11, true);
        await tick();
      }
      archive(1);
      await tick();
      expect(screen()).toBe("select a card");
      setSelected(2);
      await tick();
      // In the air: checklist:2 (and archive:1, toggle:1,11).
      expect(screen()).toBe("loading checklist");
      take("checklist:2").res([{ id: 21, text: "repro", done: false }]);
      await tick();
      expect(screen()).toBe("#2 Fix login: [ ] repro 0/1 done");
    } finally {
      dispose();
      c.remove();
    }
  });
