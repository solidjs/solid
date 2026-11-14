/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import {
  Errored,
  Loading,
  Show,
  action,
  createMemo,
  createOptimistic,
  createSignal,
  flush,
  untrack
} from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

// #4856 (fuzzer, seed 45): a `<Loading on>` re-armed by a guess (the `on`
// reads a heading over a rename guess) ran its output as the guess lane's
// work. The status test saw its tree clean, and the read of the tree then
// ran the content — through an `<Errored>` and a `<Show>` condition over a
// new search — into a pending. As lane work the read was served the
// committed tree, and the pass that marked it pending could not re-derive
// the output mid-pass, so the output kept the old content. The lane then
// waited on the pending behind it, and the heading, a member of the same
// lane, showed the previous selection's title next to the new id. D-17
// (S-21): an `on` whose reads are ahead shows its fallback now, beside the
// held screen.
describe("#4856: a re-armed Loading over a guess catches the pending its read runs into", () => {
  test("the heading shows the guess for the new selection, and the search shows its fallback", async () => {
    const asks: { key: string; res: (v: any) => void }[] = [];
    const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
    const land = (key: string, v: any) => {
      const i = asks.findIndex(a => a.key === key);
      if (i < 0) throw new Error("no ask " + key);
      asks.splice(i, 1)[0].res(v);
    };
    const c = document.body.appendChild(document.createElement("div"));

    const [selected, setSelected] = createSignal<number | null>(null);
    const [renames, guessRename] = createOptimistic<{ id: number; title: string }[]>(() => []);
    const detail = createMemo(() => (selected() != null ? ask(`detail:${selected()}`) : undefined));
    const heading = createMemo(() => {
      const d: any = detail();
      return d == null ? "" : renames().reduce((t, r) => (r.id === d.id ? r.title : t), d.title);
    });
    const select = action(function* (id: number) {
      setSelected(id);
    });
    const rename = action(function* (id: number, title: string) {
      guessRename(rs => [...rs, { id, title }]);
      yield ask(`rename:${id}`);
    });

    const Related = (props: { title: string }) => {
      const hits = createMemo(() => ask(`search:${props.title}`));
      return (
        <Loading on={props.title} fallback={<p>finding related help</p>}>
          <Errored fallback={<p>failed</p>}>
            <Show when={(hits() as any[]).length === 0} fallback={<p>some help</p>}>
              <p>no help</p>
            </Show>
          </Errored>
        </Loading>
      );
    };
    const dispose = render(
      () => (
        <Loading on={selected()} fallback={<p>loading #{selected()}</p>}>
          <h2>
            #{(detail() as any)?.id} {heading()}
          </h2>
          <Related title={heading()} />
        </Loading>
      ),
      c
    );

    select(4);
    await tick();
    land("detail:4", { id: 4, title: "Typo in footer" });
    await tick();
    select(3);
    await tick();
    land("search:Typo in footer", [{ id: 9 }]);
    await tick();
    rename(3, "Delta"); // its answer stays out
    await tick();
    land("detail:3", { id: 3, title: "Crash on save" });
    await tick();
    expect(untrack(heading)).toBe("Delta");
    expect(c.querySelector("h2")?.textContent).toBe("#3 Delta");
    expect(c.querySelector("p")?.textContent).toBe("finding related help");

    land("search:Delta", []);
    await tick();
    expect(c.querySelector("h2")?.textContent).toBe("#3 Delta");
    expect(c.querySelector("p")?.textContent).toBe("no help");
    dispose();
    c.remove();
  });
});
