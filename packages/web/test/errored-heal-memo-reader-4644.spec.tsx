/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4644 (D-39): an <Errored> whose fallback no live reader holds heals. A
// list page reads a failed async memo and the boundary shows its fallback;
// navigating to another branch under the same boundary disposes every reader
// of the memo, so the new branch shows. A reader that is only a memo — the
// condition of a <Show> or <Match> — used to keep the boundary stuck.
import { expect, test } from "vitest";
import { render, type JSX } from "@solidjs/web";
import {
  createMemo,
  createSignal,
  Errored,
  flush,
  For,
  Loading,
  Match,
  Show,
  Switch
} from "solid-js";

const tick = async () => {
  for (let i = 0; i < 2; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
type Row = { id: number };

const readers: Record<string, (rows: () => Row[]) => JSX.Element> = {
  "Show when={rows().length === 0}": rows => (
    <Show when={rows().length === 0} fallback={<p>{rows().length} rows</p>}>
      <p>no rows</p>
    </Show>
  ),
  "Show when={rows()}": rows => <Show when={rows()}>{r => <p>{r().length} rows</p>}</Show>,
  "Show keyed": rows => (
    <Show when={rows()} keyed>
      {r => <p>{r.length} rows</p>}
    </Show>
  ),
  "Switch/Match": rows => (
    <Switch fallback={<p>{rows().length} rows</p>}>
      <Match when={rows().length === 0}>
        <p>no rows</p>
      </Match>
    </Switch>
  ),
  "memo of the condition": rows => {
    const empty = createMemo(() => rows().length === 0);
    return <p>{empty() ? "none" : "some"}</p>;
  },
  text: rows => <p>{rows().length} rows</p>,
  For: rows => (
    <ul>
      <For each={rows()}>{r => <li>{r.id}</li>}</For>
    </ul>
  )
};

for (const withLoading of [true, false])
  for (const [name, view] of Object.entries(readers))
    test(`${withLoading ? "Loading" : "no Loading"} | ${name}: navigating away from a failed list heals <Errored> (#4644)`, async () => {
      let rejectList!: (e: Error) => void;
      let setPage!: (p: string) => void;
      const el = document.createElement("div");
      const dispose = render(() => {
        const [page, set] = createSignal("list");
        setPage = set;
        const rows = createMemo(
          () =>
            new Promise<Row[]>((_, reject) => {
              rejectList = reject;
            })
        );
        return (
          <Errored fallback={<p>could not load</p>}>
            <Show when={page() === "list"} fallback={<p>about page</p>}>
              {withLoading ? <Loading fallback={<p>loading</p>}>{view(rows)}</Loading> : view(rows)}
            </Show>
          </Errored>
        );
      }, el);
      await tick();
      rejectList(new Error("boom"));
      await tick();
      const failed = el.textContent;
      setPage("about");
      flush();
      await tick();
      const after = el.textContent;
      dispose();
      expect({ failed, after }).toEqual({ failed: "could not load", after: "about page" });
    });
