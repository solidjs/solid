/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4834: a heading memo reads a still-loading `detail` memo and a rename
// guess that a list's rows also read. While the rename is out another action
// re-asks the list. When `detail` lands, the heading's pass is the guess
// lane's work, and the lane was held only because a row waited on that
// re-ask, so `<h2>` showed the memo's committed value (derived before
// `detail` answered) beside a `<p>` showing the answer. A refresh holds
// nothing new (D-34 ¶3): the heading now shows the guess over the answer.
import { test, expect } from "vitest";
import {
  For,
  Loading,
  Show,
  action,
  createOptimistic,
  createMemo,
  createSignal,
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

for (const withOther of [true, false])
  test(`#4834 a heading over a guess shows it when its source lands (other action: ${withOther})`, async () => {
    const asks: { key: string; res: (v: any) => void }[] = [];
    const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
    const pick = (key: string) => {
      const i = asks.findIndex(a => a.key === key);
      if (i < 0) throw new Error("no ask " + key + " in " + asks.map(a => a.key));
      return asks.splice(i, 1)[0];
    };
    const c = document.body.appendChild(document.createElement("div"));

    const [selected, setSelected] = createSignal(false);
    const [renamesT] = createSignal<string[]>(() => []);
    const [renames, guessRename] = createOptimistic(() => renamesT());
    const list = createMemo(() => ask("list"));
    const rows = createMemo(() =>
      (list() as any[]).map(i => ({
        id: i.id,
        title: renames().reduce((t: string, r: string) => r, i.title)
      }))
    );
    const detail = createMemo(() => (selected() ? ask("detail") : null));
    const heading = createMemo(() => {
      const d: any = detail();
      return d == null ? "" : renames().reduce((t: string, r: string) => r, d.title);
    });
    const rename = action(function* (title: string) {
      guessRename((rs: string[]) => [...rs, title]);
      yield ask("rename");
      refresh(list);
      refresh(detail);
    });
    const other = action(function* () {
      yield ask("other");
      refresh(list);
    });

    render(
      () => (
        <main>
          <Loading fallback={<p>loading</p>}>
            <ul>
              <For each={rows()}>{(it: any) => <li>{it.title}</li>}</For>
            </ul>
          </Loading>
          <Show when={selected()} fallback={<p>select</p>}>
            <Loading fallback={<p>loading detail</p>}>
              <h2>{heading()}</h2>
              <p>{(detail() as any)?.body}</p>
            </Loading>
          </Show>
        </main>
      ),
      c
    );

    const steps: (() => void)[] = [
      () => pick("list").res([{ id: 2, title: "Old bug" }]),
      () => setSelected(true),
      () => withOther && other(),
      () => rename("Delta"),
      // re-asks the list
      () => withOther && pick("other").res({}),
      () => pick("detail").res({ title: "Old bug", body: "long gone" })
    ];
    const frames: string[] = [];
    for (const f of steps) {
      f();
      await tick();
      frames.push(c.querySelector("main")!.innerHTML.replace(/<!--.*?-->/g, ""));
    }
    expect(frames).toEqual([
      "<ul><li>Old bug</li></ul><p>select</p>",
      "<ul><li>Old bug</li></ul><p>loading detail</p>",
      "<ul><li>Old bug</li></ul><p>loading detail</p>",
      "<ul><li>Delta</li></ul><p>loading detail</p>",
      "<ul><li>Delta</li></ul><p>loading detail</p>",
      "<ul><li>Delta</li></ul><h2>Delta</h2><p>long gone</p>"
    ]);
    c.remove();
  });
