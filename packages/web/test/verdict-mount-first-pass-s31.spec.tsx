/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * S-31 through `Show` + `Loading`, both forms (#4574; the signals pin is
 * `signals/tests/verdict-mount-first-pass-3851.test.ts`, the render-effect
 * form alone is `show-latest-loading-render-effect-4166.spec.tsx`). An
 * action holds `x = 1`; `<Show when={latest(x) > 0}>` opens ahead and
 * mounts a `<Loading>` whose content reads `x` — in a text binding (a render
 * effect) or through a memo the binding reads. The seat is decided by reads,
 * not node type (D-3 as amended): either way the content's first pass read
 * the held write under a display-ahead reader, so it is born held (D-27)
 * and the boundary shows its fallback beside the committed `0` until the
 * action lands.
 */
import { expect, test } from "vitest";
import { Loading, Show, action, createMemo, createSignal, flush, latest } from "solid-js";
import { render } from "../src/index.js";

async function settle() {
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
}

async function run(form: "binding" | "memo") {
  const root = document.createElement("div");
  const [x, setX] = createSignal(0);
  let release!: () => void;
  const save = action(function* () {
    setX(1);
    yield new Promise<void>(r => (release = r));
  });

  const dispose = render(() => {
    const Content = () => {
      const text = createMemo(() => `content ${x()}`);
      return <p>{form === "memo" ? text() : `content ${x()}`}</p>;
    };
    return (
      <>
        <i>{x()}</i>
        <Show when={latest(x) > 0}>
          <Loading fallback="fallback">
            <Content />
          </Loading>
        </Show>
      </>
    );
  }, root);
  flush();
  const screens = [root.innerHTML];

  const done = save();
  await settle();
  screens.push(root.innerHTML);

  release();
  await done;
  await settle();
  screens.push(root.innerHTML);
  dispose();
  return screens;
}

for (const form of ["binding", "memo"] as const)
  test(`S-31 (${form}): the mounted Loading shows its fallback while the action holds the value, the content at the landing`, async () => {
    expect(await run(form)).toEqual(["<i>0</i>", "<i>0</i>fallback", "<i>1</i><p>content 1</p>"]);
  });
