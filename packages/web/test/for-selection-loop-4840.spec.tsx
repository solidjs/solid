/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4840: a `<For>` under a component that returns `<>{p.children}</>` renders
// one detail for the selection; the detail's heading memo reads the async
// detail and a `createOptimistic` guess whose action never returns. Changing
// the selection looped forever ("Potential Infinite Loop Detected"; a hang in
// production): the old heading's binding read the guess lane's member while
// its own flight was up and was re-queued at every reveal of a lane that had
// shown and was not held. It now re-derives when that flight lands.
import { test, expect } from "vitest";
import { For, Loading, action, createOptimistic, createMemo, createSignal, flush } from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

for (const inAction of [false, true])
  test(`#4840 selecting another issue while a rename guess is out settles (select in action: ${inAction})`, async () => {
    const asks: { key: string; res: (v: any) => void }[] = [];
    const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
    const pick = (key: string) => {
      const i = asks.findIndex(a => a.key === key);
      if (i < 0) throw new Error("no ask " + key + " in " + asks.map(a => a.key));
      return asks.splice(i, 1)[0];
    };
    const c = document.body.appendChild(document.createElement("div"));

    const [selected, setSelected] = createSignal<number | null>(null);
    const [renaming, guessRename] = createOptimistic<{ id: number; title: string }[]>(() => []);
    const detail = createMemo(() => (selected() != null ? ask(`detail:${selected()}`) : undefined));
    const heading = createMemo(() => {
      const d: any = detail();
      return d == null ? "" : renaming().reduce((t, r) => (r.id === d.id ? r.title : t), d.title);
    });
    const selList = createMemo(() => (selected() == null ? [] : [selected()]));
    const rename = action(function* (id: number, title: string) {
      guessRename(rs => [...rs, { id, title }]);
      yield ask(`rename:${id}`); // never answers
    });
    const select = action(function* (id: number) {
      setSelected(id);
    });

    // A page component: its children are read through a getter, as a compiled `if` passes them.
    const Page = (p: { children: any }) => <>{p.children}</>;
    const Detail = (props: { id: number }) => (
      <div>
        <Loading fallback={<p>loading #{props.id}</p>}>
          <h2>
            #{props.id} {heading()}
          </h2>
          <p>{(detail() as any)?.body}</p>
        </Loading>
      </div>
    );
    render(
      () => (
        <main>
          <Page>
            <For each={selList()}>{(s: any) => <Detail id={s} />}</For>
          </Page>
        </main>
      ),
      c
    );

    const frames: string[] = [];
    setSelected(4);
    await tick();
    frames.push(c.textContent!);
    rename(4, "Bravo");
    await tick();
    pick("detail:4").res({ id: 4, title: "Typo in footer", body: "four" });
    await tick();
    frames.push(c.textContent!);
    inAction ? select(3) : setSelected(3);
    await tick();
    frames.push(c.textContent!);
    pick("detail:3").res({ id: 3, title: "Crash on save", body: "three" });
    await tick();
    frames.push(c.textContent!);
    expect(frames).toEqual(["loading #4", "#4 Bravofour", "loading #3", "#3 Crash on savethree"]);
    c.remove();
  });
