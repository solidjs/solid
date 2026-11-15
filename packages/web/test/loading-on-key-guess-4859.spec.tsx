/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import {
  Errored,
  For,
  Loading,
  action,
  createMemo,
  createOptimistic,
  createSignal,
  flush
} from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

// #4859: a memo reading a pending guess is the guess lane's work. A plain
// write (the selection) re-asked the checklist it maps, and the lane pass was
// served the checklist's committed answer, then read the new selection: the
// old key's answer under the new key. Lane work served a flight that then
// reads a staging of the flush derives from the write that re-asked the
// flight and waits on it (F-2, S-57). That only held once the flush had a
// transaction; before one, the served read was never marked. The armed
// `<Loading on>` catches the wait (F-4), so the guess's decline reverts at
// once.
describe("#4859: Loading on(key) with a guess out", () => {
  test.each([true, false])(
    "a new key shows the fallback, not the old answer (guess out: %s)",
    async guessOut => {
      const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
      const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
      const take = (key: string) => {
        const i = asks.findIndex(a => a.key === key);
        if (i < 0) throw new Error("no ask " + key);
        return asks.splice(i, 1)[0];
      };
      const c = document.body.appendChild(document.createElement("div"));
      const [selected, setSelected] = createSignal(2);
      const [toggling, guessToggling] = createOptimistic<number[]>(() => []);
      const checklist = createMemo(() => ask(`checklist:${selected()}`));
      const toggle = action(function* (item: number) {
        try {
          guessToggling(ts => [...ts, item]);
          yield ask(`toggle:${item}`);
        } catch {
          // declined
        }
      });
      const dispose = render(
        () => (
          <div>
            <p id="count">{toggling().length}</p>
            <Loading on={selected()} fallback={<p id="fb">loading checklist</p>}>
              <Errored fallback={<p>error</p>}>
                {(() => {
                  const items = createMemo(() =>
                    (checklist() as any[]).map(
                      it => `${selected()}/${it.text}:${toggling().includes(it.id)}`
                    )
                  );
                  return <For each={items()}>{it => <span class="item">{it}</span>}</For>;
                })()}
              </Errored>
            </Loading>
          </div>
        ),
        c
      );
      const screen = () =>
        `count=${c.querySelector("#count")!.textContent} | ${
          c.querySelector("#fb")
            ? "loading checklist"
            : [...c.querySelectorAll(".item")].map(e => e.textContent).join(" ")
        }`;

      take("checklist:2").res([
        { id: 21, text: "repro" },
        { id: 22, text: "patch" }
      ]);
      await tick();
      if (guessOut) {
        toggle(22);
        await tick();
        expect(screen()).toBe("count=1 | 2/repro:false 2/patch:true");
      }
      setSelected(1);
      await tick();
      expect(screen()).toBe(`count=${guessOut ? 1 : 0} | loading checklist`);
      if (guessOut) {
        take("toggle:22").rej(new Error("read only"));
        await tick();
      }
      expect(screen()).toBe("count=0 | loading checklist");
      take("checklist:1").res([{ id: 11, text: "a" }]);
      await tick();
      expect(screen()).toBe("count=0 | 1/a:false");
      dispose();
      c.remove();
    }
  );
});
