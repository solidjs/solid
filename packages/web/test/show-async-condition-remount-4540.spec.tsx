/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4540: a non-keyed Show whose condition reads an async memo or projection
// remounted its child on every write to the memo's source, though the
// condition stayed true. A child that writes the source on mount looped.
import { expect, test } from "vitest";
import { createMemo, createProjection, createRenderEffect, createSignal, Show } from "solid-js";
import { render } from "../src/index.js";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

type Kind = "sync memo" | "sync projection" | "async memo" | "async projection";

function mount(kind: Kind) {
  let mounts = 0;
  const [version, setVersion] = createSignal(0, { ownedWrite: true });
  let value: number | undefined = kind.startsWith("sync") ? 1 : undefined;
  const firstAnswer = wait(10).then(() => {
    value = 1;
    setVersion(v => v + 1);
    return 1;
  });
  let read: () => number | undefined;
  if (kind.endsWith("memo")) {
    const m = createMemo(() => (version(), value ?? firstAnswer));
    read = () => m();
  } else {
    const p = createProjection<{ data?: number }>(() => {
      version();
      return (
        value !== undefined ? { data: value } : firstAnswer.then(v => ({ data: v }))
      ) as never;
    }, {});
    read = () => p.data;
  }
  function Child() {
    mounts++;
    if (mounts > 20) throw new Error("remount loop");
    createRenderEffect(
      () => 0,
      () => void setVersion(v => v + 1)
    );
    return <p>child</p>;
  }
  const el = document.createElement("div");
  const dispose = render(
    () => (
      <Show when={read() !== undefined}>
        <Child />
      </Show>
    ),
    el
  );
  return { mounts: () => mounts, dispose, el };
}

test.each<Kind>(["sync memo", "sync projection", "async memo", "async projection"])(
  "%s: a non-keyed Show whose condition stays true mounts its child once (#4540)",
  async kind => {
    const { mounts, dispose, el } = mount(kind);
    await wait(100);
    expect(el.innerHTML).toBe("<p>child</p>");
    dispose();
    expect(mounts()).toBe(1);
  }
);
