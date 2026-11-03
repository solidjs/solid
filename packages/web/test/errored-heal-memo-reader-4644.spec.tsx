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
  createStore,
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

// Only a reader the boundary caught keeps it waiting (D-39): something
// outside it still reading the failed memo — a memo or a derived store
// hoisted above the <Errored>, a header count under another <Errored> — did
// not catch this boundary's error and does not keep its fallback up.
for (const shape of [
  "derived memo outside",
  "derived store outside",
  "header reader outside"
] as const)
  test(`${shape}: navigating away from a failed list heals <Errored> (#4644)`, async () => {
    let rejectList!: (e: Error) => void;
    let setPage!: (p: string) => void;
    const el = document.createElement("div");
    const dispose = render(() => {
      const [page, set] = createSignal("list");
      setPage = set;
      const rows = createMemo(
        () =>
          new Promise<number[]>((_, reject) => {
            rejectList = reject;
          })
      );
      let read: () => number[] = rows;
      if (shape === "derived memo outside") read = createMemo(() => [...rows()].sort());
      if (shape === "derived store outside") {
        const [st] = createStore<{ l: number[] }>(
          d => {
            d.l = rows();
          },
          { l: [] }
        );
        read = () => st.l;
      }
      return (
        <>
          {shape === "header reader outside" && (
            <Errored fallback={<i>hdr-err</i>}>
              <i>{rows().length}</i>
            </Errored>
          )}
          <Errored fallback={<p>could not load</p>}>
            <Show when={page() === "list"} fallback={<p>about page</p>}>
              <Show when={read().length === 0} fallback={<p>some</p>}>
                <p>no rows</p>
              </Show>
            </Show>
          </Errored>
        </>
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
    const hdr = shape === "header reader outside" ? "hdr-err" : "";
    expect({ failed, after }).toEqual({
      failed: hdr + "could not load",
      after: hdr + "about page"
    });
  });
