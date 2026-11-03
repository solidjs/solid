/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4639 follow-up to #4638 (Vocabulary "Reader", F-3, F-4, D-14): an error
 * boundary built in the component body is on screen only through the render
 * effects it reaches, wherever the memo or boundary between was created. Read
 * through a memo or another error boundary built outside the
 * `<Loading on={sel()}>`, or not read at all, it holds nothing: a `sel` write
 * shows both fallbacks with the change's frame.
 * The signals-only twin: `packages/signals/tests/loading-on-errorboundary-through-4639.test.ts`.
 */
import { expect, test } from "vitest";
import { Loading, createMemo, createSignal, flush, untrack } from "solid-js";
import { createErrorBoundary } from "solid-js/internal";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

type Mode = "memo" | "nested" | "unread";

for (const mode of ["memo", "nested", "unread"] as Mode[])
  test(`switch key (error boundary, ${mode}): both fallbacks show now`, async () => {
    const asks: { key: string; res: (v: any) => void }[] = [];
    const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
    const settle = async (key: string, v: any) => {
      asks
        .splice(
          asks.findIndex(a => a.key === key),
          1
        )[0]
        .res(v);
      await tick();
    };
    const c = document.body.appendChild(document.createElement("div"));
    let select!: (n: number) => void;
    const dispose = render(() => {
      const [sel, setSel] = createSignal(3);
      select = setSel;
      const detail = createMemo(() => ask(`detail:${sel()}`));
      const eb = (src: () => any): (() => any) =>
        untrack(() =>
          createErrorBoundary(
            () => src(),
            () => null
          )
        );
      let shown: () => any = mode === "unread" ? detail : eb(detail);
      if (mode === "unread") eb(detail);
      if (mode === "nested") shown = eb(shown);
      let title = (): string => shown()?.title;
      if (mode === "memo") title = createMemo(title);
      const comments = createMemo(() => ask(`comments:${sel()}`));
      return (
        <>
          <Loading on={sel()} fallback={<i>loading #{sel()}</i>}>
            <b>{title()}</b>
          </Loading>
          <Loading on={sel()} fallback={<i> loading comments</i>}>
            <u> comments {(comments() as any[]).length}</u>
          </Loading>
        </>
      );
    }, c);
    await tick();
    await settle("detail:3", { title: "Crash" });
    await settle("comments:3", [1]);
    expect(c.textContent).toBe("Crash comments 1");
    select(1);
    await tick();
    expect(c.textContent).toBe("loading #1 loading comments");
    await settle("detail:1", { title: "One" });
    expect(c.textContent).toBe("One loading comments");
    await settle("comments:1", [1, 2]);
    expect(c.textContent).toBe("One comments 2");
    dispose();
    c.remove();
  });
