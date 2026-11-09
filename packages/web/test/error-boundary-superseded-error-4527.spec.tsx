/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4527: an action re-asks a store and a memo, so its transition stays open.
// The store's re-ask fails (staged, D-41), then a second re-ask answers
// before the transition commits. An effect reading the store through an
// error boundary created in its compute got the superseded failure (the
// fallback's `null`) at the commit and never ran again; the screen showed
// the new rows. Nothing may see the superseded failure: the effect gets
// `len2` with the screen.
import { expect, test } from "vitest";
import {
  For,
  Loading,
  Errored,
  action,
  createOptimisticStore,
  createMemo,
  createEffect,
  untrack,
  flush,
  refresh
} from "solid-js";
import { createErrorBoundary } from "solid-js/internal";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

test("#4527: an effect's error boundary gets the answer, not the superseded error", async () => {
  const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
  const settle = async (key: string, f: (a: (typeof asks)[number]) => void) => {
    f(
      asks.splice(
        asks.findIndex(a => a.key === key),
        1
      )[0]
    );
    await tick();
  };
  const container = document.body.appendChild(document.createElement("div"));
  const log: string[] = [];
  const frames: string[] = [];
  const snap = (label: string) => {
    frames.push(`${label}: ${container.textContent} | ${log.join(",")}`);
    log.length = 0;
  };
  let again!: () => void;
  let rename!: (t: string) => any;
  const dispose = render(() => {
    const [issues] = createOptimisticStore<any[]>(() => ask("issues"), [], { key: "id" });
    again = () => refresh(issues);
    const detail = createMemo(() => ask("detail"));
    rename = action(function* (t: string) {
      yield ask(`rename:${t}`);
      refresh(issues);
      refresh(detail);
    });
    createEffect(
      () =>
        untrack(() =>
          createErrorBoundary(
            () => issues,
            () => null
          )
        )(),
      {
        effect: (v: any) => void log.push(v === null ? "null" : `len${v.length}`),
        error: (e: any) => void log.push(`error ${e?.message}`)
      } as any
    );
    return (
      <>
        <Loading fallback="loading">
          <Errored fallback={(e: any) => `list error ${e().message}`}>
            <For each={issues}>
              {(it: any) => (
                <i>
                  [#{it.id} {it.title}]
                </i>
              )}
            </For>
          </Errored>
        </Loading>
        {" | "}
        <Loading fallback="…">{String(detail())}</Loading>
      </>
    );
  }, container);
  await tick();
  const rows = (t: string) => [
    { id: 1, title: "Login" },
    { id: 3, title: t },
    { id: 4, title: "Typo" }
  ];
  await settle("issues", a => a.res(rows("Crash")));
  await settle("detail", a => a.res("d1"));
  snap("loaded");
  rename("Alpha");
  await tick();
  await settle("rename:Alpha", a => a.res({}));
  await settle("issues", a => a.rej(new Error("declined")));
  snap("re-ask failed");
  again();
  await tick();
  await settle("issues", a => a.res(rows("Alpha").filter(r => r.id !== 4)));
  snap("re-ask answered");
  await settle("detail", a => a.res("d2"));
  snap("detail answered");
  expect(frames).toEqual([
    "loaded: [#1 Login][#3 Crash][#4 Typo] | d1 | len3",
    "re-ask failed: [#1 Login][#3 Crash][#4 Typo] | d1 | ",
    "re-ask answered: [#1 Login][#3 Crash][#4 Typo] | d1 | ",
    "detail answered: [#1 Login][#3 Alpha] | d2 | len2"
  ]);
  dispose();
  container.remove();
});
