/**
 * #4166: #3851 for a nested render effect. An action holds `x = 1`;
 * `<Show when={latest(x) > 0}>` mounts a `<Loading>` whose content creates
 * a DOM render effect reading `x` (`<p>{x()}</p>`). The mount is mainline,
 * so that effect's first read is held like a direct read: the boundary
 * shows its fallback and the effect publishes nothing until the action
 * lands. Before, the effect published `1` beside the committed `x = 0`.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest,
  untrack
} from "../src/index.js";

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

async function mountUnderVerdict(contentInMemo: boolean) {
  const [x, setX] = createSignal(0);
  let screenX: unknown;
  let inner: unknown;
  let slot: unknown;
  createRoot(() => {
    // <i>{x()}</i>
    createRenderEffect(x, v => {
      screenX = v;
    });
    // <Show when={latest(x) > 0}>
    //   <Loading fallback="pending"><p>{x()}</p></Loading>
    // </Show>
    const p = () => {
      createRenderEffect(x, v => {
        inner = v;
      });
      return "p";
    };
    // A component that returns a memo: the render effect is created two
    // creation passes below the verdict pass that mounted the boundary.
    const content = contentInMemo ? () => createMemo(p)() : p;
    const when = createMemo(() => latest(x) > 0);
    const condition = createMemo(() => when());
    const children = createMemo(() =>
      condition() ? untrack(() => createLoadingBoundary(content, () => "pending")) : "closed"
    );
    createRenderEffect(
      () => {
        const c = children();
        return typeof c === "function" ? c() : c;
      },
      v => {
        slot = v;
      }
    );
  });
  flush();
  const screens: unknown[] = [[screenX, slot, inner]];

  let release!: () => void;
  const done = action(function* () {
    setX(1);
    yield new Promise<void>(r => (release = r));
  })();
  await settle();
  screens.push([screenX, slot, inner]);

  release();
  await done;
  await settle();
  screens.push([screenX, slot, inner]);
  return screens;
}

describe("#4166: a verdict-mounted boundary holds a nested render effect's first read", () => {
  it("the boundary shows its fallback while the action holds the value", async () => {
    expect(await mountUnderVerdict(false)).toEqual([
      [0, "closed", undefined],
      [0, "pending", undefined],
      [1, "p", 1]
    ]);
  });

  it("same with the render effect inside a memo the content creates", async () => {
    expect(await mountUnderVerdict(true)).toEqual([
      [0, "closed", undefined],
      [0, "pending", undefined],
      [1, "p", 1]
    ]);
  });
});
