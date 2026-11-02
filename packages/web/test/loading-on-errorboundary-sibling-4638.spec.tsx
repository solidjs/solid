/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4638 (F-4, F-5, D-14, D-15): two sibling `<Loading on={sel()}>`
 * boundaries. One reads its async memo through an error boundary built in the
 * component body (a value-level catch, `createErrorBoundary`), the other a
 * plain async memo keyed by the same signal. A `sel` write re-arms both: the
 * error boundary is not a render effect and its only reader is under the
 * first Loading, so nothing outside either boundary reads the new flights
 * (D-16 does not apply) and both fallbacks show with the change's frame.
 * The signals-only twin: `packages/signals/tests/loading-on-errorboundary-sibling-4638.test.ts`.
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

for (const caught of [true, false])
  test(`switch key (${caught ? "error boundary" : "plain"}): both fallbacks show now`, async () => {
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
      const shown = caught
        ? untrack(() =>
            createErrorBoundary(
              () => detail(),
              () => null
            )
          )
        : detail;
      const comments = createMemo(() => ask(`comments:${sel()}`));
      return (
        <>
          <Loading on={sel()} fallback={<i>loading #{sel()}</i>}>
            <b>{(shown() as any)?.title}</b>
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
