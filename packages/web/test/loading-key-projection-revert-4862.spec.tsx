/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4862: `<Loading on={selected()}>` over a keyed projection. The key moves
// (card 2 -> 4) while one action (`addOne`) is out and another (`toggle`)
// re-asks the checklist. The toggle's accept re-derives the projection in
// the add's guess lane, which is served card 2's answer (the lane breaks out
// of a flight that is not its own, A31). That pass must not settle the
// pending the fallback waits on: the screen stays on the fallback until
// card 4's checklist lands (F-4, F-1).
import { test, expect } from "vitest";
import {
  Loading,
  Errored,
  For,
  action,
  createSignal,
  createOptimistic,
  createProjection,
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

test.each([true, false])(
  "#4862 the fallback stays on the new key when a toggle is accepted (add out: %s)",
  async withAdd => {
    const asks: { key: string; res: (v: any) => void }[] = [];
    const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
    const take = (key: string) => {
      const i = asks.findIndex(a => a.key === key);
      if (i < 0) throw new Error("no ask " + key);
      return asks.splice(i, 1)[0];
    };
    const c = document.body.appendChild(document.createElement("div"));

    const [selected, setSelected] = createSignal(2);
    const [checklist, setChecklist] = createSignal(async () => {
      const s = selected();
      return { card: s, items: await ask(`checklist:${s}`) };
    });
    const [toggling, guessToggling] = createOptimistic<number[]>(() => []);
    const [adding, guessAdding] = createOptimistic<{ card: number; text: string }[]>(() => []);
    const items = createProjection(
      () => {
        const l: any = checklist();
        return [
          ...l.items.map((it: any) => ({
            k: `i${it.id}`,
            t: `${l.card}/${it.text}${toggling().includes(it.id) ? " (toggling)" : ""}`
          })),
          ...adding()
            .filter(a => a.card === l.card)
            .map((a, i) => ({ k: `a${i}`, t: `${a.card}/${a.text} (adding)` }))
        ];
      },
      [] as any,
      { key: "k" } as any
    ) as any;
    const addOne = action(function* (card: number, text: string) {
      guessAdding(as => [...as, { card, text }]);
      const it = yield ask(`addItem:${card},${text}`);
      setChecklist((l: any) => (l.card !== card ? l : { card, items: [...l.items, it] }));
    });
    const toggle = action(function* (card: number, item: number) {
      guessToggling(ts => [...ts, item]);
      yield ask(`toggle:${card},${item}`);
      refresh(checklist);
    });

    const dispose = render(
      () => (
        <div>
          <Loading on={selected()} fallback={<p>loading checklist</p>}>
            <Errored fallback={<p>err</p>}>
              <p>
                {items.length}: <For each={items}>{(it: any) => <span>{it.t} </span>}</For>
              </p>
            </Errored>
          </Loading>
        </div>
      ),
      c
    );
    const screen = () => c.textContent!.replace(/\s+/g, " ").trim();

    take("checklist:2").res([
      { id: 21, text: "repro" },
      { id: 22, text: "patch" }
    ]);
    await tick();
    if (withAdd) addOne(2, "ship");
    await tick();
    toggle(2, 22);
    await tick();
    setSelected(4);
    await tick();
    expect(screen()).toBe("loading checklist");
    take("toggle:2,22").res({ id: 22, done: true });
    await tick();
    expect(screen()).toBe("loading checklist");
    // Card 4's answers land (the plain write's ask, and the toggle's re-ask).
    while (asks.some(a => a.key === "checklist:4")) {
      take("checklist:4").res([{ id: 41, text: "deploy" }]);
      await tick();
    }
    expect(screen()).toBe("1: 4/deploy");
    dispose();
    c.remove();
  }
);
